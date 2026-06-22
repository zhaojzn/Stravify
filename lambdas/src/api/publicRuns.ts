import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { scanAllActivities } from "../lib/dynamo";
import { ok } from "../lib/response";

// Public — no JWT auth. Lists every processed run so the portfolio "Runs"
// gallery can render them. Single-owner site, so this returns the one
// athlete's runs. Trimmed shape: no full track list in the list view.
export const handler: APIGatewayProxyHandlerV2 = async () => {
  const items = await scanAllActivities();
  return ok({
    items: items
      .map(a => ({
        activityId: a.activityId,
        name: a.name,
        startTime: a.startTime,
        elapsedSeconds: a.elapsedSeconds,
        distanceMeters: a.distanceMeters,
        type: a.type,
        musicSource: a.musicSource,
        trackCount: Array.isArray(a.tracks) ? a.tracks.length : 0,
        genreBreakdown: a.genreBreakdown ?? [],
      }))
      .sort((a, b) => (a.startTime < b.startTime ? 1 : -1)),
  });
};
