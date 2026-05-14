import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getUser, getActivity, putActivity } from "../lib/dynamo";
import * as strava from "../lib/strava";
import { STRAVIFY_MARKER } from "../lib/processActivity";
import { getUserSub, ok, unauthorized, notFound, bad } from "../lib/response";

// Replace the Stravify block in the Strava description with a short summary
// + a public URL pointing at the Stravify run page.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const sub = getUserSub(event);
  if (!sub) return unauthorized();
  const id = event.pathParameters?.id;
  if (!id) return bad("missing id");

  const user = await getUser(sub);
  if (!user?.stravaTokens) return bad("Strava not linked");

  const activity = await getActivity(sub, id);
  if (!activity) return notFound();

  const frontUrl = process.env.DEFAULT_FRONTEND_URL!;
  const runUrl = `${frontUrl}/run/${id}`;

  const top = (activity.genreBreakdown as any[] | undefined)?.slice(0, 4) ?? [];
  const teaser = top.length > 0
    ? top.map(g => `${g.percent}% ${g.genre}`).join(" · ")
    : `${(activity.tracks as any[] | undefined)?.length ?? 0} tracks`;

  const block = [STRAVIFY_MARKER, runUrl, teaser].join("\n");

  // Strip any existing Stravify block before re-writing.
  const tokens = await strava.getFreshTokens(sub, user.stravaTokens);
  const live = await strava.getActivity(tokens.accessToken, Number(id));
  const stripped = stripStravifyBlock(live.description);
  const newDesc = stripped ? `${stripped}\n\n${block}` : block;

  await strava.updateActivityDescription(tokens.accessToken, Number(id), newDesc);

  const publishedAt = new Date().toISOString();
  await putActivity({ ...activity, publishedAt, publishedUrl: runUrl });

  return ok({ publishedAt, url: runUrl });
};

function stripStravifyBlock(desc: string | null | undefined): string {
  if (!desc) return "";
  const idx = desc.indexOf(STRAVIFY_MARKER);
  if (idx < 0) return desc;
  return desc.slice(0, idx).replace(/\n+$/, "");
}
