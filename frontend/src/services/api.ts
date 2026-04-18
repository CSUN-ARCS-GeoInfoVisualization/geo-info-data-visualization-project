const API_URL = import.meta.env.VITE_API_URL as string;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Render free tier spins the API down after ~15 min idle. The first request
// after wake-up either times out or returns a 502 HTML page with no CORS
// headers — the browser surfaces the latter as a "CORS policy" error even
// though the real cause is a cold start. Retry transient failures with
// exponential backoff so the UI recovers once gunicorn is up (~10-30s).
const COLD_START_RETRIES = 4;
const COLD_START_DELAYS_MS = [500, 2000, 5000, 10000];

function isTransient(status: number): boolean {
  // 502/503/504 from Render's edge proxy during cold boot.
  return status === 502 || status === 503 || status === 504;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${API_URL}${path}`;
  const init: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers as Record<string, string> || {}),
    },
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= COLD_START_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);

      if (res.status === 401) {
        localStorage.removeItem("token");
        window.location.reload();
        return res;
      }

      if (isTransient(res.status) && attempt < COLD_START_RETRIES) {
        await new Promise((r) => setTimeout(r, COLD_START_DELAYS_MS[attempt]));
        continue;
      }

      return res;
    } catch (err) {
      // Network-level failure (TypeError: Failed to fetch) — Render edge
      // dropped the connection mid cold-start, or the CORS preflight was
      // rejected because the backend hasn't registered the middleware yet.
      lastError = err;
      if (attempt >= COLD_START_RETRIES) break;
      await new Promise((r) => setTimeout(r, COLD_START_DELAYS_MS[attempt]));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Network request failed");
}

// Fire-and-forget warmer — kicks Render awake on app load so the first
// user-visible request is more likely to land on a warm instance.
export function warmUpApi(): void {
  // /health lives at the app root (not under /api). Strip a trailing /api.
  const root = API_URL.replace(/\/api\/?$/, "");
  fetch(`${root}/health`, { method: "GET", mode: "cors" }).catch(() => {
    // ignore — warmup is best-effort
  });
}