import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { config } from "../config";
import { fmtDate, fmtDuration, fmtKm } from "../lib/api";
import { PieChart } from "../components/PieChart";

interface Track {
  trackId: string;
  trackName: string;
  artistNames: string[];
  playedAt: string;
  imageUrl?: string;
}
interface GenreBreakdown { genre: string; percent: number; trackCount: number }
interface RunDetail {
  activityId: string;
  name?: string;
  startTime: string;
  elapsedSeconds: number;
  distanceMeters: number;
  type: string;
  musicSource?: "lastfm" | "spotify";
  tracks: Track[];
  genreBreakdown: GenreBreakdown[];
}

export function RunDetail() {
  const { id } = useParams();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${config.apiBaseUrl}/api/runs/${id}`)
      .then(async r => {
        if (r.status === 404) throw new Error("Run not found.");
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setRun(d); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <RunTopbar />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="bg-card border border-line rounded-md p-8 text-center max-w-md">
            <h2 className="text-lg font-semibold mb-2">{error}</h2>
            <p className="text-sm text-muted mb-4">This run might be private, deleted, or never processed by Stravify.</p>
            <Link to="/" className="text-brand hover:underline text-sm">Go home</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen flex flex-col">
        <RunTopbar />
        <div className="flex-1 flex items-center justify-center text-muted text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <RunTopbar />
      <main className="flex-1 max-w-[920px] w-full mx-auto px-4 sm:px-10 pt-6 sm:pt-10 pb-16">
        <header className="mb-6 sm:mb-8">
          <div className="text-xs text-dim mb-2">
            {fmtDate(run.startTime)}{run.musicSource && ` · music via ${run.musicSource}`}
          </div>
          <h1 className="text-[28px] sm:text-[40px] leading-[1.1] font-bold tracking-tight mb-3">{run.name || "Run"}</h1>
          <div className="flex gap-6 sm:gap-8 text-sm">
            <Stat label="Distance" value={fmtKm(run.distanceMeters || 0)} />
            <Stat label="Time" value={fmtDuration(run.elapsedSeconds || 0)} />
            <Stat label="Tracks" value={String(run.tracks.length)} />
          </div>
        </header>

        {run.genreBreakdown.length > 0 && (
          <section className="mt-2 mb-8 sm:mb-12">
            <h2 className="text-base font-semibold mb-4 sm:mb-5">Genre mix</h2>
            <div className="bg-card border border-line rounded-md p-4 sm:p-6">
              <PieChart
                data={run.genreBreakdown.map(g => ({ label: g.genre, value: g.percent }))}
              />
            </div>
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold mb-3">Tracks played</h2>
          {run.tracks.length === 0 ? (
            <div className="bg-card border border-line rounded-md px-4 py-6 text-sm text-muted">
              No tracks were recorded for this run.
            </div>
          ) : (
            <div className="border border-line rounded-md overflow-hidden">
              {run.tracks
                .slice()
                .sort((a, b) => (a.playedAt < b.playedAt ? -1 : 1))
                .map((t, i) => (
                  <div key={`${t.trackId}-${i}`}
                    className="flex items-center gap-3.5 px-4 py-3 bg-card border-t border-line first:border-t-0">
                    <TrackArt url={t.imageUrl} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-fg truncate">{t.trackName}</div>
                      <div className="text-xs text-muted truncate">{t.artistNames.join(", ")}</div>
                    </div>
                    <div className="text-xs text-dim tabular-nums shrink-0">{fmtClock(t.playedAt)}</div>
                  </div>
                ))}
            </div>
          )}
        </section>

        <footer className="mt-12 text-xs text-dim flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Built on Stravify — <Link to="/" className="text-brand hover:underline">stravify.net</Link>
          </span>
          <div className="flex items-center gap-4">
            <a
              href={`https://www.strava.com/activities/${run.activityId}`}
              target="_blank" rel="noopener noreferrer"
              className="font-bold"
              style={{ color: "#FC5200" }}
            >
              View on Strava
            </a>
            <img src="/powered-by-strava.svg" alt="Powered by Strava" className="h-5 w-auto opacity-80" />
          </div>
        </footer>
      </main>
    </div>
  );
}

function RunTopbar() {
  return (
    <header className="border-b border-line bg-page">
      <div className="max-w-[1080px] mx-auto px-6 sm:px-8 h-15 flex items-center justify-between">
        <Link to="/" className="font-bold text-base tracking-tight">
          Stravify<span className="text-brand">.</span>
        </Link>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-dim mb-0.5">{label}</div>
      <div className="text-base text-fg tabular-nums font-medium">{value}</div>
    </div>
  );
}

function fmtClock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function TrackArt({ url }: { url?: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        className="w-10 h-10 rounded-sm object-cover shrink-0 bg-card-2"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-sm bg-card-2 border border-line flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        className="w-4 h-4 text-brand" aria-hidden="true">
        <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}
