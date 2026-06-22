// One-off:
//   1. Re-edit Strava descriptions for Stravify-tracked runs to drop the
//      "🎵 Don't be afraid…" header. Keep URL + genre summary.
//   2. Set gear "On Cloudmonster 1" on every Run on Strava since CUTOFF_LOCAL.
//
// Run:
//   cd lambdas
//   AWS_REGION=us-west-1 npx tsx scripts/editAndGear.ts
//   (DRY_RUN=1 to preview)

import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

// Compared lexicographically against Strava's start_date_local (TZ-free local ISO).
const CUTOFF_LOCAL = "2026-01-03T00:00:00";
const TARGET_EMAIL = "jasonnope123@gmail.com";
const STACK_NAME = process.env.STACK_NAME ?? "StravifyStack";
const GEAR_NAME = "On Cloudmonster 1";
const GEAR_ID = process.env.GEAR_ID ?? "g31570302"; // "On Cloudmonster 1"
const DRY_RUN = process.env.DRY_RUN === "1";
const STRAVIFY_LINK_PREFIX = "https://stravify.net/run/";
const LEGACY_MARKER = "🎵 Don't be afraid";

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

function stripStravifyBlock(desc: string | null | undefined): string {
  if (!desc) return "";
  const legacyIdx = desc.indexOf(LEGACY_MARKER);
  const urlIdx = desc.indexOf(STRAVIFY_LINK_PREFIX);
  let idx = -1;
  if (legacyIdx >= 0 && urlIdx >= 0) idx = Math.min(legacyIdx, urlIdx);
  else if (legacyIdx >= 0) idx = legacyIdx;
  else if (urlIdx >= 0) idx = urlIdx;
  if (idx < 0) return desc;
  return desc.slice(0, idx).replace(/\n+$/, "");
}

async function main() {
  console.log(`Discovering DynamoDB tables for "${STACK_NAME}"…`);
  const allTables = await listAllTables();
  const pick = (logical: string) => {
    const t = allTables.find(x => x.startsWith(`${STACK_NAME}-${logical}`));
    if (!t) throw new Error(`No table for ${logical}`);
    return t;
  };
  process.env.USERS_TABLE = pick("Users");
  process.env.ACTIVITIES_TABLE = pick("Activities");
  process.env.SONGPLAYS_TABLE = pick("SongPlays");
  process.env.OAUTH_STATE_TABLE = pick("OAuthState");
  process.env.STRAVA_PARAM_NAME = "/stravify/strava";
  process.env.SPOTIFY_PARAM_NAME = "/stravify/spotify";
  process.env.LASTFM_PARAM_NAME = "/stravify/lastfm";
  process.env.DEFAULT_FRONTEND_URL = "https://stravify.net";

  const strava = await import("../src/lib/strava");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // Find user
  const usersRes = await ddb.send(new ScanCommand({ TableName: process.env.USERS_TABLE! }));
  const user = (usersRes.Items ?? []).find(u => (u.email as string)?.toLowerCase() === TARGET_EMAIL);
  if (!user) throw new Error(`No user matching ${TARGET_EMAIL}`);
  const sub = user.cognitoSub as string;
  console.log(`User: ${user.email} sub=${sub}`);

  const tokens = await strava.getFreshTokens(sub, user.stravaTokens as any);
  const token = tokens.accessToken;

  // Strava OAuth scope here doesn't include profile:read_all, so we can't
  // list gear via /athlete. Use the gear ID directly (passed via GEAR_ID env
  // or pulled from a recent activity that already had it assigned).
  const gearId = GEAR_ID;
  console.log(`Using gear: ${GEAR_NAME} (${gearId})`);

  // List Strava activities since CUTOFF_LOCAL.
  // The Strava `after` query is a unix timestamp; use start-of-cutoff in UTC
  // (interpret CUTOFF_LOCAL as UTC, which under-includes by a few hours of TZ
  // — we then filter client-side on start_date_local for the real check).
  const cutoffEpoch = Math.floor(new Date(CUTOFF_LOCAL + "Z").getTime() / 1000) - 24 * 3600;
  console.log(`Listing Strava activities since ${CUTOFF_LOCAL} (after=${cutoffEpoch})…`);
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${cutoffEpoch}&per_page=200&page=${page}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`list page ${page}: ${r.status} ${await r.text()}`);
    const items: any[] = await r.json();
    all.push(...items);
    if (items.length < 200) break;
  }
  console.log(`  Total fetched: ${all.length}`);

  const runs = all
    .filter(a => a.type === "Run" || a.type === "TrailRun")
    .filter(a => ((a.start_date_local as string) ?? "") >= CUTOFF_LOCAL)
    .sort((a, b) => (a.start_date_local as string).localeCompare(b.start_date_local as string));
  console.log(`  Runs since ${CUTOFF_LOCAL}: ${runs.length}`);

  // DDB-tracked activities (subset we should also rewrite descriptions for)
  const ddbRes = await ddb.send(new QueryCommand({
    TableName: process.env.ACTIVITIES_TABLE!,
    KeyConditionExpression: "cognitoSub = :s",
    ExpressionAttributeValues: { ":s": sub },
  }));
  const ddbById = new Map<string, any>();
  for (const a of ddbRes.Items ?? []) ddbById.set(a.activityId as string, a);
  console.log(`  DDB-tracked runs available for description rewrite: ${ddbById.size}`);

  if (DRY_RUN) {
    console.log("\nDRY_RUN=1. Planned updates:");
    for (const a of runs) {
      const has = ddbById.has(String(a.id));
      console.log(`  ${a.id} @ ${a.start_date_local}  ${a.name}  [gear${has ? "+desc" : ""}]`);
    }
    return;
  }

  let ok = 0, fail = 0;
  for (const a of runs) {
    const idStr = String(a.id);
    const ddbA = ddbById.get(idStr);
    const body: any = { gear_id: gearId };

    if (ddbA) {
      try {
        const live = await strava.getActivity(token, Number(idStr));
        const stripped = stripStravifyBlock(live.description);
        const runUrl = `${STRAVIFY_LINK_PREFIX}${idStr}`;
        const top = ((ddbA.genreBreakdown ?? []) as any[]).slice(0, 4).filter(b => b.percent > 0);
        const summary = top.map(b => `${b.percent}% ${b.genre}`).join(" · ");
        const block = [runUrl, summary].filter(Boolean).join("\n");
        body.description = stripped ? `${stripped}\n\n${block}` : block;
      } catch (e: any) {
        console.error(`  WARN: could not fetch live desc for ${idStr}: ${e.message}`);
      }
    }

    const tag = body.description ? "gear+desc" : "gear    ";
    process.stdout.write(`UPDATE ${idStr} @ ${a.start_date_local}  ${a.name.padEnd(20)} [${tag}] … `);
    const r = await fetch(`https://www.strava.com/api/v3/activities/${idStr}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) { ok++; console.log("ok"); }
    else { fail++; console.log(`FAIL ${r.status} ${await r.text()}`); }
    await new Promise(res => setTimeout(res, 250));
  }
  console.log(`\nDone. ${ok} ok, ${fail} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
