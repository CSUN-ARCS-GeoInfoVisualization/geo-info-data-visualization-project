import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Newspaper,
  Clock,
  ExternalLink,
  AlertTriangle,
  Flame,
  Shield,
  BookOpen,
  Search,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Alert, AlertDescription } from "./ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  fetchNews,
  EXTERNAL_SOURCE_LINKS,
  SOURCE_BUCKET_COPY,
  TRUSTED_SOURCE_HOME,
  type NewsArticleDTO,
  type TabCategory,
} from "../services/newsApi";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

const FALLBACK_NEWS: NewsArticleDTO[] = [
  {
    id: "fb-1", title: "Red Flag Warning Issued for Southern California", summary: "The National Weather Service has issued a Red Flag Warning for Los Angeles, Ventura, and Santa Barbara counties due to strong Santa Ana winds and critically low humidity. Residents in fire-prone areas are urged to stay alert and have evacuation plans ready.",
    url: "https://www.weather.gov/alerts/", published_at: daysAgo(0), category: "breaking", source_bucket: "nws", source_label: "NWS Los Angeles", is_breaking: true,
  },
  {
    id: "fb-2", title: "CAL FIRE Reports 95% Containment on Creek Fire", summary: "Firefighters have achieved 95% containment on the Creek Fire in Fresno County. The fire burned approximately 3,200 acres before crews established full perimeter control. Evacuation orders have been lifted for most areas.",
    url: "https://www.fire.ca.gov/incidents/", published_at: daysAgo(1), category: "updates", source_bucket: "cal_fire", source_label: "CAL FIRE", is_breaking: false,
  },
  {
    id: "fb-3", title: "New Evacuation Routes Published for San Fernando Valley", summary: "Los Angeles Fire Department has updated evacuation route maps for the San Fernando Valley following recent wildfire activity. Residents can now access interactive maps showing primary and alternative routes.",
    url: "https://lafd.org/", published_at: daysAgo(2), category: "safety", source_bucket: "local_fire", source_label: "LAFD", is_breaking: false,
  },
  {
    id: "fb-4", title: "Fire Season Outlook: Above-Average Risk Through October", summary: "NOAA's seasonal outlook predicts above-average wildfire risk for California through October due to persistent drought conditions and forecast wind events. Agencies are pre-positioning resources across high-risk areas.",
    url: "https://www.weather.gov/alerts/", published_at: daysAgo(3), category: "research", source_bucket: "nws", source_label: "NOAA", is_breaking: false,
  },
  {
    id: "fb-5", title: "Brush Fire Contained in Malibu Hills", summary: "A 50-acre brush fire in the Malibu Hills area has been fully contained. No structures were damaged and no injuries were reported. LA County Fire credits early air response for the quick containment.",
    url: "https://www.fire.ca.gov/incidents/", published_at: daysAgo(5), category: "updates", source_bucket: "cal_fire", source_label: "CAL FIRE", is_breaking: false,
  },
  {
    id: "fb-6", title: "Cal OES Activates Emergency Operations for Heat Wave", summary: "The California Governor's Office of Emergency Services has activated its State Operations Center in response to an extreme heat wave affecting inland valleys. Cooling centers have been opened across affected counties.",
    url: "https://www.news.caloes.ca.gov/", published_at: daysAgo(8), category: "breaking", source_bucket: "emergency", source_label: "Cal OES", is_breaking: false,
  },
  {
    id: "fb-7", title: "USFS Study: Post-Fire Vegetation Recovery in Sierra Nevada", summary: "A new U.S. Forest Service study examines vegetation recovery patterns in areas burned during the 2020-2023 fire seasons. Findings suggest that managed forests show significantly faster recovery than unmanaged areas.",
    url: "https://www.fs.usda.gov/", published_at: daysAgo(12), category: "research", source_bucket: "nws", source_label: "USFS Research", is_breaking: false,
  },
  {
    id: "fb-8", title: "Defensible Space Inspections Begin in High-Risk Zones", summary: "Fire departments across Southern California have begun annual defensible space inspections. Property owners in Very High Fire Hazard Severity Zones must maintain 100 feet of defensible space around structures.",
    url: "https://lafd.org/", published_at: daysAgo(15), category: "safety", source_bucket: "local_fire", source_label: "LA County Fire", is_breaking: false,
  },
];

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.round((now - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TRUSTED_GRID_BUCKETS = [
  "cal_fire",
  "nws",
  "local_fire",
  "emergency",
] as const;

export function FireNews() {
  const [selectedCategory, setSelectedCategory] = useState<"all" | TabCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState<NewsArticleDTO[]>([]);
  const [hasMoreToLoad, setHasMoreToLoad] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [usingFallback, setUsingFallback] = useState(false);

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    setError(null);
    setItems([]);
    setUsingFallback(false);
    try {
      const data = await fetchNews("recent", selectedCategory, { offset: 0 });
      setItems(data.items);
      setHasMoreToLoad(data.has_more);
    } catch {
      setUsingFallback(true);
      setItems(FALLBACK_NEWS.filter(
        (a) => selectedCategory === "all" || a.category === selectedCategory
      ));
      setHasMoreToLoad(false);
    } finally {
      setLoadingRecent(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const loadOlder = useCallback(async () => {
    if (!hasMoreToLoad) return;
    setLoadingOlder(true);
    setError(null);
    try {
      const data = await fetchNews("recent", selectedCategory, {
        offset: items.length,
      });
      setItems((prev) => {
        const ids = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const item of data.items) {
          if (!ids.has(item.id)) {
            ids.add(item.id);
            merged.push(item);
          }
        }
        return merged;
      });
      setHasMoreToLoad(data.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingOlder(false);
    }
  }, [selectedCategory, hasMoreToLoad, items.length]);

  const categories = [
    { id: "all" as const, label: "All News", icon: Newspaper },
    { id: "breaking" as const, label: "Breaking", icon: AlertTriangle },
    { id: "updates" as const, label: "Updates", icon: Flame },
    { id: "safety" as const, label: "Safety", icon: Shield },
    { id: "research" as const, label: "Research", icon: BookOpen },
  ];

  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (article) =>
        article.title.toLowerCase().includes(q) ||
        article.summary.toLowerCase().includes(q) ||
        article.source_label.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const getCategoryBadge = (category: TabCategory) => {
    const configs: Record<TabCategory, { label: string; className: string }> = {
      breaking: { label: "Breaking", className: "bg-red-100 text-red-800 border-red-200" },
      updates: { label: "Updates", className: "bg-orange-100 text-orange-800 border-orange-200" },
      safety: { label: "Safety", className: "bg-green-100 text-green-800 border-green-200" },
      research: { label: "Research", className: "bg-purple-100 text-purple-800 border-purple-200" },
    };
    const config = configs[category];
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  const breakingNews = filteredArticles.filter((a) => a.is_breaking);

  const importantRecent = filteredArticles.filter((a) => {
    const age = now - new Date(a.published_at).getTime();
    return age < SEVEN_DAYS && (a.is_breaking || a.category === "breaking");
  });

  const last7Days = filteredArticles.filter((a) => {
    const age = now - new Date(a.published_at).getTime();
    return age < SEVEN_DAYS && !a.is_breaking && a.category !== "breaking";
  });

  const olderArticles = filteredArticles.filter((a) => {
    const age = now - new Date(a.published_at).getTime();
    return age >= SEVEN_DAYS;
  });

  const [showOlder, setShowOlder] = useState(false);

  const renderArticleCard = (article: NewsArticleDTO) => {
    const bucket = SOURCE_BUCKET_COPY[article.source_bucket] ?? SOURCE_BUCKET_COPY.emergency;
    return (
      <Card key={article.id} className={article.is_breaking ? "border-red-200 bg-red-50/30" : ""}>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {getCategoryBadge(article.category)}
                {article.is_fallback && (
                  <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50">Web discovery</Badge>
                )}
                {article.is_breaking && (
                  <Badge className="bg-red-100 text-red-800 border-red-200 animate-pulse">Breaking</Badge>
                )}
              </div>
              <CardTitle className="text-xl mb-2">{article.title}</CardTitle>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4 shrink-0" />
                  {formatRelativeTime(article.published_at)}
                </div>
                <span className="hidden sm:inline">&bull;</span>
                <span>{bucket.title} — {article.source_label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{bucket.subtitle}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">{article.summary}</p>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Badge variant="secondary" className="text-xs">
              {article.source_bucket === "cal_fire" ? "State agency"
                : article.source_bucket === "nws" ? "Weather"
                : article.source_bucket === "emergency" ? "Emergency"
                : article.source_bucket === "web_discovery" ? "Search"
                : "Local FD"}
            </Badge>
            {article.url ? (
              <Button variant="outline" size="sm" asChild>
                <a href={article.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2 inline" />Source
                </a>
              </Button>
            ) : (
              <Button variant="outline" size="sm" type="button" disabled>
                <ExternalLink className="h-4 w-4 mr-2 inline" />Source
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const emptyAfterFilters =
    !loadingRecent && filteredArticles.length === 0 && items.length > 0;

  const showArticleList =
    !loadingRecent && (items.length > 0 || hasMoreToLoad || error);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Fire News & Updates</h1>
          <p className="text-muted-foreground">
            Breaking events and important alerts shown first, then the last 7 days of updates.
            Tap "Load last 30 days" for older articles.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" type="button">
              <ExternalLink className="h-4 w-4 shrink-0" />
              View external sources
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[14rem]">
            {EXTERNAL_SOURCE_LINKS.map((link) => (
              <DropdownMenuItem key={link.href} asChild>
                <a href={link.href} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
                  <ExternalLink className="h-4 w-4" />
                  {link.label}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {breakingNews.length > 0 && (
        <Alert className="border-l-4 border-l-red-500 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <strong>Breaking:</strong> {breakingNews[0].title}
                {breakingNews[0].summary?.trim() ? (
                  <p className="mt-2 text-sm font-normal text-muted-foreground line-clamp-3">
                    {breakingNews[0].summary}
                  </p>
                ) : null}
              </div>
              <Badge className="bg-red-100 text-red-800 border-red-200 animate-pulse shrink-0">Live</Badge>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {usingFallback && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            <strong>Showing sample data.</strong> The live news backend is not connected.
            Once the API server is running, real-time fire news will appear here automatically.
          </AlertDescription>
        </Alert>
      )}

      {error && !usingFallback && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search fire news..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {categories.map((category) => {
                const Icon = category.icon;
                return (
                  <Button
                    key={category.id}
                    variant={selectedCategory === category.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCategory(category.id)}
                    className="flex items-center gap-2"
                    type="button"
                  >
                    <Icon className="h-4 w-4" />
                    {category.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {loadingRecent ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {!loadingRecent && items.length === 0 && !hasMoreToLoad && !error && (
            <Card>
              <CardContent className="pt-6 text-center">
                <Newspaper className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-4">No fire news in the last 90 days</h3>
              </CardContent>
            </Card>
          )}

          {emptyAfterFilters && (
            <Card>
              <CardContent className="pt-6 text-center">
                <Newspaper className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No articles found</h3>
                <p className="text-muted-foreground">Try adjusting your search or category filter.</p>
              </CardContent>
            </Card>
          )}

          {showArticleList && importantRecent.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-red-100 p-1.5">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </div>
                <h2 className="text-lg font-semibold">Important & Breaking</h2>
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                  {importantRecent.length}
                </Badge>
              </div>
              {importantRecent.map((article) => renderArticleCard(article))}
            </div>
          )}

          {showArticleList && last7Days.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-100 p-1.5">
                  <Clock className="h-4 w-4 text-blue-600" />
                </div>
                <h2 className="text-lg font-semibold">Last 7 Days</h2>
                <Badge variant="outline" className="text-xs">
                  {last7Days.length}
                </Badge>
              </div>
              {last7Days.map((article) => renderArticleCard(article))}
            </div>
          )}

          {showArticleList && (olderArticles.length > 0 || hasMoreToLoad) && (
            <div className="space-y-4">
              {!showOlder ? (
                <div className="text-center py-6 border rounded-xl bg-muted/30">
                  <p className="text-sm text-muted-foreground mb-3">
                    {olderArticles.length > 0
                      ? `${olderArticles.length} older article${olderArticles.length === 1 ? "" : "s"} from the last 30 days`
                      : "Load articles from the last 30 days"}
                  </p>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setShowOlder(true);
                      if (hasMoreToLoad) void loadOlder();
                    }}
                  >
                    <Clock className="h-4 w-4 mr-2" />
                    Load last 30 days
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-gray-100 p-1.5">
                      <Clock className="h-4 w-4 text-gray-600" />
                    </div>
                    <h2 className="text-lg font-semibold">Last 30 Days</h2>
                    <Badge variant="outline" className="text-xs">
                      {olderArticles.length}
                    </Badge>
                  </div>
                  {olderArticles.map((article) => renderArticleCard(article))}
                  {hasMoreToLoad && (
                    <div className="text-center pt-2">
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => void loadOlder()}
                        disabled={loadingOlder}
                      >
                        {loadingOlder ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin inline" />
                            Loading...
                          </>
                        ) : (
                          "Load more"
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            Trusted News Sources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {TRUSTED_GRID_BUCKETS.map((key) => {
              const s = SOURCE_BUCKET_COPY[key];
              const href = TRUSTED_SOURCE_HOME[key];
              return (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-center p-4 border rounded-lg hover:bg-muted/40 transition-colors block"
                >
                  <h3 className="font-medium mb-1">{s.title}</h3>
                  <p className="text-xs text-muted-foreground">{s.subtitle}</p>
                </a>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
