type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type NotificationPreference = {
  user_id: number;
  opted_in: boolean;
  frequency: "instant" | "daily" | "weekly";
  risk_threshold: number;
  paused_until: string | null;
  blackout_start: string | null;
  blackout_end: string | null;
  last_sent_at: string | null;
  unsubscribed_at: string | null;
  contact_email: string | null;
  contact_phone: string | null;
};

const rawApiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
const API_BASE = rawApiUrl.endsWith("/api")
  ? rawApiUrl
  : `${rawApiUrl.replace(/\/$/, "")}/api`;

const COLD_START_DELAYS_MS = [500, 2000, 5000, 10000];

async function apiRequest<T>(path: string, options: RequestOptions = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API_BASE}${path}`;
  const init: RequestInit = {
    method: options.method || "GET",
    headers,
    body: options.body,
  };

  // Retry on Render cold-start: first request after idle returns 502/503/504
  // (or a "Failed to fetch" TypeError) with no CORS headers, which the browser
  // reports as a CORS error. Back off and try again once gunicorn is up.
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= COLD_START_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;

      if (!response.ok) {
        const transient = response.status === 502 || response.status === 503 || response.status === 504;
        if (transient && attempt < COLD_START_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, COLD_START_DELAYS_MS[attempt]));
          continue;
        }
        const message = payload?.error || `Request failed (${response.status})`;
        throw new Error(message);
      }

      return payload as T;
    } catch (err) {
      lastError = err;
      const transientNetwork =
        err instanceof TypeError ||
        (err instanceof Error && /Failed to fetch|NetworkError/i.test(err.message));
      if (!transientNetwork || attempt >= COLD_START_DELAYS_MS.length) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, COLD_START_DELAYS_MS[attempt]));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Network request failed");
}

export async function login(email: string, password: string): Promise<{ token: string }> {
  return apiRequest<{ token: string }>("/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function register(email: string, password: string, role = "Resident"): Promise<unknown> {
  return apiRequest("/register", {
    method: "POST",
    body: JSON.stringify({ email, password, role }),
  });
}

export async function getMyNotifications(token: string): Promise<NotificationPreference> {
  return apiRequest<NotificationPreference>("/me/notifications", {}, token);
}

export async function updateMyNotifications(
  token: string,
  updates: Partial<Pick<NotificationPreference, "frequency" | "risk_threshold" | "paused_until" | "blackout_start" | "blackout_end" | "contact_email" | "contact_phone">>,
): Promise<NotificationPreference> {
  return apiRequest<NotificationPreference>("/me/notifications", {
    method: "PUT",
    body: JSON.stringify(updates),
  }, token);
}

export async function subscribeNotifications(
  token: string,
  contact?: { contact_email?: string | null; contact_phone?: string | null },
): Promise<NotificationPreference> {
  return apiRequest<NotificationPreference>("/notifications/subscribe", {
    method: "POST",
    body: JSON.stringify(contact || {}),
  }, token);
}

export async function unsubscribeNotifications(token: string): Promise<NotificationPreference> {
  return apiRequest<NotificationPreference>("/notifications/unsubscribe", { method: "POST" }, token);
}
