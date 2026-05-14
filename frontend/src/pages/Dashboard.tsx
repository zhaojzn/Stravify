import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getValidTokens, signOut, getStoredEmail, changePassword, deleteCognitoUser } from "../lib/auth";
import { api, fmtDate, fmtDuration, fmtKm } from "../lib/api";

type Tab = "runs" | "top-tracks" | "connected" | "profile";

interface Me {
  email?: string;
  createdAt?: string;
  stravaLinked: boolean; stravaAthleteName?: string;
  spotifyLinked: boolean; spotifyUserName?: string;
  lastfmLinked: boolean; lastfmUsername?: string;
  autoPublish: boolean;
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
  const [linking, setLinking] = useState<"strava" | "spotify" | "lastfm" | null>(null);

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
      try {
        await loadAll();
      } catch (e: any) { setError(e.message); }
    })();
  }, [navigate, params]);

  // On first load only, if the user hasn't linked Strava yet, default the tab
  // to Connected accounts. After that, let them navigate freely.
  const initialJumpDone = useRef(false);
  useEffect(() => {
    if (initialJumpDone.current || !me) return;
    initialJumpDone.current = true;
    if (!me.stravaLinked) setTab("connected");
  }, [me]);

  async function startOauth(service: "strava" | "spotify" | "lastfm") {
    if (linking) return;
    // Temporary: Strava app is pending review for a higher rate limit, so
    // new users can't link until Strava approves. Existing linked users can
    // still relink (their athlete ID is already on the allowlist).
    if (service === "strava" && !me?.stravaLinked) {
      alert("This app has not been approved by Strava developers yet — please come back when it's approved.");
      return;
    }
    setLinking(service); setError(null);
    try {
      const returnTo = encodeURIComponent(window.location.origin);
      const { url } = await api<{ url: string }>(`/auth/${service}/start?returnTo=${returnTo}`);
      window.location.href = url;
    } catch (e: any) {
      setError(e.message);
      setLinking(null);
    }
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
          <MobileTab active={tab === "profile"} onClick={() => setTab("profile")}>Profile</MobileTab>
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
          <SideLink active={tab === "profile"} onClick={() => setTab("profile")}>Profile</SideLink>
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
              stravaLinked={!!me?.stravaLinked}
              musicLinked={!!(me?.spotifyLinked || me?.lastfmLinked)}
              onSync={() => runSync(false)}
              onGoToAccounts={() => setTab("connected")}
            />
          )}
          {tab === "top-tracks" && <TopTracksTab items={topSongs} />}
          {tab === "connected" && (
            <ConnectedTab me={me} onLink={startOauth} linking={linking} />
          )}
          {tab === "profile" && (
            <ProfileTab
              me={me}
              activitiesCount={activities?.length ?? 0}
              tracksCount={(topSongs ?? []).reduce((a, t) => a + t.playCount, 0)}
              onUnlinked={loadAll}
              onPrefsChanged={loadAll}
              onAccountDeleted={() => { navigate("/"); }}
            />
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
  activities, syncing, syncStatus, stravaLinked, musicLinked, onSync, onGoToAccounts,
}: {
  activities: Activity[] | null;
  syncing: boolean;
  syncStatus: SyncResult | null;
  stravaLinked: boolean;
  musicLinked: boolean;
  onSync: () => void;
  onGoToAccounts: () => void;
}) {
  const canSync = stravaLinked && musicLinked;

  if (!stravaLinked) {
    return (
      <>
        <PageHeader title="Runs" />
        <div className="bg-card border border-line rounded p-6 text-sm">
          <div className="text-fg font-medium mb-2">Link your Strava account to get started.</div>
          <p className="text-muted mb-4">Stravify needs read access to your Strava activities and write access to update the description. You can also link Last.fm now for the best results.</p>
          <button
            onClick={onGoToAccounts}
            className="bg-brand hover:bg-brand-hover text-black font-semibold px-4 py-2 rounded text-sm"
          >
            Go to Connected accounts
          </button>
        </div>
      </>
    );
  }

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
          <button
            onClick={onSync}
            disabled={!canSync || syncing}
            className="bg-brand hover:bg-brand-hover text-black font-semibold px-4 py-2 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title={canSync ? "Pull recent Strava activities and process them" : "Link a music source first"}
          >
            {syncing ? "Syncing…" : "Sync"}
          </button>
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
  linking,
}: {
  me: Me | null;
  onLink: (s: "strava" | "spotify" | "lastfm") => void;
  linking: "strava" | "spotify" | "lastfm" | null;
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

      {me && !me.stravaLinked && (
        <div className="mb-3 text-xs px-3 py-2 rounded border" style={{ borderColor: "#FC520055", color: "#FC5200" }}>
          Strava approval pending — new accounts can't link yet. Check back soon.
        </div>
      )}

      <div className="flex flex-col gap-3">
        <ConnectRow
          label="Strava"
          subtitle="Required. Reads activities and writes the music description."
          linked={!!me?.stravaLinked}
          display={me?.stravaAthleteName}
          onClick={() => onLink("strava")}
          required
          busy={linking === "strava"}
          disabled={linking !== null && linking !== "strava"}
        />
        <ConnectRow
          label="Last.fm"
          subtitle="Full scrobble history, no 50-track cap. Connect Spotify to Last.fm in Last.fm's settings and every play scrobbles automatically."
          linked={!!me?.lastfmLinked}
          display={me?.lastfmUsername}
          onClick={() => onLink("lastfm")}
          recommended
          busy={linking === "lastfm"}
          disabled={linking !== null && linking !== "lastfm"}
        />
        <ConnectRow
          label="Spotify"
          subtitle="Optional. Useful only if you don't scrobble — limited to your last 50 plays."
          linked={!!me?.spotifyLinked}
          display={me?.spotifyUserName}
          onClick={() => onLink("spotify")}
          busy={linking === "spotify"}
          disabled={linking !== null && linking !== "spotify"}
        />
      </div>
    </>
  );
}

function ConnectRow(props: {
  label: string; subtitle: string; linked: boolean; display?: string; onClick: () => void;
  recommended?: boolean; required?: boolean; busy?: boolean; disabled?: boolean;
}) {
  const stravaOrange = "#FC5200";
  const borderStyle = props.required
    ? { borderColor: stravaOrange }
    : undefined;
  const buttonInactive = props.busy || props.disabled;
  return (
    <div
      style={borderStyle}
      className={
        "flex items-center justify-between rounded px-4 py-4 gap-4 border " +
        (props.required
          ? "bg-card"
          : props.recommended
            ? "bg-card border-brand/40"
            : "bg-card border-line")
      }
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-sm">{props.label}</div>
          {props.required && (
            <span
              style={{ color: stravaOrange, borderColor: stravaOrange }}
              className="text-[10px] uppercase tracking-wide font-semibold border rounded px-1.5 py-px"
            >
              Required
            </span>
          )}
          {props.recommended && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-brand border border-brand/50 rounded px-1.5 py-px">
              Recommended
            </span>
          )}
        </div>
        <div className="text-xs text-muted mt-0.5">{props.subtitle}</div>
        <div
          style={props.linked && props.required ? { color: stravaOrange } : undefined}
          className={"text-xs mt-1.5 " + (props.linked
            ? (props.required ? "" : "text-brand")
            : "text-dim")}
        >
          {props.linked
            ? `Linked${props.display ? ` · ${props.display}` : ""}`
            : "Not linked"}
        </div>
      </div>
      <button
        onClick={props.onClick}
        disabled={buttonInactive}
        style={props.required && !props.linked ? { backgroundColor: stravaOrange, color: "#fff" } : undefined}
        className={
          "text-xs font-medium px-3 py-1.5 rounded shrink-0 inline-flex items-center gap-1.5 " +
          (props.required && !props.linked
            ? "font-semibold hover:brightness-110"
            : props.recommended && !props.linked
              ? "bg-brand hover:bg-brand-hover text-black font-semibold"
              : "border border-line-strong hover:bg-card-2 hover:border-[#3a3a3a]") +
          (buttonInactive ? " opacity-60 cursor-not-allowed" : "")
        }
      >
        {props.busy && <Spinner />}
        {props.busy ? "Linking…" : props.linked ? "Relink" : "Link"}
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function ProfileTab({
  me, activitiesCount, tracksCount, onUnlinked, onPrefsChanged, onAccountDeleted,
}: {
  me: Me | null;
  activitiesCount: number;
  tracksCount: number;
  onUnlinked: () => Promise<void>;
  onPrefsChanged: () => Promise<void>;
  onAccountDeleted: () => void;
}) {
  return (
    <>
      <PageHeader title="Profile" sub="Your account and connected services." />
      <div className="flex flex-col gap-8">
        <AccountInfo me={me} activitiesCount={activitiesCount} tracksCount={tracksCount} />
        <PreferencesSection me={me} onPrefsChanged={onPrefsChanged} />
        <UnlinkSection me={me} onUnlinked={onUnlinked} />
        <ChangePasswordSection />
        <DangerSection onAccountDeleted={onAccountDeleted} />
      </div>
    </>
  );
}

function PreferencesSection({ me, onPrefsChanged }: { me: Me | null; onPrefsChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const enabled = me?.autoPublish !== false;

  async function toggle() {
    if (!me) return;
    setBusy(true); setErr(null);
    try {
      await api("/api/me/preferences", {
        method: "POST",
        body: JSON.stringify({ autoPublish: !enabled }),
      });
      await onPrefsChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-3">Preferences</h2>
      <div className="bg-card border border-line rounded">
        <div className="flex items-start justify-between px-4 py-4 gap-4">
          <div className="min-w-0">
            <div className="text-fg font-medium text-sm">Auto-publish to Strava</div>
            <div className="text-xs text-muted mt-1">
              When on, Stravify writes the music summary and run link into each new Strava activity description automatically.
              When off, runs are still saved here but you'll need to click <span className="text-fg">Publish</span> on each run to update its Strava description.
            </div>
          </div>
          <button
            onClick={toggle} disabled={busy || !me}
            aria-pressed={enabled}
            className={
              "relative inline-flex items-center w-11 h-6 rounded-full shrink-0 transition-colors p-0.5 " +
              (enabled ? "bg-brand" : "bg-line-strong") +
              (busy ? " opacity-60 cursor-not-allowed" : "")
            }
          >
            <span
              className="block w-5 h-5 rounded-full bg-white shadow"
              style={{
                transform: enabled ? "translateX(20px)" : "translateX(0)",
                transition: "transform 150ms ease",
              }}
            />
          </button>
        </div>
        {err && <div className="text-xs text-danger px-4 pb-3">{err}</div>}
      </div>
    </section>
  );
}

function AccountInfo({ me, activitiesCount, tracksCount }: {
  me: Me | null; activitiesCount: number; tracksCount: number;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-3">Account</h2>
      <div className="bg-card border border-line rounded">
        <InfoRow label="Email" value={me?.email ?? "—"} />
        <InfoRow label="Joined" value={me?.createdAt ? new Date(me.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—"} />
        <InfoRow label="Runs logged" value={String(activitiesCount)} />
        <InfoRow label="Tracks logged" value={String(tracksCount)} />
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-line last:border-b-0 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-fg tabular-nums">{value}</span>
    </div>
  );
}

function UnlinkSection({ me, onUnlinked }: { me: Me | null; onUnlinked: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function unlink(service: "strava" | "spotify" | "lastfm", label: string) {
    if (!confirm(`Unlink ${label}? You can relink anytime.`)) return;
    setBusy(service); setErr(null);
    try {
      await api(`/api/me/unlink`, { method: "POST", body: JSON.stringify({ service }) });
      await onUnlinked();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  const rows: { key: "strava" | "spotify" | "lastfm"; label: string; linked: boolean; display?: string }[] = [
    { key: "strava",  label: "Strava",  linked: !!me?.stravaLinked,  display: me?.stravaAthleteName },
    { key: "lastfm",  label: "Last.fm", linked: !!me?.lastfmLinked,  display: me?.lastfmUsername },
    { key: "spotify", label: "Spotify", linked: !!me?.spotifyLinked, display: me?.spotifyUserName },
  ];
  return (
    <section>
      <h2 className="text-base font-semibold mb-3">Linked services</h2>
      <div className="bg-card border border-line rounded">
        {rows.map(r => (
          <div key={r.key} className="flex items-center justify-between px-4 py-3 border-b border-line last:border-b-0 text-sm">
            <div className="min-w-0">
              <div className="text-fg font-medium">{r.label}</div>
              <div className="text-xs text-muted truncate">
                {r.linked ? (r.display ? `Linked · ${r.display}` : "Linked") : "Not linked"}
              </div>
            </div>
            <button
              onClick={() => unlink(r.key, r.label)}
              disabled={!r.linked || busy !== null}
              className="text-xs font-medium border border-line-strong hover:bg-card-2 hover:border-[#3a3a3a] disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded"
            >
              {busy === r.key ? "Unlinking…" : "Unlink"}
            </button>
          </div>
        ))}
      </div>
      {err && <div className="text-danger text-xs mt-2">{err}</div>}
    </section>
  );
}

function ChangePasswordSection() {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await changePassword(oldPw, newPw);
      setOldPw(""); setNewPw("");
      setMsg({ kind: "ok", text: "Password updated." });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Couldn't change password." });
    } finally { setBusy(false); }
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-3">Change password</h2>
      <form onSubmit={onSubmit} className="bg-card border border-line rounded p-4 max-w-md">
        <label className="block mb-3 text-xs font-medium text-muted">
          Current password
          <input
            type="password" autoComplete="current-password" required
            value={oldPw} onChange={(e) => setOldPw(e.target.value)}
            className="block w-full mt-1.5 bg-card-2 border border-line-strong rounded px-3 py-2 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        <label className="block mb-3 text-xs font-medium text-muted">
          New password
          <input
            type="password" autoComplete="new-password" required minLength={10}
            value={newPw} onChange={(e) => setNewPw(e.target.value)}
            className="block w-full mt-1.5 bg-card-2 border border-line-strong rounded px-3 py-2 text-sm text-fg outline-none focus:border-brand"
          />
        </label>
        {msg && (
          <div className={"text-xs mb-3 " + (msg.kind === "ok" ? "text-brand" : "text-danger")}>{msg.text}</div>
        )}
        <button
          type="submit" disabled={busy}
          className="bg-brand hover:bg-brand-hover text-black font-semibold px-4 py-2 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </section>
  );
}

function DangerSection({ onAccountDeleted }: { onAccountDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doDelete() {
    const confirmText = prompt(
      "This permanently deletes your account, all your run history, and all logged tracks. It does NOT remove descriptions Stravify has already written to past Strava activities — you'll need to clean those manually if you want.\n\nType DELETE to confirm.",
    );
    if (confirmText !== "DELETE") return;
    setBusy(true); setErr(null);
    try {
      await api("/api/me", { method: "DELETE" });
      await deleteCognitoUser();
      onAccountDeleted();
    } catch (e: any) {
      setErr(e?.message || "Couldn't delete account.");
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-3 text-danger">Danger zone</h2>
      <div className="bg-card border border-danger/40 rounded p-4">
        <div className="text-sm text-fg font-medium mb-1">Delete account</div>
        <p className="text-xs text-muted mb-4">
          Permanently removes your account, all your run history, and every logged track. Strava activities you've already had Stravify annotate will keep their descriptions on Strava — clean those up manually if you want.
        </p>
        <button
          onClick={doDelete} disabled={busy}
          className="border border-danger/60 text-danger hover:bg-danger/10 px-4 py-2 rounded text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
        {err && <div className="text-xs text-danger mt-2">{err}</div>}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-line rounded px-4 py-6 text-sm text-muted">
      {children}
    </div>
  );
}
