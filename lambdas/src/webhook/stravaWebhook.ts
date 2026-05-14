import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { findUserByStravaAthlete } from "../lib/dynamo";
import { getStravaSecret } from "../lib/secrets";
import { processActivity } from "../lib/processActivity";
import { ok, bad, json } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;

  if (method === "GET") {
    const params = event.queryStringParameters || {};
    const secret = await getStravaSecret();
    if (params["hub.mode"] === "subscribe" && params["hub.verify_token"] === secret.verifyToken) {
      return json(200, { "hub.challenge": params["hub.challenge"] });
    }
    return bad("verification failed");
  }
  if (method !== "POST") return bad("method not allowed");

  try {
    const body = JSON.parse(event.body || "{}");
    if (body.object_type !== "activity") return ok({ ignored: "not an activity" });
    if (body.aspect_type !== "create" && body.aspect_type !== "update") return ok({ ignored: body.aspect_type });

    const user = await findUserByStravaAthlete(body.owner_id);
    if (!user) return ok({ ignored: "unknown athlete" });
    if (!user.spotifyTokens) return ok({ ignored: "spotify not linked" });

    const result = await processActivity(user, body.object_id);
    return ok(result);
  } catch (e) {
    // Always return 200 so Strava doesn't retry endlessly.
    console.error("webhook error", e);
    return ok({ swallowed: (e as Error).message });
  }
};
