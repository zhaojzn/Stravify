import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "crypto";
import { putOAuthState } from "../lib/dynamo";
import { getJsonSecret } from "../lib/secrets";
import { pickReturnTo } from "../lib/frontends";
import { getUserSub, ok, unauthorized } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();

  const returnTo = pickReturnTo(event.queryStringParameters?.returnTo);
  const state = randomUUID();
  // Cast service type: dynamo putOAuthState union didn't include "lastfm" — extend it there too.
  await putOAuthState(state, sub, "lastfm", returnTo);

  const { apiKey } = await getJsonSecret<{ apiKey: string }>(process.env.LASTFM_PARAM_NAME!);
  // Last.fm appends ?token=... to the callback URL. We pre-attach our state as a
  // query param; Last.fm will append &token=... after it.
  const callback = `${process.env.API_BASE_URL}/auth/lastfm/callback?state=${state}`;
  const url = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(callback)}`;
  return ok({ url });
};
