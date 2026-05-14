import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand,
  QueryCommand, DeleteCommand, BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";

const raw = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLES = {
  users: process.env.USERS_TABLE!,
  activities: process.env.ACTIVITIES_TABLE!,
  songPlays: process.env.SONGPLAYS_TABLE!,
  oauthState: process.env.OAUTH_STATE_TABLE!,
};

export const STRAVA_ATHLETE_INDEX = "byStravaAthleteId";

export async function getUser(sub: string) {
  const r = await ddb.send(new GetCommand({
    TableName: TABLES.users, Key: { cognitoSub: sub },
  }));
  return r.Item;
}

export async function putUser(item: Record<string, unknown>) {
  await ddb.send(new PutCommand({ TableName: TABLES.users, Item: item }));
}

export async function updateUser(sub: string, patch: Record<string, unknown>) {
  const sets: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let i = 0;
  for (const [k, v] of Object.entries(patch)) {
    const nk = `#k${i}`, vk = `:v${i}`;
    names[nk] = k; values[vk] = v;
    sets.push(`${nk} = ${vk}`);
    i++;
  }
  await ddb.send(new UpdateCommand({
    TableName: TABLES.users,
    Key: { cognitoSub: sub },
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

export async function removeUserAttrs(sub: string, attrs: string[]) {
  if (attrs.length === 0) return;
  const names: Record<string, string> = {};
  const removes: string[] = [];
  attrs.forEach((a, i) => {
    const nk = `#k${i}`;
    names[nk] = a;
    removes.push(nk);
  });
  await ddb.send(new UpdateCommand({
    TableName: TABLES.users,
    Key: { cognitoSub: sub },
    UpdateExpression: "REMOVE " + removes.join(", "),
    ExpressionAttributeNames: names,
  }));
}

export async function deleteUser(sub: string) {
  await ddb.send(new DeleteCommand({
    TableName: TABLES.users, Key: { cognitoSub: sub },
  }));
}

async function batchDelete(table: string, keys: Record<string, unknown>[]) {
  for (let i = 0; i < keys.length; i += 25) {
    const batch = keys.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [table]: batch.map(Key => ({ DeleteRequest: { Key } })) },
    }));
  }
}

export async function deleteAllActivitiesForUser(sub: string) {
  let lek: any = undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLES.activities,
      KeyConditionExpression: "cognitoSub = :s",
      ExpressionAttributeValues: { ":s": sub },
      ProjectionExpression: "cognitoSub, activityId",
      ExclusiveStartKey: lek,
    }));
    await batchDelete(TABLES.activities, (r.Items ?? []).map(i => ({
      cognitoSub: i.cognitoSub, activityId: i.activityId,
    })));
    lek = r.LastEvaluatedKey;
  } while (lek);
}

export async function deleteAllSongPlaysForUser(sub: string) {
  let lek: any = undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLES.songPlays,
      KeyConditionExpression: "cognitoSub = :s",
      ExpressionAttributeValues: { ":s": sub },
      ProjectionExpression: "cognitoSub, sortKey",
      ExclusiveStartKey: lek,
    }));
    await batchDelete(TABLES.songPlays, (r.Items ?? []).map(i => ({
      cognitoSub: i.cognitoSub, sortKey: i.sortKey,
    })));
    lek = r.LastEvaluatedKey;
  } while (lek);
}

export async function findUserByStravaAthlete(athleteId: number) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLES.users,
    IndexName: STRAVA_ATHLETE_INDEX,
    KeyConditionExpression: "stravaAthleteId = :a",
    ExpressionAttributeValues: { ":a": athleteId },
    Limit: 1,
  }));
  return r.Items?.[0];
}

export async function putOAuthState(
  state: string,
  sub: string,
  service: "strava" | "spotify" | "lastfm",
  returnTo: string,
) {
  const ttl = Math.floor(Date.now() / 1000) + 600; // 10 min
  await ddb.send(new PutCommand({
    TableName: TABLES.oauthState,
    Item: { state, cognitoSub: sub, service, returnTo, ttl },
  }));
}

export async function consumeOAuthState(state: string) {
  const got = await ddb.send(new GetCommand({
    TableName: TABLES.oauthState, Key: { state },
  }));
  if (!got.Item) return null;
  await ddb.send(new DeleteCommand({
    TableName: TABLES.oauthState, Key: { state },
  }));
  return got.Item as {
    state: string;
    cognitoSub: string;
    service: "strava" | "spotify" | "lastfm";
    returnTo: string;
  };
}

export async function putActivity(item: Record<string, unknown>) {
  await ddb.send(new PutCommand({ TableName: TABLES.activities, Item: item }));
}

export async function listActivities(sub: string, limit = 25) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLES.activities,
    KeyConditionExpression: "cognitoSub = :s",
    ExpressionAttributeValues: { ":s": sub },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return r.Items ?? [];
}

export async function getActivity(sub: string, activityId: string) {
  const r = await ddb.send(new GetCommand({
    TableName: TABLES.activities, Key: { cognitoSub: sub, activityId },
  }));
  return r.Item;
}

export async function getActivityById(activityId: string) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLES.activities,
    IndexName: "byActivityId",
    KeyConditionExpression: "activityId = :a",
    ExpressionAttributeValues: { ":a": activityId },
    Limit: 1,
  }));
  return r.Items?.[0];
}

export async function recordSongPlay(item: Record<string, unknown>) {
  await ddb.send(new PutCommand({ TableName: TABLES.songPlays, Item: item }));
}

export async function listTopTracks(sub: string, limit = 50) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLES.songPlays,
    KeyConditionExpression: "cognitoSub = :s",
    ExpressionAttributeValues: { ":s": sub },
    Limit: 1000,
  }));
  const counts = new Map<string, { trackId: string; trackName: string; artistName: string; playCount: number }>();
  for (const it of r.Items ?? []) {
    const key = it.trackId as string;
    const cur = counts.get(key);
    if (cur) cur.playCount += 1;
    else counts.set(key, {
      trackId: key,
      trackName: it.trackName as string,
      artistName: it.artistName as string,
      playCount: 1,
    });
  }
  return [...counts.values()]
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, limit);
}
