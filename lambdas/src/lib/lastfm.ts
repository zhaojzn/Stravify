import { createHash } from "crypto";
import { getJsonSecret } from "./secrets";

const API = "https://ws.audioscrobbler.com/2.0/";

interface LastfmSecret { apiKey: string; sharedSecret: string }
const getSecret = () => getJsonSecret<LastfmSecret>(process.env.LASTFM_SECRET_ID!);

function signParams(params: Record<string, string>, sharedSecret: string): string {
  // Last.fm signature: sort keys, concat key+value (no separators), append shared secret, md5.
  // Exclude `format` and `callback` from the signature input per Last.fm docs.
  const exclude = new Set(["format", "callback"]);
  const sortedKeys = Object.keys(params).filter(k => !exclude.has(k)).sort();
  const concat = sortedKeys.map(k => k + params[k]).join("");
  return createHash("md5").update(concat + sharedSecret).digest("hex");
}

export async function exchangeToken(token: string): Promise<{ sessionKey: string; username: string }> {
  const { apiKey, sharedSecret } = await getSecret();
  const params: Record<string, string> = {
    method: "auth.getSession",
    api_key: apiKey,
    token,
  };
  params.api_sig = signParams(params, sharedSecret);
  params.format = "json";

  const url = `${API}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lastfm auth.getSession ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  if (data.error) throw new Error(`lastfm auth.getSession error ${data.error}: ${data.message}`);
  return { sessionKey: data.session.key, username: data.session.name };
}

export interface LastfmTrack {
  trackId: string;
  trackName: string;
  artistNames: string[];
  artistIds: string[];
  playedAt: string;
  durationMs: number;
  imageUrl?: string;
}

export async function getRecentTracks(
  username: string,
  fromMs: number,
  toMs: number,
): Promise<LastfmTrack[]> {
  const { apiKey } = await getSecret();
  const out: LastfmTrack[] = [];
  let page = 1;
  // Last.fm uses Unix seconds for from/to.
  const from = Math.floor(fromMs / 1000);
  const to = Math.ceil(toMs / 1000);

  while (true) {
    const params = new URLSearchParams({
      method: "user.getrecenttracks",
      user: username,
      api_key: apiKey,
      from: String(from),
      to: String(to),
      limit: "200",
      page: String(page),
      format: "json",
    });
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`lastfm getrecenttracks ${res.status}`);
    const data: any = await res.json();
    if (data.error) throw new Error(`lastfm getrecenttracks error ${data.error}: ${data.message}`);

    const tracks = data.recenttracks?.track ?? [];
    for (const t of tracks) {
      // Skip the "now playing" entry which has no `date`
      if (t["@attr"]?.nowplaying || !t.date) continue;
      const artistName = typeof t.artist === "string" ? t.artist : (t.artist?.["#text"] || "");
      const trackName = t.name || "";
      const mbid = t.mbid;
      // Last.fm returns an `image` array; the largest entry is at the end.
      // It's frequently the same generic placeholder URL — caller can decide.
      const images = (t.image ?? []) as { "#text": string; size: string }[];
      const largest = images.find(i => i.size === "extralarge") ?? images[images.length - 1];
      const imageUrl = largest?.["#text"] && !largest["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
        ? largest["#text"]
        : undefined; // strip the well-known Last.fm "no image" placeholder
      out.push({
        trackId: mbid || `${artistName.toLowerCase()}|${trackName.toLowerCase()}`,
        trackName,
        artistNames: [artistName],
        artistIds: [artistName.toLowerCase()],
        playedAt: new Date(parseInt(t.date.uts, 10) * 1000).toISOString(),
        durationMs: 0,
        imageUrl,
      });
    }
    const totalPages = parseInt(data.recenttracks?.["@attr"]?.totalPages || "1", 10);
    if (page >= totalPages || tracks.length === 0) break;
    page += 1;
  }
  return out;
}

// Returns map of artistName-lowercase -> tags. Tags are the closest analog to
// Spotify genres on Last.fm. We grab the top 5.
export async function getArtistTags(artistNames: string[]): Promise<Map<string, string[]>> {
  const { apiKey } = await getSecret();
  const unique = [...new Set(artistNames.map(n => n.toLowerCase()))].slice(0, 30);
  const out = new Map<string, string[]>();
  // Last.fm has no batch endpoint. Fan out in parallel; Last.fm's published
  // rate limit is 5 req/s/IP but bursts are tolerated for small N.
  const results = await Promise.allSettled(unique.map(async (artist) => {
    const params = new URLSearchParams({
      method: "artist.gettoptags",
      artist,
      api_key: apiKey,
      autocorrect: "1",
      format: "json",
    });
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) return [artist, [] as string[]] as const;
    const data: any = await res.json();
    const tags = (data.toptags?.tag ?? [])
      .slice(0, 5)
      .map((t: any) => String(t.name).toLowerCase());
    return [artist, tags] as const;
  }));
  for (const r of results) {
    if (r.status === "fulfilled") out.set(r.value[0], r.value[1] as string[]);
  }
  return out;
}
