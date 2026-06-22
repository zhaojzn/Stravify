// One-off: re-pull each stored run's streams from Strava INCLUDING heart rate
// and patch the activity's `streams` attribute. Needed because earlier runs
// were saved before we fetched the heartrate stream.
//
// Only touches the `streams` field — music, genres, descriptions untouched.
//
//   cd lambdas
//   AWS_PROFILE=<profile> npx tsx scripts/streamsbackfill.ts      # DRY_RUN=1 to preview
//
// Optional env: STACK_NAME, DRY_RUN=1, DELAY_MS (default 9000)

import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const STACK_NAME = process.env.STACK_NAME ?? "StravifyStack";
const DRY_RUN = process.env.DRY_RUN === "1";
const DELAY_MS = Number(process.env.DELAY_MS ?? 9000);
const TARGET = 150; // downsample target, matches processActivity
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function downsample(raw: any) {
  const { time, distance, velocity, heartrate } = raw;
  if (!time || !distance || !velocity) return undefined;
  const len = Math.min(time.length, distance.length, velocity.length);
  if (len < 2) return undefined;
  const hasHr = Array.isArray(heartrate) && heartrate.length >= len;
  const pick = (arr: number[]) => {
    if (len <= TARGET) return arr.slice(0, len);
    const step = len / TARGET, out: number[] = [];
    for (let i = 0; i < TARGET; i++) out.push(arr[Math.min(len - 1, Math.floor(i * step))]);
    return out;
  };
  return {
    time: pick(time), distance: pick(distance), velocity: pick(velocity),
    ...(hasHr ? { heartrate: pick(heartrate) } : {}),
  };
}

async function main() {
  const ddb0 = new DynamoDBClient({});
  const tables: string[] = [];
  let next: string | undefined;
  do {
    const r = await ddb0.send(new ListTablesCommand({ ExclusiveStartTableName: next }));
    tables.push(...(r.TableNames ?? [])); next = r.LastEvaluatedTableName;
  } while (next);
  const usersTable = tables.find(t => t.startsWith(`${STACK_NAME}-Users`))!;
  const activitiesTable = tables.find(t => t.startsWith(`${STACK_NAME}-Activities`))!;

  process.env.USERS_TABLE = usersTable;
  process.env.STRAVA_PARAM_NAME = "/stravify/strava";
  const strava = await import("../src/lib/strava");
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const users = (await ddb.send(new ScanCommand({ TableName: usersTable }))).Items ?? [];
  const user = users.find(u => u.stravaTokens);
  if (!user) { console.error("No user with Strava tokens."); process.exit(1); }
  const sub = user.cognitoSub as string;

  const all: any[] = [];
  let lek: any = undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: activitiesTable,
      KeyConditionExpression: "cognitoSub = :s",
      ExpressionAttributeValues: { ":s": sub },
      ProjectionExpression: "activityId, startTime, #n, streams",
      ExpressionAttributeNames: { "#n": "name" },
      ExclusiveStartKey: lek,
    }));
    all.push(...(r.Items ?? [])); lek = r.LastEvaluatedKey;
  } while (lek);
  all.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  console.log(`${all.length} stored runs. ${DRY_RUN ? "(DRY_RUN)" : ""}\n`);

  const tokens = await strava.getFreshTokens(sub, user.stravaTokens);
  let withHr = 0, noHr = 0, failed = 0;

  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const id = String(a.activityId);
    process.stdout.write(`[${i + 1}/${all.length}] ${id} ${a.name ?? ""} … `);
    try {
      const raw = await strava.getActivityStreams(tokens.accessToken, Number(id));
      const streams = downsample(raw);
      const hasHr = !!streams?.heartrate?.length;
      console.log(streams ? `${streams.time.length} pts${hasHr ? `, HR ✓` : ", no HR"}` : "no streams");
      if (streams && !DRY_RUN) {
        await ddb.send(new UpdateCommand({
          TableName: activitiesTable,
          Key: { cognitoSub: sub, activityId: id },
          UpdateExpression: "SET streams = :s",
          ExpressionAttributeValues: { ":s": streams },
        }));
      }
      if (hasHr) withHr++; else noHr++;
    } catch (e: any) {
      console.log(`ERROR: ${e.message}`);
      failed++;
      if (String(e.message).includes("429")) { console.log("Rate limited — sleeping 15 min…"); await sleep(15 * 60 * 1000 + 5000); }
    }
    if (i < all.length - 1) await sleep(DELAY_MS);
  }
  console.log(`\nDone. ${withHr} with HR, ${noHr} without, ${failed} failed.`);
}
main().catch(e => { console.error(e); process.exit(1); });
