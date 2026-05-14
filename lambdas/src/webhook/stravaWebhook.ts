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
    console.log("webhook event:", JSON.stringify(body));

    if (body.object_type !== "activity") {
      console.log(`ignored: object_type=${body.object_type}`);
      return ok({ ignored: "not an activity" });
    }
    if (body.aspect_type !== "create" && body.aspect_type !== "update") {
      console.log(`ignored: aspect_type=${body.aspect_type}`);
      return ok({ ignored: body.aspect_type });
    }

    const user = await findUserByStravaAthlete(body.owner_id);
    if (!user) {
      console.log(`ignored: no user for athlete ${body.owner_id}`);
      return ok({ ignored: "unknown athlete" });
    }
    if (!user.spotifyTokens && !user.lastfmUsername) {
      console.log(`ignored: user ${user.cognitoSub} has no music source`);
      return ok({ ignored: "no music source linked" });
    }

    const autoPublish = user.autoPublish !== false; // default ON
    console.log(`processing activity ${body.object_id} for user ${user.cognitoSub} (autoPublish=${autoPublish})`);
    const result = await processActivity(user, body.object_id, { writeToStrava: autoPublish });
    console.log("processActivity result:", JSON.stringify(result));
    return ok(result);
  } catch (e) {
    console.error("webhook error", e);
    return ok({ swallowed: (e as Error).message });
  }
};
