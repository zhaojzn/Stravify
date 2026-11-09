import { getUser, updateActivityPortfolio } from "./dynamo";
import * as strava from "./strava";
import { normalizeRunMetrics, RUN_METRICS_VERSION } from "./runMetrics";
import { artworkKey, getRunArtwork } from "./spotify";

export async function enrichPortfolioRun(item: any) {
  let metrics = item.stravaMetrics;
  let artwork = item.spotifyArtwork;
  const patch: { stravaMetrics?: unknown; spotifyArtwork?: unknown } = {};
  const fresh = (cache: any, ttl: number) => cache?.version === 1 && Date.now() - Date.parse(cache.fetchedAt) < ttl;

  await Promise.all([
    (async () => {
      if (metrics?.version === RUN_METRICS_VERSION && (!metrics.heartRate || metrics.heartRate.zonesSynced) && fresh(metrics, 24 * 60 * 60_000)) return;
      try {
        const user = await getUser(item.cognitoSub);
        if (!user?.stravaTokens) return;
        const tokens = await strava.getFreshTokens(user.cognitoSub, user.stravaTokens);
        const [activity, zones] = await Promise.all([
          strava.getActivity(tokens.accessToken, Number(item.activityId)),
          strava.getActivityZones(tokens.accessToken, Number(item.activityId)).catch(() => []),
        ]);
        metrics = normalizeRunMetrics(activity, zones);
        patch.stravaMetrics = metrics;
      } catch (error) {
        console.warn("Portfolio Strava metrics unavailable", error instanceof Error ? error.message : "upstream error");
      }
    })(),
    (async () => {
      const tracks = item.tracks || [];
      const count = new Set(tracks.map(artworkKey)).size;
      const ttl = artwork?.entries?.length === count ? 6 * 60 * 60_000 : 5 * 60_000;
      if (!tracks.length || (artwork?.complete && fresh(artwork, ttl))) return;
      try {
        artwork = await getRunArtwork(tracks);
        patch.spotifyArtwork = artwork;
      } catch {
        // An artwork outage must never make a recorded run disappear.
      }
    })(),
  ]);
  if (Object.keys(patch).length) await updateActivityPortfolio(item.cognitoSub, item.activityId, patch).catch(() => {});
  const covers = new Map((artwork?.entries || []).map((entry: any) => [entry.key, entry]));
  return {
    bestEfforts: metrics?.bestEfforts || [],
    heartRate: metrics?.heartRate || null,
    tracks: (item.tracks || []).map((track: any) => {
      const art: any = covers.get(artworkKey(track));
      if (art) return { ...track, imageUrl: art.imageUrl, spotifyUrl: art.spotifyUrl, artworkSource: "spotify" };
      const imageUrl = typeof track.imageUrl === "string" && !track.imageUrl.includes("2a96cbd8b46e442fc41c2b86b821562f") ? track.imageUrl : null;
      return { ...track, imageUrl };
    }),
  };
}
