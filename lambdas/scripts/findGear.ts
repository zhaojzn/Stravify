import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

(async () => {
  const ddbRaw = new DynamoDBClient({});
  const tables: string[] = [];
  let next: string | undefined;
  do {
    const r = await ddbRaw.send(new ListTablesCommand({ ExclusiveStartTableName: next }));
    tables.push(...(r.TableNames ?? []));
    next = r.LastEvaluatedTableName;
  } while (next);
  const usersTable = tables.find(t => t.startsWith("StravifyStack-Users"))!;
  process.env.USERS_TABLE = usersTable;
  process.env.STRAVA_PARAM_NAME = "/stravify/strava";

  const ddb = DynamoDBDocumentClient.from(ddbRaw);
  const usersRes = await ddb.send(new ScanCommand({ TableName: usersTable }));
  const user = (usersRes.Items ?? []).find(u => (u.email as string)?.toLowerCase() === "jasonnope123@gmail.com")!;

  const strava = await import("../src/lib/strava");
  const tokens = await strava.getFreshTokens(user.cognitoSub as string, user.stravaTokens as any);

  const r = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=10", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const items: any[] = await r.json();
  console.log("Recent activities (summary):");
  for (const a of items) {
    console.log(`  ${a.id} ${a.start_date_local} ${a.type} ${a.name}`);
  }
  // Summary list doesn't include gear_id. Pull the detail for the top Run.
  const runs = items.filter(a => a.type === "Run" || a.type === "TrailRun");
  if (runs.length === 0) { console.log("No recent runs."); return; }
  for (const top of runs.slice(0, 3)) {
    const det = await strava.getActivity(tokens.accessToken, top.id);
    console.log(`\n--- Activity ${top.id} detail ---`);
    console.log(`  name:    ${det.name}`);
    console.log(`  date:    ${det.start_date_local}`);
    console.log(`  gear_id: ${det.gear_id}`);
    if (det.gear) console.log(`  gear:    ${det.gear.name ?? "(no name)"} (${det.gear.id ?? "?"})`);
    if (det.gear_id) break;
  }
})().catch(e => { console.error(e); process.exit(1); });
