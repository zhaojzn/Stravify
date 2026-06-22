// One-off backfill: clear genre/track data for old runs and re-process recent
// ones with the new winner-takes-all category logic.
//
// Behavior:
//   * Activities with startTime < CUTOFF  -> deleted from Activities + their
//                                            SongPlays rows are removed.
//   * Activities with startTime >= CUTOFF -> processActivity(force, writeToStrava)
//                                            recomputes breakdown AND rewrites
//                                            the Strava description.
//
// Run:
//   cd lambdas
//   AWS_PROFILE=<profile> AWS_REGION=us-east-1 npx tsx scripts/reprocess.ts
//
// Optional env:
//   STACK_NAME (default "StravifyStack"), DRY_RUN=1

import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const CUTOFF_ISO = "2026-05-03T00:00:00Z";
const TARGET_EMAIL = "jasonnope123@gmail.com";
const STACK_NAME = process.env.STACK_NAME ?? "StravifyStack";
const DRY_RUN = process.env.DRY_RUN === "1";

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
  // CDK names tables like "<StackName>-<LogicalId><Hash>". Match by logical-id prefix.
  const pick = (logical: string) => {
    const match = allTables.find(t => t.startsWith(`${STACK_NAME}-${logical}`));
    if (!match) throw new Error(`No table starting with "${STACK_NAME}-${logical}" found. Tables: ${allTables.join(", ")}`);
    return match;
  };
  const usersTable = pick("Users");
  const activitiesTable = pick("Activities");
  const songPlaysTable = pick("SongPlays");
  const oauthStateTable = pick("OAuthState");
  console.log(`  Users:      ${usersTable}`);
  console.log(`  Activities: ${activitiesTable}`);
  console.log(`  SongPlays:  ${songPlaysTable}`);

  // Set env BEFORE importing lib modules (dynamo.ts reads env at module init).
  process.env.USERS_TABLE = usersTable;
  process.env.ACTIVITIES_TABLE = activitiesTable;
  process.env.SONGPLAYS_TABLE = songPlaysTable;
  process.env.OAUTH_STATE_TABLE = oauthStateTable;
  process.env.STRAVA_PARAM_NAME = "/stravify/strava";
  process.env.SPOTIFY_PARAM_NAME = "/stravify/spotify";
  process.env.LASTFM_PARAM_NAME = "/stravify/lastfm";
  process.env.DEFAULT_FRONTEND_URL = process.env.DEFAULT_FRONTEND_URL ?? "https://stravify.net";

  const { processActivity } = await import("../src/lib/processActivity");

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // Find the user. There's no email index, so scan (only ~1 user expected).
  const usersRes = await ddb.send(new ScanCommand({ TableName: usersTable }));
  const users = usersRes.Items ?? [];
  const user =
    users.find(u => (u.email as string)?.toLowerCase() === TARGET_EMAIL) ??
    (users.length === 1 ? users[0] : undefined);
  if (!user) {
    console.error(`No user found matching ${TARGET_EMAIL}. Scan returned ${users.length} rows.`);
    process.exit(1);
  }
  const sub = user.cognitoSub as string;
  console.log(`\nUser: ${user.email ?? "(no email attr)"} sub=${sub}`);
  console.log(`  Strava linked: ${!!user.stravaTokens}, Spotify: ${!!user.spotifyTokens}, Last.fm: ${user.lastfmUsername ?? "no"}`);

  // List all activities for the user.
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

  const toDelete = all.filter(a => ((a.startTime as string) ?? "") < CUTOFF_ISO);
  const toReprocess = all
    .filter(a => ((a.startTime as string) ?? "") >= CUTOFF_ISO)
    .sort((a, b) => (a.startTime as string).localeCompare(b.startTime as string));

  console.log(`\nFound ${all.length} activities. Delete: ${toDelete.length}, Reprocess: ${toReprocess.length}`);
  console.log(`Cutoff: ${CUTOFF_ISO} (activities before this are deleted)`);
  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 — listing only, no writes.\n");
    console.log("Would DELETE:");
    for (const a of toDelete) console.log(`  - ${a.activityId} @ ${a.startTime}  ${a.name ?? ""}`);
    console.log("Would REPROCESS:");
    for (const a of toReprocess) console.log(`  - ${a.activityId} @ ${a.startTime}  ${a.name ?? ""}`);
    return;
  }

  // ---- delete old activities + their song plays ----
  for (const a of toDelete) {
    console.log(`DELETE  ${a.activityId} @ ${a.startTime}  ${a.name ?? ""}`);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [activitiesTable]: [{ DeleteRequest: { Key: { cognitoSub: sub, activityId: a.activityId } } }],
      },
    }));
    await deleteSongPlaysForActivity(ddb, songPlaysTable, sub, a.activityId as string);
  }

  // ---- reprocess recent activities ----
  for (const a of toReprocess) {
    console.log(`REPROC  ${a.activityId} @ ${a.startTime}  ${a.name ?? ""}`);
    // Clear existing song plays for this activity so the re-run doesn't double-count.
    await deleteSongPlaysForActivity(ddb, songPlaysTable, sub, a.activityId as string);
    try {
      const result = await processActivity(user, Number(a.activityId), { force: true, writeToStrava: true });
      console.log(`        -> ${result.status} (tracks=${result.trackCount ?? 0}, source=${result.source ?? "n/a"})`);
    } catch (e: any) {
      console.error(`        ERROR: ${e.message}`);
    }
  }

  console.log("\nDone.");
}

async function deleteSongPlaysForActivity(
  ddb: DynamoDBDocumentClient,
  table: string,
  sub: string,
  activityId: string,
) {
  let lek: any = undefined;
  let total = 0;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: "cognitoSub = :s",
      FilterExpression: "activityId = :aid",
      ExpressionAttributeValues: { ":s": sub, ":aid": activityId },
      ProjectionExpression: "cognitoSub, sortKey",
      ExclusiveStartKey: lek,
    }));
    const items = r.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await ddb.send(new BatchWriteCommand({
        RequestItems: {
          [table]: batch.map(s => ({ DeleteRequest: { Key: { cognitoSub: sub, sortKey: s.sortKey } } })),
        },
      }));
    }
    total += items.length;
    lek = r.LastEvaluatedKey;
  } while (lek);
  if (total > 0) console.log(`        purged ${total} song plays`);
}

main().catch(e => { console.error(e); process.exit(1); });
