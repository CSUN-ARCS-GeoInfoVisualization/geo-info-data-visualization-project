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
};

const rawApiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";
const API_BASE = rawApiUrl.endsWith("/api")
  ? rawApiUrl
  : `${rawApiUrl.replace(/\/$/, "")}/api`;

async function apiRequest<T>(path: string, options: RequestOptions = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload as T;
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
  updates: Partial<Pick<NotificationPreference, "frequency" | "risk_threshold" | "paused_until" | "blackout_start" | "blackout_end">>,
): Promise<NotificationPreference> {
  return apiRequest<NotificationPreference>("/me/notifications", {
    method: "PUT",
    body: JSON.stringify(updates),
  }, token);
}

export async function subscribeNotifications(token: string): Promise<NotificationPreference> {
  return apiRequest<NotificationPreference>("/notifications/subscribe", { method: "POST" }, token);
}

export async function unsubscribeNotifications(token: string): Promise<NotificationPreference> {
  return apiRequest<NotificationPreference>("/notifications/unsubscribe", { method: "POST" }, token);
}
