import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { consumeOAuthState, getUser, putUser, updateUser } from "../lib/dynamo";
import { exchangeCode } from "../lib/spotify";
import { redirect, bad } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const params = event.queryStringParameters || {};
  const code = params.code;
  const state = params.state;
  if (!code || !state) return bad("missing code/state");

  const record = await consumeOAuthState(state);
  if (!record || record.service !== "spotify") return bad("invalid state");
  const appUrl = record.returnTo;

  const redirectUri = `${process.env.API_BASE_URL}/auth/spotify/callback`;
  const { tokens, profile } = await exchangeCode(code, redirectUri);

  const existing = await getUser(record.cognitoSub);
  if (!existing) {
    await putUser({
      cognitoSub: record.cognitoSub,
      createdAt: new Date().toISOString(),
      spotifyUserId: profile.id,
      spotifyUserName: profile.display_name,
      spotifyTokens: tokens,
    });
  } else {
    await updateUser(record.cognitoSub, {
      spotifyUserId: profile.id,
      spotifyUserName: profile.display_name,
      spotifyTokens: tokens,
    });
  }

  return redirect(`${appUrl}/dashboard?linked=spotify`);
};
