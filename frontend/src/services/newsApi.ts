import { apiFetch } from "./api";

export type TabCategory = "breaking" | "updates" | "safety" | "research";
export type SourceBucket =
  | "cal_fire"
  | "nws"
  | "local_fire"
  | "emergency"
  | "web_discovery";

export interface NewsArticleDTO {
  id: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  category: TabCategory;
  source_bucket: SourceBucket;
  source_label: string;
  is_breaking: boolean;
  is_fallback?: boolean;
  provenance?: string;
}

/** Items per “load more”; first page uses DEFAULT_NEWS_PAGE in the UI. */
export const DEFAULT_NEWS_PAGE = 15;
const DEFAULT_LOAD_MORE = 10;

export async function fetchNews(
  segment: "recent" | "older",
  category: "all" | TabCategory,
  opts?: { offset?: number; limit?: number }
): Promise<{ items: NewsArticleDTO[]; has_more: boolean }> {
  const offset = opts?.offset ?? 0;
  const limit =
    opts?.limit ??
    (offset > 0 ? DEFAULT_LOAD_MORE : DEFAULT_NEWS_PAGE);
  const params = new URLSearchParams({
    segment,
    category,
    offset: String(offset),
    limit: String(limit),
  });
  const r = await apiFetch(`/news?${params}`);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

/** Official pages aligned with backend allowlisted syndication sources. */
export const TRUSTED_SOURCE_HOME = {
  cal_fire: "https://www.fire.ca.gov/incidents/",
  nws: "https://www.weather.gov/alerts/",
  local_fire: "https://lafd.org/",
  emergency: "https://www.news.caloes.ca.gov/",
} as const;

export const EXTERNAL_SOURCE_LINKS: readonly { label: string; href: string }[] = [
  { label: "CAL FIRE — Incidents", href: TRUSTED_SOURCE_HOME.cal_fire },
  { label: "NWS — Alerts", href: TRUSTED_SOURCE_HOME.nws },
  { label: "Los Angeles Fire Department", href: TRUSTED_SOURCE_HOME.local_fire },
  { label: "Cal OES — News", href: TRUSTED_SOURCE_HOME.emergency },
];

export const SOURCE_BUCKET_COPY: Record<
  SourceBucket,
  { title: string; subtitle: string }
> = {
  cal_fire: {
    title: "CAL FIRE",
    subtitle: "Official state fire agency",
  },
  nws: {
    title: "National Weather Service",
    subtitle: "Weather alerts & warnings",
  },
  local_fire: {
    title: "Local Fire Departments",
    subtitle: "Regional fire updates",
  },
  emergency: {
    title: "Emergency Services",
    subtitle: "Official alerts & evacuations",
  },
  web_discovery: {
    title: "Web discovery",
    subtitle: "Search result — open Source for the publisher page",
  },
};
