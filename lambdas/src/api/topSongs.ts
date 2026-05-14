import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { listTopTracks } from "../lib/dynamo";
import { getUserSub, ok, unauthorized } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();
  const items = await listTopTracks(sub, 25);
  return ok({ items });
};
