import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { consumeOAuthState, getUser, putUser, updateUser } from "../lib/dynamo";
import { exchangeToken } from "../lib/lastfm";
import { redirect, bad } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const params = event.queryStringParameters || {};
  const token = params.token;
  const state = params.state;
  if (!token || !state) return bad("missing token/state");

  const record = await consumeOAuthState(state);
  if (!record || record.service !== "lastfm") return bad("invalid state");
  const appUrl = record.returnTo;

  const { sessionKey, username } = await exchangeToken(token);

  const existing = await getUser(record.cognitoSub);
  if (!existing) {
    await putUser({
      cognitoSub: record.cognitoSub,
      createdAt: new Date().toISOString(),
      lastfmUsername: username,
      lastfmSessionKey: sessionKey,
    });
  } else {
    await updateUser(record.cognitoSub, {
      lastfmUsername: username,
      lastfmSessionKey: sessionKey,
    });
  }
  return redirect(`${appUrl}/dashboard?linked=lastfm`);
};
