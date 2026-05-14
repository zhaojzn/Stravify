import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getValidTokens, signOut, getStoredEmail } from "../lib/auth";
import { api, fmtDate, fmtDuration, fmtKm } from "../lib/api";

type Tab = "runs" | "top-tracks" | "connected";

interface Me {
  email?: string;
  stravaLinked: boolean; stravaAthleteName?: string;
  spotifyLinked: boolean; spotifyUserName?: string;
  lastfmLinked: boolean; lastfmUsername?: string;
}
interface GenreBreakdown { genre: string; percent: number; trackCount: number }
interface Activity {
  activityId: string;
  name?: string;
  startTime: string;
  elapsedSeconds: number;
  distanceMeters: number;
  tracks: { trackName: string; artistNames: string[] }[];
  genreBreakdown: GenreBreakdown[];
  musicSource?: "lastfm" | "spotify";
  publishedAt?: string;
}
interface TopSong { trackId: string; trackName: string; artistName: string; playCount: number }
interface SyncResult {
  scanned: number; processed: number;
  annotated: number; alreadyAnnotated: number; noTracks: number; notARun: number;
  moreAvailable: boolean;
}

export function Dashboard() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>("runs");
  const [me, setMe] = useState<Me | null>(null);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [topSongs, setTopSongs] = useState<TopSong[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncResult | null>(null);

  async function loadAll() {
    const [m, a, ts] = await Promise.all([
      api<Me>("/api/me"),
      api<{ items: Activity[] }>("/api/activities"),
      api<{ items: TopSong[] }>("/api/me/top-songs"),
    ]);
    setMe(m); setActivities(a.items); setTopSongs(ts.items);
  }

  useEffect(() => {
    (async () => {
      const t = await getValidTokens();
      if (!t) { navigate("/signin"); return; }
      if (params.get("linked")) navigate("/dashboard", { replace: true });
      try { await loadAll(); }
      catch (e: any) { setError(e.message); }
    })();
  }, [navigate, params]);

  async function startOauth(service: "strava" | "spotify" | "lastfm") {
    const returnTo = encodeURIComponent(window.location.origin);
    const { url } = await api<{ url: string }>(`/auth/${service}/start?returnTo=${returnTo}`);
    window.location.href = url;
  }

  async function runSync(force = false) {
    setSyncing(true); setSyncStatus(null); setError(null);
    try {
      const path = force ? "/api/sync?force=true" : "/api/sync";
      const r = await api<SyncResult>(path, { method: "POST" });
      setSyncStatus(r);
      await loadAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  function handleSignOut() { signOut(); navigate("/"); }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] min-h-screen">
      {/* Mobile top bar */}
      <div className="md:hidden bg-black border-b border-line">
        <div className="flex items-center justify-between px-4 h-12">
          <div className="font-bold text-base tracking-tight">
            Stravify<span className="text-brand">.</span>
          </div>
          <button onClick={handleSignOut} className="text-xs text-muted hover:text-fg">Sign out</button>
        </div>
        <nav className="flex px-2 pb-2 gap-1 overflow-x-auto">
          <MobileTab active={tab === "runs"} onClick={() => setTab("runs")}>Runs</MobileTab>
          <MobileTab active={tab === "top-tracks"} onClick={() => setTab("top-tracks")}>Top tracks</MobileTab>
          <MobileTab active={tab === "connected"} onClick={() => setTab("connected")}>Accounts</MobileTab>
        </nav>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex bg-black border-r border-line py-5 flex-col">
        <div className="px-5 pb-6 border-b border-line">
          <div className="font-bold text-base tracking-tight">
            Stravify<span className="text-brand">.</span>
          </div>
        </div>
        <nav className="p-3 flex-1 flex flex-col gap-0.5">
          <SideLink active={tab === "runs"} onClick={() => setTab("runs")}>Runs</SideLink>
          <SideLink active={tab === "top-tracks"} onClick={() => setTab("top-tracks")}>Top tracks</SideLink>
          <SideLink active={tab === "connected"} onClick={() => setTab("connected")}>Connected accounts</SideLink>
        </nav>
        <div className="border-t border-line px-5 pt-4 text-xs text-dim">
          <div className="text-muted mb-1.5 break-all">{me?.email ?? getStoredEmail() ?? "—"}</div>
          <button onClick={handleSignOut} className="text-muted hover:text-fg text-[13px]">Sign out</button>
        </div>
      </aside>

      <main className="bg-page overflow-y-auto">
        <div className="max-w-[920px] px-4 sm:px-10 pt-6 sm:pt-8 pb-16">
          {error && <div className="text-danger text-sm mb-4">{error}</div>}

          {tab === "runs" && (
            <RunsTab
              activities={activities}
              syncing={syncing}
              syncStatus={syncStatus}
              canSync={!!(me?.stravaLinked && (me?.spotifyLinked || me?.lastfmLinked))}
              onSync={() => runSync(false)}
              onForceSync={() => runSync(true)}
            />
          )}
          {tab === "top-tracks" && <TopTracksTab items={topSongs} />}
          {tab === "connected" && (
            <ConnectedTab me={me} onLink={startOauth} />
          )}
        </div>
      </main>
    </div>
  );
}

function SideLink({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "text-left px-3 py-2 rounded text-sm font-medium " +
        (active ? "text-fg bg-card-2" : "text-muted hover:bg-card-2 hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

function MobileTab({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap " +
        (active ? "text-fg bg-card-2" : "text-muted hover:text-fg")
      }
    >
      {children}
    </button>
  );
}

function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
      <div>
        <h1 className="text-[26px] sm:text-[32px] leading-[1.2] font-bold tracking-tight mb-1">{title}</h1>
        {sub && <div className="text-sm text-muted">{sub}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function RunsTab({
  activities, syncing, syncStatus, canSync, onSync, onForceSync,
}: {
  activities: Activity[] | null;
  syncing: boolean;
  syncStatus: SyncResult | null;
  canSync: boolean;
  onSync: () => void;
  onForceSync: () => void;
}) {
  return (
    <>
      <PageHeader
        title="Runs"
        sub={
          activities === null
            ? "Loading…"
            : activities.length === 0
              ? "No runs logged yet."
              : `${activities.length} run${activities.length === 1 ? "" : "s"} logged`
        }
        action={
          <div className="flex items-center gap-3">
            <button
              onClick={onForceSync}
              disabled={!canSync || syncing}
              className="text-xs text-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed"
              title="Re-process already-annotated runs (useful after improving genre logic)"
            >
              Rebuild
            </button>
            <button
              onClick={onSync}
              disabled={!canSync || syncing}
              className="bg-brand hover:bg-brand-hover text-black font-semibold px-4 py-2 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title={canSync ? "Pull recent Strava activities and process them" : "Link Strava and a music source first"}
            >
              {syncing ? "Syncing…" : "Sync"}
            </button>
          </div>
        }
      />

      {syncStatus && (
        <div className="bg-card border border-line rounded px-4 py-3 mb-6 text-sm text-muted">
          Scanned {syncStatus.scanned} activities · {syncStatus.annotated} newly annotated · {syncStatus.alreadyAnnotated} already done · {syncStatus.noTracks} had no music data
          {syncStatus.moreAvailable && <span className="text-fg"> · click Sync again to keep going</span>}
        </div>
      )}

      {activities === null && <Empty>Loading…</Empty>}
      {activities && activities.length === 0 && (
        <Empty>No runs processed yet. Once you finish a run with Strava and a music source linked, it shows up here.</Empty>
      )}
      {activities && activities.length > 0 && (
        <div className="flex flex-col gap-px bg-line border border-line rounded overflow-hidden">
          {activities.map(a => <RunRow key={a.activityId} a={a} />)}
        </div>
      )}
    </>
  );
}

function RunRow({ a }: { a: Activity }) {
  const top = a.genreBreakdown?.slice(0, 3) ?? [];
  const [publishing, setPublishing] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string | undefined>(a.publishedAt);
  const [pubError, setPubError] = useState<string | null>(null);

  async function onPublish(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    setPublishing(true); setPubError(null);
    try {
      const r = await api<{ publishedAt: string }>(`/api/runs/${a.activityId}/publish`, { method: "POST" });
      setPublishedAt(r.publishedAt);
    } catch (err: any) {
      setPubError(err.message);
    } finally {
      setPublishing(false);
    }
  }

  const publishButton = (
    <button
      onClick={onPublish}
      disabled={publishing}
      title={publishedAt ? "Update the Strava description with the latest link" : "Add a stravify.net link to your Strava description"}
      className={
        "text-xs font-medium px-3 py-1.5 rounded shrink-0 whitespace-nowrap " +
        (publishedAt
          ? "border border-line-strong text-muted hover:text-fg hover:bg-card-2"
          : "bg-brand hover:bg-brand-hover text-black font-semibold")
        + (publishing ? " opacity-60 cursor-not-allowed" : "")
      }
    >
      {publishing ? "Publishing…" : publishedAt ? "Published ✓" : "Publish"}
    </button>
  );

  return (
    <div className="bg-card hover:bg-card-hover">
      {/* Mobile: stacked card. Desktop: row grid. */}
      <div className="flex sm:hidden flex-col gap-2 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <Link to={`/run/${a.activityId}`} className="min-w-0 flex-1 block">
            <div className="font-semibold text-sm text-fg truncate">{a.name || "Run"}</div>
            <div className="text-xs text-dim mt-0.5">
              {fmtDate(a.startTime)}{a.musicSource && ` · via ${a.musicSource}`}
            </div>
          </Link>
          {publishButton}
        </div>
        <Link to={`/run/${a.activityId}`} className="text-xs text-muted tabular-nums flex gap-3">
          <span>{fmtKm(a.distanceMeters || 0)}</span>
          <span className="text-line-strong">·</span>
          <span>{fmtDuration(a.elapsedSeconds || 0)}</span>
          <span className="text-line-strong">·</span>
          <span>{a.tracks?.length ?? 0} tracks</span>
        </Link>
        {top.length > 0 && (
          <Link to={`/run/${a.activityId}`} className="text-xs text-muted block">
            {top.map((g, i) => (
              <span key={g.genre}>
                <span className="text-brand tabular-nums">{g.percent}%</span> {g.genre}
                {i < top.length - 1 ? "  ·  " : ""}
              </span>
            ))}
          </Link>
        )}
        {pubError && <span className="text-[11px] text-danger">{pubError}</span>}
      </div>

      <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-6 items-center px-4 py-3.5">
        <Link to={`/run/${a.activityId}`} className="contents">
          <div className="min-w-0">
            <div className="font-semibold text-sm text-fg">{a.name || "Run"}</div>
            <div className="text-xs text-dim mt-0.5">
              {fmtDate(a.startTime)}{a.musicSource && ` · via ${a.musicSource}`}
            </div>
            {top.length > 0 && (
              <div className="text-xs text-muted mt-1.5">
                {top.map((g, i) => (
                  <span key={g.genre}>
                    <span className="text-brand tabular-nums">{g.percent}%</span> {g.genre}
                    {i < top.length - 1 ? "  ·  " : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Stat label="Distance" value={fmtKm(a.distanceMeters || 0)} />
          <Stat label="Time" value={fmtDuration(a.elapsedSeconds || 0)} />
          <Stat label="Tracks" value={String(a.tracks?.length ?? 0)} />
        </Link>
        <div className="flex flex-col items-end gap-1">
          {publishButton}
          {pubError && <span className="text-[11px] text-danger">{pubError}</span>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:text-right min-w-[64px] tabular-nums">
      <div className="text-[11px] text-dim mb-0.5">{label}</div>
      <div className="text-sm text-muted">{value}</div>
    </div>
  );
}

function TopTracksTab({ items }: { items: TopSong[] | null }) {
  return (
    <>
      <PageHeader
        title="Top running tracks"
        sub={items && items.length > 0 ? "Across every run you've logged" : undefined}
      />
      {items === null && <Empty>Loading…</Empty>}
      {items && items.length === 0 && <Empty>Not enough data yet.</Empty>}
      {items && items.length > 0 && (
        <div className="border border-line rounded overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-card text-dim text-left">
                <th className="px-4 py-3 font-medium w-8">#</th>
                <th className="px-4 py-3 font-medium">Track</th>
                <th className="px-4 py-3 font-medium">Artist</th>
                <th className="px-4 py-3 font-medium text-right">Plays</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t, i) => (
                <tr key={t.trackId} className="bg-card hover:bg-card-hover border-t border-line">
                  <td className="px-4 py-3 text-dim">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-fg">{t.trackName}</td>
                  <td className="px-4 py-3 text-muted">{t.artistName}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{t.playCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ConnectedTab({
  me,
  onLink,
}: {
  me: Me | null;
  onLink: (s: "strava" | "spotify" | "lastfm") => void;
}) {
  const onlySpotifyLinked = me?.spotifyLinked && !me?.lastfmLinked;
  return (
    <>
      <PageHeader
        title="Connected accounts"
        sub="Link Strava plus a music source. We strongly recommend Last.fm — it gives Stravify your full scrobble history with no track limit."
      />

      {onlySpotifyLinked && (
        <div className="bg-card border border-brand/40 rounded px-4 py-3 mb-4 text-sm">
          <span className="text-brand font-semibold">Tip:</span>{" "}
          <span className="text-fg">Spotify only exposes your last 50 plays</span>
          <span className="text-muted">, so long runs and historical syncs lose tracks. </span>
          <button
            onClick={() => onLink("lastfm")}
            className="text-brand hover:underline font-medium"
          >
            Link Last.fm
          </button>
          <span className="text-muted"> for the full picture.</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <ConnectRow
          label="Strava"
          subtitle="Reads activities and writes the music description."
          linked={!!me?.stravaLinked}
          display={me?.stravaAthleteName}
          onClick={() => onLink("strava")}
        />
        <ConnectRow
          label="Last.fm"
          subtitle="Full scrobble history, no 50-track cap. Connect Spotify to Last.fm in Last.fm's settings and every play scrobbles automatically."
          linked={!!me?.lastfmLinked}
          display={me?.lastfmUsername}
          onClick={() => onLink("lastfm")}
          recommended
        />
        <ConnectRow
          label="Spotify"
          subtitle="Optional. Useful only if you don't scrobble — limited to your last 50 plays."
          linked={!!me?.spotifyLinked}
          display={me?.spotifyUserName}
          onClick={() => onLink("spotify")}
        />
      </div>
    </>
  );
}

function ConnectRow(props: {
  label: string; subtitle: string; linked: boolean; display?: string; onClick: () => void; recommended?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between rounded px-4 py-4 gap-4 border " +
        (props.recommended
          ? "bg-card border-brand/40"
          : "bg-card border-line")
      }
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-sm">{props.label}</div>
          {props.recommended && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-brand border border-brand/50 rounded px-1.5 py-px">
              Recommended
            </span>
          )}
        </div>
        <div className="text-xs text-muted mt-0.5">{props.subtitle}</div>
        <div className={"text-xs mt-1.5 " + (props.linked ? "text-brand" : "text-dim")}>
          {props.linked
            ? `Linked${props.display ? ` · ${props.display}` : ""}`
            : "Not linked"}
        </div>
      </div>
      <button
        onClick={props.onClick}
        className={
          "text-xs font-medium px-3 py-1.5 rounded shrink-0 " +
          (props.recommended && !props.linked
            ? "bg-brand hover:bg-brand-hover text-black font-semibold"
            : "border border-line-strong hover:bg-card-2 hover:border-[#3a3a3a]")
        }
      >
        {props.linked ? "Relink" : "Link"}
      </button>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-line rounded px-4 py-6 text-sm text-muted">
      {children}
    </div>
  );
}
