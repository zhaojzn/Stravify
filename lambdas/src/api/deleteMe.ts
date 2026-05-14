import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  deleteAllActivitiesForUser, deleteAllSongPlaysForUser, deleteUser,
} from "../lib/dynamo";
import { getUserSub, ok, unauthorized } from "../lib/response";

// Wipes all of this user's data (DynamoDB only). The caller is expected to
// also delete their Cognito user via the Cognito SDK from the browser after
// this returns successfully.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();

  await deleteAllSongPlaysForUser(sub);
  await deleteAllActivitiesForUser(sub);
  await deleteUser(sub);

  return ok({ deleted: true });
};
