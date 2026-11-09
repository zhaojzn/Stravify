// Smoke-test the public handlers with live read-only Strava/Spotify calls.
// The only writes are their additive DynamoDB caches, never Strava activities.
import { execFileSync } from "node:child_process";

async function main() {
  const config = JSON.parse(execFileSync("aws", [
    "lambda", "get-function-configuration", "--function-name", "StravifyStack-RunByIdFnE4E3D4B6-o94QUPxRd0Ef",
    "--profile", "stravify", "--region", "us-west-1", "--output", "json",
  ], { encoding: "utf8" }));
  Object.assign(process.env, config.Environment.Variables);
  const { handler: getRun } = await import("../src/api/runById");
  const { handler: getRuns } = await import("../src/api/publicRuns");
  for (const id of ["20877331493", "20373166399", "20716381616"]) {
    const response: any = await getRun({ pathParameters: { id } } as any, {} as any, () => {});
    if (response?.statusCode !== 200) throw new Error(`Run ${id} failed`);
    const run = JSON.parse(response.body);
    const spotify = run.tracks.filter((track: any) => track.artworkSource === "spotify");
    console.log(JSON.stringify({ id, averageHr: run.heartRate?.averageBpm, maxHr: run.heartRate?.maxBpm, zones: run.heartRate?.zones, tracks: run.tracks.length, spotifyCovers: spotify.length, unmatched: run.tracks.filter((track: any) => track.artworkSource !== "spotify").map((track: any) => ({ name: track.trackName, artists: track.artistNames })) }));
    if (id === "20877331493" && (run.heartRate?.maxBpm !== 195 || run.heartRate.zones.length !== 5 || spotify.length !== 7)) throw new Error("Screenshot run did not match expected HR/Spotify artwork");
    if (JSON.stringify(run).includes("accessToken") || run.cognitoSub) throw new Error("Private fields in public response");
  }
  const response: any = await getRuns({} as any, {} as any, () => {});
  const { items } = JSON.parse(response.body);
  console.log(JSON.stringify({ runs: items.length, syncedEfforts: items.filter((item: any) => item.bestEffortsSynced).length, efforts: items.flatMap((item: any) => item.bestEfforts).length }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
