// Helpers for picking a safe "redirect back to frontend" URL.

function allowed(): string[] {
  return (process.env.ALLOWED_FRONTEND_URLS || "").split(",").filter(Boolean);
}

export function defaultFrontendUrl(): string {
  return process.env.DEFAULT_FRONTEND_URL || allowed()[0] || "";
}

export function pickReturnTo(candidate: string | undefined | null): string {
  if (!candidate) return defaultFrontendUrl();
  return allowed().includes(candidate) ? candidate : defaultFrontendUrl();
}
