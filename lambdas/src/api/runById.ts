import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getActivityById } from "../lib/dynamo";
import { ok, notFound, bad } from "../lib/response";
import { enrichPortfolioRun } from "../lib/portfolioRun";

// Public — no JWT auth. Returns a sanitized view of a single run so it can
// be linked / shared.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const id = event.pathParameters?.id;
  if (!id || !/^\d+$/.test(id)) return bad("invalid id");

  const item = await getActivityById(id);
  if (!item) return notFound();
  const enrichment = await enrichPortfolioRun(item);

  return ok({
    activityId: item.activityId,
    name: item.name,
    startTime: item.startTime,
    elapsedSeconds: item.elapsedSeconds,
    distanceMeters: item.distanceMeters,
    type: item.type,
    musicSource: item.musicSource,
    tracks: enrichment.tracks,
    bestEfforts: enrichment.bestEfforts,
    heartRate: enrichment.heartRate,
    genreBreakdown: item.genreBreakdown ?? [],
    streams: item.streams,
  });
};
