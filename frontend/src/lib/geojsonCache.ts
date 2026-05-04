// Process-lifetime cache for static GeoJSON files served out of /public/Data.
// Why: history.tsx (and others) re-fetched 8 MB perimeter / 8 MB DINS files on
// every mount and every layer toggle. Browser HTTP cache helps, but parsing the
// JSON each time still cost hundreds of ms. This memoizes the parsed object so
// the second visit is effectively free.
//
// Safety: returns the SAME parsed object across callers. Callers must not mutate
// the result. All current call sites only read from it.

const _cache = new Map<string, Promise<any>>();

export function loadGeoJson<T = any>(url: string): Promise<T> {
  let inflight = _cache.get(url);
  if (!inflight) {
    inflight = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        // Drop a failed entry so a retry can succeed instead of replaying the error.
        _cache.delete(url);
        throw err;
      });
    _cache.set(url, inflight);
  }
  return inflight as Promise<T>;
}
