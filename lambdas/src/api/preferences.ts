import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { updateUser } from "../lib/dynamo";
import { getUserSub, ok, unauthorized, bad } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();

  const body = JSON.parse(event.body || "{}");
  if (typeof body.autoPublish !== "boolean") return bad("autoPublish must be a boolean");

  await updateUser(sub, { autoPublish: body.autoPublish });
  return ok({ autoPublish: body.autoPublish });
};
