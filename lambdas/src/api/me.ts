import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getUser, putUser } from "../lib/dynamo";
import { getUserSub, getUserEmail, ok, unauthorized } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  const email = getUserEmail(event);
  if (!sub) return unauthorized();

  let user = await getUser(sub);
  if (!user) {
    user = { cognitoSub: sub, email, createdAt: new Date().toISOString() };
    await putUser(user);
  }
  return ok({
    cognitoSub: sub,
    email: user.email ?? email,
    stravaLinked: !!user.stravaTokens,
    stravaAthleteName: user.stravaAthleteName,
    spotifyLinked: !!user.spotifyTokens,
    spotifyUserName: user.spotifyUserName,
    lastfmLinked: !!user.lastfmUsername,
    lastfmUsername: user.lastfmUsername,
  });
};
