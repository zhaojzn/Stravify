// One-off: rewrite every run's Strava description so its link points at the
// current jason.zhao.io domain instead of the old stravify.net one.
//
// Lightweight — does NOT re-pull music or recompute genres. It reuses each
// activity's already-stored genreBreakdown to rebuild the one-line teaser,
// strips whatever Stravify block is currently in the live Strava description
// (old stravify.net link, new jason.zhao.io link, or the legacy header), and
// re-appends a fresh block with the jason.zhao.io URL.
//
// Run:
//   cd lambdas
//   AWS_PROFILE=<profile> npx tsx scripts/relink.ts
//
// Optional env:
//   STACK_NAME (default "StravifyStack"), DRY_RUN=1, FRONT_URL

import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const STACK_NAME = process.env.STACK_NAME ?? "StravifyStack";
const DRY_RUN = process.env.DRY_RUN === "1";
const FRONT_URL = process.env.FRONT_URL ?? "https://jason.zhao.io";
const TARGET_EMAIL = "jasonnope123@gmail.com";

// Every run-link prefix we recognize, so a re-link cleanly replaces whichever
// domain a description currently carries instead of stacking a second link.
const LINK_PREFIXES = [
  `${FRONT_URL}/run/`,
  "https://jason.zhao.io/run/",
  "https://www.jason.zhao.io/run/",
  "https://stravify.net/run/",
  "https://www.stravify.net/run/",
];

function stripStravifyBlock(desc: string | null | undefined): string {
  if (!desc) return "";
  const markers = ["🎵 Don't be afraid", ...LINK_PREFIXES];
  const idx = markers
    .map(m => desc.indexOf(m))
    .filter(i => i >= 0)
    .reduce((min, i) => (min < 0 || i < min ? i : min), -1);
  if (idx < 0) return desc;
  return desc.slice(0, idx).replace(/\n+$/, "");
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function listAllTables(): Promise<string[]> {
  const ddb = new DynamoDBClient({});
  const out: string[] = [];
  let next: string | undefined;
  do {
    const r = await ddb.send(new ListTablesCommand({ ExclusiveStartTableName: next }));
    out.push(...(r.TableNames ?? []));
    next = r.LastEvaluatedTableName;
  } while (next);
  return out;
}

async function main() {
  console.log(`Discovering DynamoDB tables for "${STACK_NAME}"…`);
  const allTables = await listAllTables();
  const pick = (logical: string) => {
    const match = allTables.find(t => t.startsWith(`${STACK_NAME}-${logical}`));
    if (!match) throw new Error(`No table starting with "${STACK_NAME}-${logical}" found.`);
    return match;
  };
  const usersTable = pick("Users");
  const activitiesTable = pick("Activities");

  // dynamo.ts + strava.ts read env at import time — set before importing them.
  process.env.USERS_TABLE = usersTable;
  process.env.ACTIVITIES_TABLE = activitiesTable;
  process.env.STRAVA_PARAM_NAME = "/stravify/strava";
  process.env.DEFAULT_FRONTEND_URL = FRONT_URL;

  const strava = await import("../src/lib/strava");

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // Find the user (single-user app; scan is fine).
  const usersRes = await ddb.send(new ScanCommand({ TableName: usersTable }));
  const users = usersRes.Items ?? [];
  const user =
    users.find(u => (u.email as string)?.toLowerCase() === TARGET_EMAIL) ??
    (users.length === 1 ? users[0] : undefined);
  if (!user?.stravaTokens) {
    console.error("No user with linked Strava found.");
    process.exit(1);
  }
  const sub = user.cognitoSub as string;
  console.log(`User: ${user.email ?? "(no email)"}  sub=${sub}`);
  console.log(`Target domain: ${FRONT_URL}${DRY_RUN ? "   (DRY_RUN — no writes)" : ""}\n`);

  // All activities for the user.
  const all: any[] = [];
  let lek: any = undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: activitiesTable,
      KeyConditionExpression: "cognitoSub = :s",
      ExpressionAttributeValues: { ":s": sub },
      ExclusiveStartKey: lek,
    }));
    all.push(...(r.Items ?? []));
    lek = r.LastEvaluatedKey;
  } while (lek);
  all.sort((a, b) => (a.startTime as string).localeCompare(b.startTime as string));

  console.log(`Found ${all.length} runs.\n`);
  const tokens = await strava.getFreshTokens(sub, user.stravaTokens);

  let updated = 0, skipped = 0, failed = 0;
  for (const a of all) {
    const id = a.activityId as string;
    const runUrl = `${FRONT_URL}/run/${id}`;
    const top = (a.genreBreakdown as any[] | undefined)?.slice(0, 4) ?? [];
    const teaser = top.length > 0
      ? top.map(g => `${g.percent}% ${g.genre}`).join(" · ")
      : `${(a.tracks as any[] | undefined)?.length ?? 0} tracks`;
    const block = [runUrl, teaser].join("\n");

    try {
      const live = await strava.getActivity(tokens.accessToken, Number(id));
      const stripped = stripStravifyBlock(live.description);
      const newDesc = stripped ? `${stripped}\n\n${block}` : block;

      if (live.description === newDesc) {
        console.log(`SKIP   ${id} @ ${a.startTime}  (already current)`);
        skipped++;
        continue;
      }
      console.log(`RELINK ${id} @ ${a.startTime}  ${a.name ?? ""}`);
      if (!DRY_RUN) {
        await strava.updateActivityDescription(tokens.accessToken, Number(id), newDesc);
        await sleep(400); // be gentle on Strava's rate limit
      }
      updated++;
    } catch (e: any) {
      console.error(`ERROR  ${id}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${updated} ${DRY_RUN ? "would be re-linked" : "re-linked"}, ${skipped} already current, ${failed} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
