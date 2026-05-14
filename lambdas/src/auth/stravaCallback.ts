import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { consumeOAuthState, getUser, putUser, updateUser } from "../lib/dynamo";
import { exchangeCode } from "../lib/strava";
import { redirect, bad } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const params = event.queryStringParameters || {};
  const code = params.code;
  const state = params.state;
  if (!code || !state) return bad("missing code/state");

  const record = await consumeOAuthState(state);
  if (!record || record.service !== "strava") return bad("invalid state");
  const appUrl = record.returnTo;

  const redirectUri = `${process.env.API_BASE_URL}/auth/strava/callback`;
  const { tokens, athlete } = await exchangeCode(code, redirectUri);

  const existing = await getUser(record.cognitoSub);
  if (!existing) {
    await putUser({
      cognitoSub: record.cognitoSub,
      createdAt: new Date().toISOString(),
      stravaAthleteId: athlete.id,
      stravaAthleteName: [athlete.firstname, athlete.lastname].filter(Boolean).join(" "),
      stravaTokens: tokens,
    });
  } else {
    await updateUser(record.cognitoSub, {
      stravaAthleteId: athlete.id,
      stravaAthleteName: [athlete.firstname, athlete.lastname].filter(Boolean).join(" "),
      stravaTokens: tokens,
    });
  }

  return redirect(`${appUrl}/dashboard?linked=strava`);
};
