import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "crypto";
import { putOAuthState } from "../lib/dynamo";
import { getSpotifySecret } from "../lib/secrets";
import { pickReturnTo } from "../lib/frontends";
import { getUserSub, ok, unauthorized } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();

  const returnTo = pickReturnTo(event.queryStringParameters?.returnTo);
  const { clientId } = await getSpotifySecret();
  const state = randomUUID();
  await putOAuthState(state, sub, "spotify", returnTo);

  const redirectUri = `${process.env.API_BASE_URL}/auth/spotify/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "user-read-recently-played user-read-private",
    state,
  });
  return ok({ url: `https://accounts.spotify.com/authorize?${params}` });
};
