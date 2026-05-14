import { getStravaSecret } from "./secrets";
import { updateUser } from "./dynamo";

const API = "https://www.strava.com/api/v3";
const TOKEN_URL = "https://www.strava.com/oauth/token";

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{
  tokens: StravaTokens;
  athlete: { id: number; firstname?: string; lastname?: string };
}> {
  const { clientId, clientSecret } = await getStravaSecret();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return {
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    },
    athlete: data.athlete,
  };
}

async function refresh(tokens: StravaTokens): Promise<StravaTokens> {
  const { clientId, clientSecret } = await getStravaSecret();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body });
  if (!res.ok) throw new Error(`Strava refresh failed: ${res.status}`);
  const data: any = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  };
}

export async function getFreshTokens(sub: string, current: StravaTokens): Promise<StravaTokens> {
  const now = Math.floor(Date.now() / 1000);
  if (current.expiresAt > now + 60) return current;
  const fresh = await refresh(current);
  await updateUser(sub, { stravaTokens: fresh });
  return fresh;
}

export async function getActivity(token: string, activityId: number) {
  const res = await fetch(`${API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava getActivity ${activityId}: ${res.status}`);
  return res.json() as Promise<any>;
}

export async function listRecentActivities(token: string, perPage = 30): Promise<any[]> {
  const res = await fetch(`${API}/athlete/activities?per_page=${perPage}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Strava list activities: ${res.status}`);
  return res.json() as Promise<any[]>;
}

export interface ActivityStreams {
  time?: number[];      // seconds from start
  distance?: number[];  // meters from start
  velocity?: number[];  // m/s
}

export async function getActivityStreams(
  token: string,
  activityId: number,
  keys = ["time", "distance", "velocity_smooth"],
): Promise<ActivityStreams> {
  const url = `${API}/activities/${activityId}/streams?keys=${keys.join(",")}&key_by_type=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    // Streams may not exist (e.g. activities entered manually with no GPS).
    if (res.status === 404) return {};
    throw new Error(`Strava streams ${activityId}: ${res.status}`);
  }
  const data: any = await res.json();
  return {
    time: data.time?.data,
    distance: data.distance?.data,
    velocity: data.velocity_smooth?.data,
  };
}

export async function updateActivityDescription(token: string, activityId: number, description: string) {
  const res = await fetch(`${API}/activities/${activityId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`Strava update ${activityId}: ${res.status} ${await res.text()}`);
  return res.json();
}
