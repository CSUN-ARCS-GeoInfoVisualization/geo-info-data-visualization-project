import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { AlertTriangle, Flame, Wind, Loader2 } from "lucide-react";
import { fetchNews, type NewsArticleDTO } from "../services/newsApi";

function formatTimeAgo(iso: string): string {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  return `${Math.floor(sec / 86400)} days ago`;
}

function getAlertIcon(category: string) {
  if (category === "breaking") return AlertTriangle;
  if (category === "updates") return Flame;
  return Wind;
}

function getSeverity(article: NewsArticleDTO): string {
  if (article.is_breaking) return "high";
  if (article.category === "updates") return "moderate";
  return "low";
}

export function ActiveAlerts() {
  const [articles, setArticles] = useState<NewsArticleDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNews("recent", "all", { limit: 5 })
      .then((data) => setArticles(data.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high": return "bg-red-100 text-red-800 border-red-200";
      case "moderate": return "bg-orange-100 text-orange-800 border-orange-200";
      case "low": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Active Alerts
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {articles.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground text-center py-4">No active alerts</p>
        )}
        {articles.map((article) => {
          const Icon = getAlertIcon(article.category);
          const severity = getSeverity(article);
          return (
            <Alert key={article.id} className={`border-l-4 ${article.is_breaking ? "border-l-red-500" : "border-l-orange-500"}`}>
              <Icon className="h-4 w-4" />
              <AlertDescription>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{article.title}</span>
                      <Badge variant="outline" className={getSeverityColor(severity)}>
                        {severity}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-1 line-clamp-2">
                      {article.summary}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{article.source_label}</span>
                      <span>{formatTimeAgo(article.published_at)}</span>
                    </div>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          );
        })}
      </CardContent>
    </Card>
  );
}
