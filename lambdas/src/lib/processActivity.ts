import { putActivity, recordSongPlay } from "./dynamo";
import * as strava from "./strava";
import * as spotify from "./spotify";
import * as lastfm from "./lastfm";
import { primaryCategoryForArtist, bucket, BreakdownItem } from "./genres";

// URL prefix used to detect + strip a previously-written Stravify block when
// re-publishing. The block itself is just the run URL + a one-line genre
// summary, no header text.
export const STRAVIFY_LINK_PREFIX = "https://jason.zhao.io/run/";

// Older runs were annotated while the app lived at stravify.net. We still need
// to detect + strip those blocks when re-publishing so we don't leave a stale
// stravify.net link sitting above the new jason.zhao.io one.
const LEGACY_LINK_PREFIXES = [
  "https://stravify.net/run/",
  "https://www.stravify.net/run/",
];

// All run-link prefixes we recognize, current first.
const ALL_LINK_PREFIXES = [STRAVIFY_LINK_PREFIX, ...LEGACY_LINK_PREFIXES];

// True if the description already carries a Stravify block (any known domain).
export function hasStravifyBlock(desc: string): boolean {
  return ALL_LINK_PREFIXES.some(p => desc.includes(p));
}

export interface ProcessResult {
  activityId: number;
  status: "annotated" | "no-tracks" | "already-annotated" | "not-a-run" | "no-music-source";
  trackCount?: number;
  source?: "lastfm" | "spotify";
}

interface MusicTrack {
  trackId: string;
  trackName: string;
  artistIds: string[];
  artistNames: string[];
  playedAt: string;
  durationMs: number;
  imageUrl?: string;
}

async function fetchTracksAndGenres(
  user: any,
  startMs: number,
  endMs: number,
): Promise<{ source: "lastfm" | "spotify"; tracks: MusicTrack[]; genresByArtist: Map<string, string[]> } | null> {
  // Prefer Last.fm — full history, no 50-track ceiling.
  if (user.lastfmUsername) {
    const tracks = await lastfm.getRecentTracks(user.lastfmUsername, startMs, endMs + 5 * 60_000);
    if (tracks.length === 0) return { source: "lastfm", tracks: [], genresByArtist: new Map() };
    // Use Spotify's curated artist genres via Client-Credentials (no user
    // Spotify link required). Falls back to Last.fm tags for any artist
    // Spotify doesn't recognize.
    const artistNames = tracks.flatMap(t => t.artistNames);
    const fromSpotify = await spotify.getArtistsGenresByNames(artistNames).catch(() => new Map<string, string[]>());
    const missing = artistNames.filter(n => (fromSpotify.get(n.toLowerCase()) ?? []).length === 0);
    const fromLastfm = missing.length > 0
      ? await lastfm.getArtistTags(missing).catch(() => new Map<string, string[]>())
      : new Map<string, string[]>();
    const genresByArtist = new Map<string, string[]>();
    for (const name of new Set(artistNames.map(n => n.toLowerCase()))) {
      const spot = fromSpotify.get(name) ?? [];
      if (spot.length > 0) genresByArtist.set(name, spot);
      else genresByArtist.set(name, fromLastfm.get(name) ?? []);
    }
    return { source: "lastfm", tracks, genresByArtist };
  }
  if (user.spotifyTokens) {
    const sub = user.cognitoSub;
    const tokens = await spotify.getFreshTokens(sub, user.spotifyTokens);
    const recent = await spotify.getRecentlyPlayed(tokens.accessToken, startMs - 1);
    const tracks = recent.filter(t => {
      const at = new Date(t.playedAt).getTime();
      return at >= startMs && at <= endMs + 5 * 60_000;
    });
    if (tracks.length === 0) return { source: "spotify", tracks: [], genresByArtist: new Map() };
    const genresByArtist = await spotify.getArtistsGenres(tokens.accessToken, tracks.flatMap(t => t.artistIds));
    return { source: "spotify", tracks, genresByArtist };
  }
  return null;
}

export async function processActivity(
  user: any,
  activityId: number,
  opts: { force?: boolean; writeToStrava?: boolean } = {},
): Promise<ProcessResult> {
  const writeToStrava = opts.writeToStrava !== false; // default true
  const sub: string = user.cognitoSub;
  const stravaTokens = await strava.getFreshTokens(sub, user.stravaTokens);
  const activity = await strava.getActivity(stravaTokens.accessToken, activityId);

  if (activity.type !== "Run") return { activityId, status: "not-a-run" };
  if (writeToStrava && !opts.force && typeof activity.description === "string" && hasStravifyBlock(activity.description)) {
    return { activityId, status: "already-annotated" };
  }

  const startMs = new Date(activity.start_date).getTime();
  const endMs = startMs + (activity.elapsed_time as number) * 1000;

  const music = await fetchTracksAndGenres(user, startMs, endMs);
  if (!music) return { activityId, status: "no-music-source" };

  if (music.tracks.length === 0) {
    await putActivity({
      cognitoSub: sub,
      activityId: String(activityId),
      name: activity.name,
      startTime: activity.start_date,
      elapsedSeconds: activity.elapsed_time,
      distanceMeters: activity.distance,
      type: activity.type,
      tracks: [],
      genreBreakdown: [],
      musicSource: music.source,
      processedAt: new Date().toISOString(),
    });
    return { activityId, status: "no-tracks", source: music.source, trackCount: 0 };
  }

  const breakdown = computeGenreBreakdown(music.tracks, music.genresByArtist);
  const frontUrl = process.env.DEFAULT_FRONTEND_URL!;
  const runUrl = `${frontUrl}/run/${activityId}`;

  const now = new Date().toISOString();
  let publishedAt: string | undefined;
  if (writeToStrava) {
    const baseDescription = stripStravifyBlock(activity.description);
    const description = buildDescription(baseDescription, runUrl, breakdown);
    await strava.updateActivityDescription(stravaTokens.accessToken, activityId, description);
    publishedAt = now;
  }

  // Pull the pace chart streams (time, distance, velocity) and downsample
  // so the DynamoDB item stays small. Failures here shouldn't block the rest.
  let streams: { time: number[]; distance: number[]; velocity: number[]; heartrate?: number[] } | undefined;
  try {
    const raw = await strava.getActivityStreams(stravaTokens.accessToken, activityId);
    streams = downsampleStreams(raw, 150);
  } catch (e) {
    console.warn("streams fetch failed", e);
  }

  await putActivity({
    cognitoSub: sub,
    activityId: String(activityId),
    name: activity.name,
    startTime: activity.start_date,
    elapsedSeconds: activity.elapsed_time,
    distanceMeters: activity.distance,
    type: activity.type,
    tracks: music.tracks,
    genreBreakdown: breakdown,
    musicSource: music.source,
    streams,
    processedAt: now,
    publishedAt,
    publishedUrl: publishedAt ? runUrl : undefined,
  });

  for (const t of music.tracks) {
    await recordSongPlay({
      cognitoSub: sub,
      sortKey: `${t.trackId}#${t.playedAt}`,
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistNames.join(", "),
      playedAt: t.playedAt,
      activityId: String(activityId),
      source: music.source,
    });
  }
  return { activityId, status: "annotated", source: music.source, trackCount: music.tracks.length };
}

function computeGenreBreakdown(
  tracks: MusicTrack[],
  genresByArtist: Map<string, string[]>,
): BreakdownItem[] {
  // Resolve each artist to a single major category once, then count tracks
  // per category (winner-takes-all per artist).
  const categoryByArtist = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const primary = t.artistIds[0];
    let category = categoryByArtist.get(primary);
    if (category === undefined) {
      category = primaryCategoryForArtist(genresByArtist.get(primary) ?? []);
      categoryByArtist.set(primary, category);
    }
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  const all: BreakdownItem[] = [...counts.entries()]
    .map(([genre, n]) => ({ genre, trackCount: n, percent: Math.round((n / total) * 100) }))
    .sort((a, b) => b.percent - a.percent);
  return bucket(all, 8);
}

function stripStravifyBlock(desc: string | null | undefined): string {
  if (!desc) return "";
  // Old-format block had a "🎵 Don't be afraid…" header line above the URL;
  // strip from that line if present, otherwise from the run URL itself.
  // The run URL may use the current jason.zhao.io domain or a legacy
  // stravify.net one — take whichever marker appears earliest.
  const markers = ["🎵 Don't be afraid", ...ALL_LINK_PREFIXES];
  const idx = markers
    .map(m => desc.indexOf(m))
    .filter(i => i >= 0)
    .reduce((min, i) => (min < 0 || i < min ? i : min), -1);
  if (idx < 0) return desc;
  return desc.slice(0, idx).replace(/\n+$/, "");
}

function downsampleStreams(raw: strava.ActivityStreams, targetPoints: number): {
  time: number[]; distance: number[]; velocity: number[]; heartrate?: number[];
} | undefined {
  const { time, distance, velocity, heartrate } = raw;
  if (!time || !distance || !velocity) return undefined;
  const len = Math.min(time.length, distance.length, velocity.length);
  if (len < 2) return undefined;
  // Heart rate is optional — only carry it when it's the same length as the
  // other streams (i.e. the run was recorded with an HR monitor).
  const hasHr = Array.isArray(heartrate) && heartrate.length >= len;
  if (len <= targetPoints) {
    return {
      time: time.slice(0, len),
      distance: distance.slice(0, len),
      velocity: velocity.slice(0, len),
      ...(hasHr ? { heartrate: heartrate!.slice(0, len) } : {}),
    };
  }
  const step = len / targetPoints;
  const t: number[] = [], d: number[] = [], v: number[] = [], hr: number[] = [];
  for (let i = 0; i < targetPoints; i++) {
    const idx = Math.min(len - 1, Math.floor(i * step));
    t.push(time[idx]);
    d.push(distance[idx]);
    v.push(velocity[idx]);
    if (hasHr) hr.push(heartrate![idx]);
  }
  return { time: t, distance: d, velocity: v, ...(hasHr ? { heartrate: hr } : {}) };
}

function buildDescription(
  existing: string | null | undefined,
  runUrl: string,
  breakdown: BreakdownItem[],
): string {
  const top = breakdown.slice(0, 4).filter(b => b.percent > 0);
  const summary = top.map(b => `${b.percent}% ${b.genre}`).join(" · ");
  const block = [runUrl, summary].filter(Boolean).join("\n");
  return existing ? `${existing}\n\n${block}` : block;
}
