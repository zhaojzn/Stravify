import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getActivityById } from "../lib/dynamo";
import { ok, notFound, bad } from "../lib/response";

// Public — no JWT auth. Returns a sanitized view of a single run so it can
// be linked / shared.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const id = event.pathParameters?.id;
  if (!id) return bad("missing id");

  const item = await getActivityById(id);
  if (!item) return notFound();

  return ok({
    activityId: item.activityId,
    name: item.name,
    startTime: item.startTime,
    elapsedSeconds: item.elapsedSeconds,
    distanceMeters: item.distanceMeters,
    type: item.type,
    musicSource: item.musicSource,
    tracks: item.tracks ?? [],
    genreBreakdown: item.genreBreakdown ?? [],
    streams: item.streams,
  });
};
