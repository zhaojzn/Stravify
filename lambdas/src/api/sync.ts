import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getUser, getActivity as getStoredActivity } from "../lib/dynamo";
import * as strava from "../lib/strava";
import { processActivity, ProcessResult } from "../lib/processActivity";
import { getUserSub, ok, unauthorized, bad } from "../lib/response";

const MAX_TO_PROCESS = 5;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();

  const user = await getUser(sub);
  if (!user?.stravaTokens) return bad("Strava not linked");
  if (!user?.spotifyTokens && !user?.lastfmUsername) return bad("Link a music source first (Last.fm or Spotify)");

  const force = event.queryStringParameters?.force === "true";
  const tokens = await strava.getFreshTokens(sub, user.stravaTokens);
  const activities = await strava.listRecentActivities(tokens.accessToken, 30);

  const candidates: number[] = [];
  let skippedAlreadyProcessed = 0;
  let skippedNotARun = 0;
  for (const a of activities) {
    if (a.type !== "Run") { skippedNotARun++; continue; }
    if (!force) {
      const existing = await getStoredActivity(sub, String(a.id));
      // Re-process if streams are missing (backfill for pace chart).
      const missingStreams = existing && !existing.streams;
      if (existing && !missingStreams) { skippedAlreadyProcessed++; continue; }
    }
    candidates.push(a.id);
    if (candidates.length >= MAX_TO_PROCESS) break;
  }

  const results: ProcessResult[] = [];
  for (const id of candidates) {
    try {
      const fresh = (await getUser(sub)) ?? user;
      // Sync intentionally does NOT write to Strava — it just pulls music
      // and stores it. Use the Publish button (or autoPublish on webhook) to
      // update the Strava description.
      results.push(await processActivity(fresh, id, { force, writeToStrava: false }));
    } catch (e) {
      console.error(`sync failed for activity ${id}`, e);
    }
  }
  return ok({
    scanned: activities.length,
    processed: results.length,
    annotated: results.filter(r => r.status === "annotated").length,
    noTracks: results.filter(r => r.status === "no-tracks").length,
    alreadyAnnotated: results.filter(r => r.status === "already-annotated").length + skippedAlreadyProcessed,
    notARun: skippedNotARun,
    moreAvailable: activities.filter(a => a.type === "Run").length - skippedAlreadyProcessed - results.length > 0,
    results,
  });
};
