import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getActivity } from "../lib/dynamo";
import { getUserSub, ok, unauthorized, notFound, bad } from "../lib/response";

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();
  const id = event.pathParameters?.id;
  if (!id) return bad("missing id");
  const item = await getActivity(sub, id);
  if (!item) return notFound();
  return ok(item);
};
