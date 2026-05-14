import { config } from "../config";
import { getValidTokens } from "./auth";

function goToSignIn() {
  // Throwing first so callers can stop; the redirect happens on next tick.
  setTimeout(() => { window.location.href = "/signin"; }, 0);
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const tokens = await getValidTokens();
  if (!tokens) {
    goToSignIn();
    throw new Error("Not authenticated");
  }
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${tokens.idToken}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    goToSignIn();
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}
export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
export function fmtKm(m: number): string { return (m / 1000).toFixed(2) + " km"; }
