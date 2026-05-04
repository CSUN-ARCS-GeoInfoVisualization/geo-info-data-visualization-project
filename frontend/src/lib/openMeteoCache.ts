// Tiny in-process cache for Open-Meteo calls. Two callers (dashboard's current
// weather block + RiskChart's 7-day forecast) hit the same lat/lon at roughly
// the same time, and revisiting Dashboard re-fires both. With a 5-minute TTL
// keyed on URL, the second caller piggybacks on the first promise and revisits
// within the window resolve instantly.
//
// Safety: Open-Meteo data is read-only. Returning a shared object is fine —
// callers must not mutate. TTL ensures we never serve hours-old weather.

type CacheEntry = { promise: Promise<any>; expires: number };

const TTL_MS = 5 * 60 * 1000;
const _cache = new Map<string, CacheEntry>();

export function fetchOpenMeteo<T = any>(url: string): Promise<T> {
  const now = Date.now();
  const entry = _cache.get(url);
  if (entry && entry.expires > now) return entry.promise as Promise<T>;

  const promise = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
      return r.json();
    })
    .catch((err) => {
      _cache.delete(url);  // let a retry succeed instead of replaying error
      throw err;
    });

  _cache.set(url, { promise, expires: now + TTL_MS });
  return promise as Promise<T>;
}
