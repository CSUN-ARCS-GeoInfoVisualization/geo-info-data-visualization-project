import { useEffect, useRef, useState } from "react";
import { Flame } from "lucide-react";
import { fetchNews, type NewsArticleDTO } from "../services/newsApi";

export function NewsTicker() {
  const [articles, setArticles] = useState<NewsArticleDTO[]>([]);
  const [status, setStatus] = useState<"loading" | "done" | "empty">("loading");
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchNews("recent", "breaking", { offset: 0, limit: 3 })
      .then((data) => {
        setArticles(data.items);
        setStatus(data.items.length > 0 ? "done" : "empty");
      })
      .catch(() => setStatus("empty"));
  }, []);

  const headlines =
    status === "done" && articles.length > 0
      ? articles.map((a) => a.title)
      : status === "empty"
      ? ["No recent fire news"]
      : ["Loading…"];

  const joined = headlines.join(" | ");
  const repeated = [joined, joined];

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 overflow-hidden">
      <div className="flex items-center gap-1.5 shrink-0 text-orange-500">
        <Flame className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">Breaking</span>
      </div>
      <div className="w-px h-4 bg-border shrink-0" />
      <div className="flex-1 overflow-hidden">
        <div
          ref={trackRef}
          className="flex gap-12 whitespace-nowrap"
          style={{
            animation: status === "done" ? "ticker-scroll 30s linear infinite" : "none",
          }}
        >
          {repeated.map((text, i) => (
            <span key={i} className="text-sm text-muted-foreground shrink-0">
              {text}
            </span>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
