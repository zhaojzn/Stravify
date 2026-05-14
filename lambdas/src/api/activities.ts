import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { listActivities } from "../lib/dynamo";
import { getUserSub, ok, unauthorized } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();
  const items = await listActivities(sub, 50);
  // Return a trimmed shape — no need to send the full track list in the list view.
  return ok({
    items: items
      .map(a => ({
        activityId: a.activityId,
        name: a.name,
        startTime: a.startTime,
        elapsedSeconds: a.elapsedSeconds,
        distanceMeters: a.distanceMeters,
        type: a.type,
        tracks: Array.isArray(a.tracks) ? a.tracks : [],
        genreBreakdown: a.genreBreakdown ?? [],
      }))
      .sort((a, b) => (a.startTime < b.startTime ? 1 : -1)),
  });
};
