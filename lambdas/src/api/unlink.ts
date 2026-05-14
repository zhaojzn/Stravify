import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { removeUserAttrs } from "../lib/dynamo";
import { getUserSub, ok, unauthorized, bad } from "../lib/response";

const FIELDS_BY_SERVICE = {
  strava:  ["stravaAthleteId", "stravaAthleteName", "stravaTokens"],
  spotify: ["spotifyUserId", "spotifyUserName", "spotifyTokens"],
  lastfm:  ["lastfmUsername", "lastfmSessionKey"],
} as const;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();

  const body = JSON.parse(event.body || "{}");
  const service = body.service as keyof typeof FIELDS_BY_SERVICE | undefined;
  if (!service || !(service in FIELDS_BY_SERVICE)) return bad("service must be strava|spotify|lastfm");

  await removeUserAttrs(sub, FIELDS_BY_SERVICE[service] as unknown as string[]);
  return ok({ unlinked: service });
};
