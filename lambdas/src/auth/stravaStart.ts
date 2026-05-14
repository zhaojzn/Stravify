import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "crypto";
import { putOAuthState } from "../lib/dynamo";
import { getStravaSecret } from "../lib/secrets";
import { pickReturnTo } from "../lib/frontends";
import { getUserSub, ok, unauthorized } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();

  const returnTo = pickReturnTo(event.queryStringParameters?.returnTo);
  const { clientId } = await getStravaSecret();
  const state = randomUUID();
  await putOAuthState(state, sub, "strava", returnTo);

  const redirectUri = `${process.env.API_BASE_URL}/auth/strava/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    approval_prompt: "auto",
    scope: "read,activity:read_all,activity:write",
    state,
  });
  return ok({ url: `https://www.strava.com/oauth/authorize?${params}` });
};
