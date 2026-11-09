import { getSpotifySecret } from "./secrets";
import { updateUser } from "./dynamo";

const API = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds
}

function basicAuth(id: string, secret: string) {
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{
  tokens: SpotifyTokens;
  profile: { id: string; display_name?: string };
}> {
  const { clientId, clientSecret } = await getSpotifySecret();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Spotify token exchange: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  const tokens: SpotifyTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
  const profile = await getProfile(tokens.accessToken);
  return { tokens, profile };
}

async function refresh(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  const { clientId, clientSecret } = await getSpotifySecret();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Spotify refresh: ${res.status}`);
  const data: any = await res.json();
  return {
    accessToken: data.access_token,
    // Spotify sometimes omits a new refresh token; keep the old one if so.
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export async function getFreshTokens(sub: string, current: SpotifyTokens): Promise<SpotifyTokens> {
  const now = Math.floor(Date.now() / 1000);
  if (current.expiresAt > now + 60) return current;
  const fresh = await refresh(current);
  await updateUser(sub, { spotifyTokens: fresh });
  return fresh;
}

export async function getProfile(token: string) {
  const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Spotify /me: ${res.status}`);
  return res.json() as Promise<{ id: string; display_name?: string }>;
}

export interface RecentTrack {
  trackId: string;
  trackName: string;
  artistIds: string[];
  artistNames: string[];
  playedAt: string;
  durationMs: number;
  imageUrl?: string;
}

// after: epoch ms (Spotify uses ms, not seconds)
export async function getRecentlyPlayed(token: string, afterMs: number): Promise<RecentTrack[]> {
  const url = `${API}/me/player/recently-played?limit=50&after=${afterMs}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Spotify recently-played: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return (data.items as any[]).map(item => ({
    trackId: item.track.id,
    trackName: item.track.name,
    artistIds: item.track.artists.map((a: any) => a.id),
    artistNames: item.track.artists.map((a: any) => a.name),
    playedAt: item.played_at,
    durationMs: item.track.duration_ms,
    // Spotify's album.images is sorted largest-first.
    imageUrl: item.track.album?.images?.[0]?.url,
  }));
}

// Client-credentials token, cached in memory across warm Lambda invocations.
// Used for public-data endpoints (search, artists) that don't need user auth.
let appToken: { token: string; expiresAt: number } | null = null;
let pendingAppToken: Promise<string> | null = null;

async function getAppToken(): Promise<string> {
  if (appToken && appToken.expiresAt > Date.now()) return appToken.token;
  if (!pendingAppToken) pendingAppToken = fetchAppToken().finally(() => { pendingAppToken = null; });
  return pendingAppToken;
}

async function fetchAppToken(): Promise<string> {
  const { clientId, clientSecret } = await getSpotifySecret();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Spotify client_credentials: ${res.status}`);
  const data: any = await res.json();
  appToken = {
    token: data.access_token,
    // Expire ~1 minute early so we don't try to use a token mid-flight.
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return appToken.token;
}

const artworkCache = new Map<string, { until: number; value: { imageUrl: string; spotifyUrl: string } | null }>();
let artworkBlockedUntil = 0;
const normalized = (value: unknown) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const artworkKey = (track: any) => JSON.stringify([String(track.trackName || "").toLowerCase(), String(track.artistNames?.[0] || "").toLowerCase()]);

async function resolveArtwork(track: any) {
  const key = artworkKey(track);
  const cached = artworkCache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  if (!track.trackName || !track.artistNames?.[0] || artworkBlockedUntil > Date.now()) return null;
  try {
    const token = await getAppToken();
    const quote = (s: string) => s.replace(/["\\]/g, " ");
    const params = new URLSearchParams({
      q: `track:"${quote(track.trackName)}" artist:"${quote(track.artistNames[0])}"`,
      type: "track", market: "CA", limit: "5",
    });
    const response = await fetch(`${API}/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      if (response.status === 401) appToken = null;
      if (response.status === 429) artworkBlockedUntil = Date.now() + Math.max(60, Number(response.headers.get("Retry-After")) || 60) * 1000;
      return null;
    }
    const data: any = await response.json();
    const item = (data.tracks?.items || []).find((item: any) =>
      normalized(item.name) === normalized(track.trackName) &&
      item.artists?.some((a: any) => normalized(a.name) === normalized(track.artistNames[0]))
    );
    const images = item?.album?.images || [];
    const image = images.find((image: any) => image.width >= 160 && image.width <= 320) || images[0];
    const url = image?.url ? new URL(image.url) : null;
    const value = url?.protocol === "https:" && url.hostname === "i.scdn.co" && /^[a-zA-Z0-9]{22}$/.test(item?.id)
      ? { imageUrl: url.href, spotifyUrl: `https://open.spotify.com/track/${item.id}` }
      : null;
    artworkCache.set(key, { value, until: Date.now() + (value ? 6 * 60 * 60_000 : 5 * 60_000) });
    if (artworkCache.size > 500) artworkCache.delete(artworkCache.keys().next().value!);
    return value;
  } catch {
    return null;
  }
}

export async function getRunArtwork(tracks: any[]) {
  const unique = [...new Map(tracks.map(track => [artworkKey(track), track])).values()];
  const entries: { key: string; imageUrl: string; spotifyUrl: string }[] = [];
  let next = 0;
  const deadline = Date.now() + 12_000;
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (next < unique.length && Date.now() < deadline) {
      const track = unique[next++];
      const art = await resolveArtwork(track);
      if (art) entries.push({ key: artworkKey(track), ...art });
    }
  }));
  return { version: 1, fetchedAt: new Date().toISOString(), complete: next >= unique.length, entries };
}

// Look up artists by name (no auth required beyond app credentials). Used for
// the Last.fm path where we only have artist names, not Spotify IDs.
// Returns a Map keyed by lower-cased name, with the artist's genres array.
export async function getArtistsGenresByNames(names: string[]): Promise<Map<string, string[]>> {
  const token = await getAppToken();
  const unique = [...new Set(names.map(n => n.toLowerCase()))].slice(0, 30);
  const out = new Map<string, string[]>();
  const results = await Promise.allSettled(unique.map(async (name) => {
    const params = new URLSearchParams({ q: name, type: "artist", limit: "1" });
    const res = await fetch(`${API}/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [name, [] as string[]] as const;
    const data: any = await res.json();
    const top = data.artists?.items?.[0];
    return [name, (top?.genres ?? []) as string[]] as const;
  }));
  for (const r of results) {
    if (r.status === "fulfilled") out.set(r.value[0], r.value[1] as string[]);
  }
  return out;
}

export async function getArtistsGenres(token: string, artistIds: string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(artistIds)];
  const out = new Map<string, string[]>();
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const res = await fetch(`${API}/artists?ids=${batch.join(",")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Spotify artists: ${res.status}`);
    const data: any = await res.json();
    for (const a of data.artists ?? []) {
      out.set(a.id, a.genres ?? []);
    }
  }
  return out;
}
