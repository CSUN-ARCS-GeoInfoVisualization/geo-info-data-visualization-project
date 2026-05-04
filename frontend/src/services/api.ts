const API_URL = import.meta.env.VITE_API_URL as string;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// In-flight GET dedup. When App.tsx + Dashboard mount in the same tick and both
// call /me, the second call piggybacks on the first promise instead of opening
// a second round-trip. Mutating verbs (POST/PUT/DELETE) and bodied requests
// always go through fresh.
const _inflight = new Map<string, Promise<Response>>();

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method || "GET").toUpperCase();
  const dedupable = method === "GET" && !options.body;
  const key = dedupable ? `GET ${path}` : null;

  if (key) {
    const pending = _inflight.get(key);
    if (pending) return pending.then((r) => r.clone());
  }

  const exec = fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers as Record<string, string> || {}),
    },
  }).then((res) => {
    if (res.status === 401) {
      localStorage.removeItem("token");
      window.location.reload();
    }
    return res;
  });

  if (key) {
    _inflight.set(key, exec);
    // Clear once settled so later callers re-fetch fresh data instead of
    // getting a stale shared response. Dedup window is exactly the round-trip.
    exec.finally(() => {
      if (_inflight.get(key) === exec) _inflight.delete(key);
    });
    return exec.then((r) => r.clone());
  }

  return exec;
}
