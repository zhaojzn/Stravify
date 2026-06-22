// Read-only probe: how many of the athlete's runs have heart-rate data, and
// can we fetch a heartrate stream? Decides whether HR zones are viable.
//
//   cd lambdas
//   AWS_PROFILE=<profile> npx tsx scripts/hrcheck.ts

import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const API = "https://www.strava.com/api/v3";
const STACK_NAME = process.env.STACK_NAME ?? "StravifyStack";
const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

async function main() {
  const ddb0 = new DynamoDBClient({});
  const tables: string[] = [];
  let next: string | undefined;
  do {
    const r = await ddb0.send(new ListTablesCommand({ ExclusiveStartTableName: next }));
    tables.push(...(r.TableNames ?? [])); next = r.LastEvaluatedTableName;
  } while (next);
  const usersTable = tables.find(t => t.startsWith(`${STACK_NAME}-Users`))!;

  process.env.USERS_TABLE = usersTable;
  process.env.STRAVA_PARAM_NAME = "/stravify/strava";
  const strava = await import("../src/lib/strava");

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const users = (await ddb.send(new ScanCommand({ TableName: usersTable }))).Items ?? [];
  const user = users.find(u => u.stravaTokens);
  if (!user) { console.error(`No user with Strava tokens (scanned ${users.length}).`); process.exit(1); }
  const tokens = await strava.getFreshTokens(user.cognitoSub, user.stravaTokens);

  // Page through activities, collect runs + HR flags.
  const runs: any[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${API}/athlete/activities?per_page=200&page=${page}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const batch = (await res.json()) as any[];
    runs.push(...batch.filter(a => RUN_TYPES.has(a.type)));
    if (batch.length < 200) break;
  }
  const withHr = runs.filter(r => r.has_heartrate);
  console.log(`Total runs: ${runs.length}`);
  console.log(`With heart rate: ${withHr.length} (${Math.round((withHr.length / runs.length) * 100)}%)`);
  if (withHr.length) {
    const avgs = withHr.map(r => r.average_heartrate).filter(Boolean);
    const maxes = withHr.map(r => r.max_heartrate).filter(Boolean);
    console.log(`avg HR range: ${Math.min(...avgs)}–${Math.max(...avgs)} bpm`);
    console.log(`max HR observed: ${Math.max(...maxes)} bpm`);

    // Confirm the heartrate stream is fetchable on the most recent HR run.
    const sample = withHr.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))[0];
    const res = await fetch(
      `${API}/activities/${sample.id}/streams?keys=time,heartrate&key_by_type=true`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    const s = (await res.json()) as any;
    const hr = s.heartrate?.data ?? [];
    console.log(`\nSample run ${sample.id} (${sample.name}):`);
    console.log(`  heartrate points: ${hr.length}`);
    console.log(`  first 8 bpm: ${hr.slice(0, 8).join(", ")}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
