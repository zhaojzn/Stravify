import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getValidTokens } from "../lib/auth";

export function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    getValidTokens().then(t => { if (t) navigate("/dashboard"); });
  }, [navigate]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-page">
        <div className="max-w-[1080px] mx-auto h-15 px-8 flex items-center justify-between">
          <div className="font-bold text-base tracking-tight">
            Stravify<span className="text-brand">.</span>
          </div>
          <nav className="flex gap-6 items-center text-sm">
            <Link to="/signin" className="text-fg hover:text-brand">Log in</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-[720px] w-full mx-auto px-8 pt-24 pb-20">
        <h1 className="text-[44px] leading-[1.1] font-bold tracking-tight mb-5">
          Don't be scared. Share the music of your runs.
        </h1>
        <p className="text-[17px] text-muted mb-3.5">
          Link Strava and Spotify. Stravify watches for finished runs, pulls the tracks you played during them, and writes the genre breakdown right into the activity description.
        </p>
        <p className="text-[17px] text-muted">
          Every track is logged, so over time you find out which songs you actually run to.
        </p>

        <div className="mt-9 flex gap-3">
          <Link to="/signup"
            className="bg-brand hover:bg-brand-hover text-black font-medium px-4 py-2 rounded text-sm">
            Get started
          </Link>
        </div>

        <div id="how" className="steps mt-16 pt-8 border-t border-line">
          <h2 className="text-base font-semibold mb-4">How it works</h2>
          <ol className="list-none">
            {[
              "Sign in with your email.",
              "Link Strava and Spotify with OAuth — read-only on Spotify, activity write on Strava.",
              "Strava pings us the moment your run ends.",
              "We pull the tracks played during the run, compute the genre mix, update the activity description, and log the plays.",
            ].map((step, i) => (
              <li key={i} className="flex gap-3.5 py-2.5 text-muted border-b border-line last:border-b-0">
                <span className="text-brand font-semibold min-w-5 tabular-nums">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="max-w-[720px] mx-auto px-8 py-6 text-xs text-dim flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span>Made by Jason Zhao for fun. Not affiliated with or endorsed by Strava.</span>
          <img src="/powered-by-strava.svg" alt="Powered by Strava" className="h-5 w-auto opacity-80" />
        </div>
      </footer>
    </div>
  );
}
