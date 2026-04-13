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

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    setError(null);
    setItems([]);
    try {
      const data = await fetchNews("recent", selectedCategory, { offset: 0 });
      setItems(data.items);
      setHasMoreToLoad(data.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load news");
      setItems([]);
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

  const breakingNews = items.filter((article) => article.is_breaking);

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
            Articles from the last 90 days: official feeds plus web discovery when configured. New
            URLs are saved for training; duplicates are skipped. Use Load more for the next page.
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

      {error && (
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

          {showArticleList &&
            filteredArticles.map((article) => {
              const bucket =
                SOURCE_BUCKET_COPY[article.source_bucket] ?? SOURCE_BUCKET_COPY.emergency;
              return (
                <Card
                  key={article.id}
                  className={article.is_breaking ? "border-red-200 bg-red-50/30" : ""}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {getCategoryBadge(article.category)}
                          {article.is_fallback && (
                            <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50">
                              Web discovery
                            </Badge>
                          )}
                          {article.is_breaking && (
                            <Badge className="bg-red-100 text-red-800 border-red-200 animate-pulse">
                              Breaking
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="text-xl mb-2">{article.title}</CardTitle>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4 shrink-0" />
                            {formatRelativeTime(article.published_at)}
                          </div>
                          <span className="hidden sm:inline">•</span>
                          <span>
                            {bucket.title} — {article.source_label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{bucket.subtitle}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground mb-4">{article.summary}</p>

                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary" className="text-xs">
                          {article.source_bucket === "cal_fire"
                            ? "State agency"
                            : article.source_bucket === "nws"
                              ? "Weather"
                              : article.source_bucket === "emergency"
                                ? "Emergency"
                                : article.source_bucket === "web_discovery"
                                  ? "Search"
                                  : "Local FD"}
                        </Badge>
                      </div>
                      {article.url ? (
                        <Button variant="outline" size="sm" asChild>
                          <a href={article.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-2 inline" />
                            Source
                          </a>
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" type="button" disabled>
                          <ExternalLink className="h-4 w-4 mr-2 inline" />
                          Source
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

          {showArticleList && (
            <div className="text-center pt-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder || !hasMoreToLoad}
              >
                {loadingOlder ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin inline" />
                    Loading…
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
              <p className="text-xs text-muted-foreground mt-2 max-w-md mx-auto">
                {hasMoreToLoad
                  ? "Loads the next page of items (same 90-day pool: feeds + web discovery)."
                  : "No more articles in this category for the last 90 days."}
              </p>
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
