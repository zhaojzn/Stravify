// Refresh additive portfolio metrics only. Never publishes/edits Strava,
// replaces activities, reprocesses music, or deletes song history.
import { execFileSync } from "node:child_process";

async function main() {
  const config = JSON.parse(execFileSync("aws", [
    "lambda", "get-function-configuration", "--function-name", "StravifyStack-RunByIdFnE4E3D4B6-o94QUPxRd0Ef",
    "--profile", "stravify", "--region", "us-west-1", "--output", "json",
  ], { encoding: "utf8" }));
  Object.assign(process.env, config.Environment.Variables);
  const { scanAllActivities, getUser, updateActivityPortfolio } = await import("../src/lib/dynamo");
  const { getFreshTokens, getActivityZones } = await import("../src/lib/strava");
  const { normalizeRunMetrics } = await import("../src/lib/runMetrics");
  const items = await scanAllActivities();
  const explicit = new Set((process.env.PORTFOLIO_ACTIVITY_IDS || "").split(",").filter(Boolean));
  const targets = items.filter(item => explicit.size ? explicit.has(item.activityId) : Number(item.distanceMeters) >= 4800)
    .filter(item => process.env.PORTFOLIO_FORCE === "1" || item.stravaMetrics?.version !== 1)
    .sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)));
  console.log(JSON.stringify({ totalRuns: items.length, targets: targets.length, apply: process.env.PORTFOLIO_APPLY === "1" }));
  if (process.env.PORTFOLIO_APPLY !== "1") return;
  const users = new Map<string, any>();
  let updated = 0;
  for (const item of targets) {
    let user = users.get(item.cognitoSub);
    if (!user) {
      user = await getUser(item.cognitoSub);
      if (!user?.stravaTokens) throw new Error("Strava not linked");
      const tokens = await getFreshTokens(user.cognitoSub, user.stravaTokens);
      user.stravaTokens = tokens;
      users.set(item.cognitoSub, user);
    }
    const response = await fetch(`https://www.strava.com/api/v3/activities/${item.activityId}`, {
      headers: { Authorization: `Bearer ${user.stravaTokens.accessToken}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Strava activity ${item.activityId}: ${response.status}; safely stopped after ${updated} updates`);
    const limits = (response.headers.get("x-readratelimit-limit") || "200,2000").split(",").map(Number);
    const usage = (response.headers.get("x-readratelimit-usage") || "0,0").split(",").map(Number);
    const activity = await response.json();
    // Prime the screenshot's activity; other HR distributions load on demand.
    const zones = item.activityId === "20877331493"
      ? await getActivityZones(user.stravaTokens.accessToken, Number(item.activityId)) : undefined;
    const metrics = normalizeRunMetrics(activity, zones);
    await updateActivityPortfolio(item.cognitoSub, item.activityId, { stravaMetrics: metrics });
    updated++;
    if (updated % 10 === 0 || updated === targets.length) console.log(JSON.stringify({ updated, total: targets.length, readUsage: usage }));
    if (usage[0] >= limits[0] - 15 || usage[1] >= limits[1] - 15) {
      throw new Error(`Near Strava rate limit; safely stopped after ${updated} updates. Rerun later to resume.`);
    }
  }
  const refreshed = await scanAllActivities();
  const efforts = refreshed.flatMap(item => item.stravaMetrics?.bestEfforts || []);
  console.log(JSON.stringify({ updated, records: [5000, 10000, 21097.5, 42195].map(distance => {
    const best = efforts.filter(effort => effort.distanceMeters === distance).sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)[0];
    return { distanceMeters: distance, elapsedSeconds: best?.elapsedSeconds ?? null, activityId: best?.activityId ?? null };
  }) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
