// One-off: backfill the full Strava run history into the Activities table so
// every run (not just the ones processed since the app went live) shows up in
// the gallery.
//
// For each run not already stored, runs processActivity to pull music/genres +
// pace streams and save it. By default it does NOT touch the Strava
// description (writeToStrava:false) — backfilling shouldn't rewrite hundreds of
// old posts. Pass WRITE=1 to also publish jason.zhao.io links onto them.
//
// Run:
//   cd lambdas
//   AWS_PROFILE=<profile> npx tsx scripts/backfill.ts            # dry run is DRY_RUN=1
//
// Optional env:
//   STACK_NAME (default "StravifyStack"), DRY_RUN=1, WRITE=1, FORCE=1, DELAY_MS

import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const API = "https://www.strava.com/api/v3";
const STACK_NAME = process.env.STACK_NAME ?? "StravifyStack";
const DRY_RUN = process.env.DRY_RUN === "1";
const WRITE = process.env.WRITE === "1";        // also write links into Strava
const FORCE = process.env.FORCE === "1";        // re-process runs already stored
const DELAY_MS = Number(process.env.DELAY_MS ?? 2000);
const TARGET_EMAIL = "jasonnope123@gmail.com";

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
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

async function listAllRuns(token: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${API}/athlete/activities?per_page=200&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Strava list page ${page}: ${res.status} ${await res.text()}`);
    const batch = (await res.json()) as any[];
    out.push(...batch);
    if (batch.length < 200) break;
  }
  return out.filter(a => RUN_TYPES.has(a.type));
}

async function main() {
  const allTables = await listAllTables();
  const pick = (logical: string) => {
    const match = allTables.find(t => t.startsWith(`${STACK_NAME}-${logical}`));
    if (!match) throw new Error(`No table starting with "${STACK_NAME}-${logical}".`);
    return match;
  };
  const usersTable = pick("Users");
  const activitiesTable = pick("Activities");
  const songPlaysTable = pick("SongPlays");

  // Set env before importing lib modules (they read env at import time).
  process.env.USERS_TABLE = usersTable;
  process.env.ACTIVITIES_TABLE = activitiesTable;
  process.env.SONGPLAYS_TABLE = songPlaysTable;
  process.env.STRAVA_PARAM_NAME = "/stravify/strava";
  process.env.SPOTIFY_PARAM_NAME = "/stravify/spotify";
  process.env.LASTFM_PARAM_NAME = "/stravify/lastfm";
  process.env.DEFAULT_FRONTEND_URL = process.env.DEFAULT_FRONTEND_URL ?? "https://jason.zhao.io";

  const strava = await import("../src/lib/strava");
  const { processActivity } = await import("../src/lib/processActivity");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // User.
  const users = (await ddb.send(new ScanCommand({ TableName: usersTable }))).Items ?? [];
  const user =
    users.find(u => (u.email as string)?.toLowerCase() === TARGET_EMAIL) ??
    (users.length === 1 ? users[0] : undefined);
  if (!user?.stravaTokens) { console.error("No user with linked Strava found."); process.exit(1); }
  const sub = user.cognitoSub as string;
  console.log(`User: ${user.email ?? "(no email)"}  Last.fm: ${user.lastfmUsername ?? "no"}`);

  // Already-stored activity IDs.
  const stored = new Set<string>();
  let lek: any = undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: activitiesTable,
      KeyConditionExpression: "cognitoSub = :s",
      ExpressionAttributeValues: { ":s": sub },
      ProjectionExpression: "activityId",
      ExclusiveStartKey: lek,
    }));
    (r.Items ?? []).forEach(i => stored.add(String(i.activityId)));
    lek = r.LastEvaluatedKey;
  } while (lek);

  const tokens = await strava.getFreshTokens(sub, user.stravaTokens);
  console.log("Fetching full Strava activity history…");
  const runs = await listAllRuns(tokens.accessToken);
  runs.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));

  const todo = FORCE ? runs : runs.filter(r => !stored.has(String(r.id)));
  console.log(`\nTotal runs on Strava: ${runs.length}`);
  console.log(`Already stored: ${stored.size}`);
  console.log(`To ${FORCE ? "re-process" : "import"}: ${todo.length}`);
  console.log(`Write links to Strava: ${WRITE ? "YES" : "no"}${DRY_RUN ? "   (DRY_RUN — no writes)" : ""}\n`);

  if (DRY_RUN) {
    for (const r of todo) {
      console.log(`  + ${r.id} @ ${r.start_date}  ${(r.distance / 1000).toFixed(2)}km  ${r.name ?? ""}`);
    }
    return;
  }

  let ok = 0, noMusic = 0, failed = 0;
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${r.id} @ ${r.start_date}  ${r.name ?? ""} … `);
    try {
      const result = await processActivity(user, Number(r.id), { force: FORCE, writeToStrava: WRITE });
      console.log(`${result.status} (tracks=${result.trackCount ?? 0}, ${result.source ?? "no source"})`);
      if (result.status === "annotated") ok++;
      else if (result.status === "no-tracks") noMusic++;
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`);
      failed++;
      // Strava rate limit → back off and retry once after the 15-min window.
      if (String(e.message).includes("429")) {
        console.log("Rate limited — sleeping 15 min then continuing…");
        await sleep(15 * 60 * 1000 + 5000);
      }
    }
    if (i < todo.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. Imported ${ok} with music, ${noMusic} without music data, ${failed} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
