import { getApiBaseUrl } from "../config/apiBase";

/** Set when user chooses "Continue without login" — avoids 401→reload loops for guests. */
export const GUEST_SESSION_KEY = "firescope_guest";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isGuestSession(): boolean {
  return localStorage.getItem(GUEST_SESSION_KEY) === "1";
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const base = getApiBaseUrl();
  if (!base) {
    return Promise.reject(new Error("VITE_API_URL is not configured"));
  }
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers as Record<string, string> || {}),
    },
  });

  // Predict routes are public; a stray 401 must not wipe the session.
  const publicPaths = ["/predict", "/register", "/login"];
  const isPublic = publicPaths.some((p) => path.startsWith(p));
  if (res.status === 401 && !isPublic) {
    if (isGuestSession()) {
      return res;
    }
    localStorage.removeItem("token");
    localStorage.removeItem(GUEST_SESSION_KEY);
    window.location.reload();
  }

  return res;
}