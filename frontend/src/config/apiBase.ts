/**
 * Resolved base URL for JSON API routes (…/api/...).
 *
 * In production builds, `VITE_API_URL` must be set at build time (e.g. Netlify env vars).
 * Do not default to localhost in production: the browser would call the visitor's own machine
 * and show ERR_CONNECTION_REFUSED.
 */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  if (import.meta.env.DEV) return "http://localhost:5000/api";
  return "";
}

/** GET /health on the Flask host (not under /api). Null if API base is not configured (production). */
export function getHealthUrl(): string | null {
  const base = getApiBaseUrl();
  if (!base) return null;
  const noSlash = base.replace(/\/+$/, "");
  const origin = noSlash.endsWith("/api") ? noSlash.slice(0, -4) : noSlash;
  return `${origin}/health`;
}
