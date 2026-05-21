import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Loader2 } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import { apiFetch } from "../services/api";
import { fetchOpenMeteo } from "../lib/openMeteoCache";

interface DayData {
  day: string;
  risk: number;
  temperature: number;
  humidity: number;
  wind: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface RiskChartProps {
  title: string;
  type?: "line" | "area";
  lat?: number;
  lon?: number;
}

export function RiskChart({ title, type = "line", lat = 34.0522, lon = -118.2437 }: RiskChartProps) {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchForecast() {
      setLoading(true);
      try {
        // Two requests in PARALLEL — Open-Meteo forecast and ONE ML prediction.
        // The previous version fired /predict/batch 7 times sequentially with
        // identical inputs (same lat/lon every iteration), turning a ~500ms
        // chart into a ~4s chart. The base risk only depends on lat/lon, so
        // one call is correct; per-day variation is layered on from weather.
        const url =
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${lat}&longitude=${lon}` +
          `&daily=temperature_2m_max,relative_humidity_2m_mean,wind_speed_10m_max` +
          `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
          `&timezone=auto&forecast_days=7`;
        const [forecastRes, predictRes] = await Promise.all([
          fetchOpenMeteo<any>(url),
          apiFetch("/predict/batch", {
            method: "POST",
            body: JSON.stringify({ items: [{ lat, lon }] }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);

        const baseRisk = (predictRes?.results?.[0]?.prediction?.risk_probability ?? null);

        if (forecastRes.daily) {
          const days: DayData[] = [];
          for (let i = 0; i < 7; i++) {
            const date = new Date(forecastRes.daily.time[i]);
            const temp = forecastRes.daily.temperature_2m_max[i];
            const hum = forecastRes.daily.relative_humidity_2m_mean[i];
            const wind = forecastRes.daily.wind_speed_10m_max[i];

            // Use the ML base risk if we got it; otherwise fall back to a
            // weather-only heuristic so the chart still renders during outages.
            // The model emits a probability in [0,1] — ×10 puts it on the
            // familiar 0–10 "rate it" scale that the y-axis renders.
            let risk = baseRisk !== null
              ? baseRisk * 10
              : Math.max(0, Math.min(10,
                  ((temp - 60) / 20 + (30 - hum) / 30 + wind / 40) * 4));

            // Per-day adjustment from local weather variation.
            // Coefficient is sized for the 0–10 range (was 0.5 on the old 0–5 range).
            const weatherFactor = ((temp - 70) / 30 + (50 - hum) / 50 + wind / 50);
            const adjustedRisk = Math.max(0, Math.min(10, risk + weatherFactor));

            days.push({
              day: DAYS[date.getDay()],
              risk: Math.round(adjustedRisk * 10) / 10,
              temperature: Math.round(temp),
              humidity: Math.round(hum),
              wind: Math.round(wind),
            });
          }
          setData(days);
        }
      } catch {
        // Fallback to minimal data
        setData(DAYS.map((d) => ({ day: d, risk: 0, temperature: 0, humidity: 0, wind: 0 })));
      }
      setLoading(false);
    }
    fetchForecast();
  }, [lat, lon]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3">
          <p className="font-medium">{label}</p>
          <p className="text-sm text-red-600">Risk Level: {payload[0].value}</p>
          <p className="text-sm text-orange-600">Temperature: {payload[0].payload.temperature}°F</p>
          <p className="text-sm text-blue-600">Humidity: {payload[0].payload.humidity}%</p>
          <p className="text-sm text-purple-600">Wind: {payload[0].payload.wind} mph</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          {type === "area" ? (
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" className="text-xs" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 10]} className="text-xs" tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="risk" stroke="#ef4444" fill="#fecaca" strokeWidth={2} />
            </AreaChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" className="text-xs" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 10]} className="text-xs" tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="risk" stroke="#ef4444" strokeWidth={3}
                dot={{ fill: "#ef4444", strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, stroke: "#ef4444", strokeWidth: 2 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>

        <div className="mt-4 space-y-2 text-xs text-muted-foreground leading-relaxed">
          <p>
            <span className="font-medium text-foreground">How this is calculated.</span>{" "}
            A baseline risk for this location is produced by FireScope's calibrated machine-learning
            model (random forest, six inputs: vegetation greenness, temperature, wind, humidity,
            elevation, and the Keetch-Byram drought index). That baseline is then nudged up or down
            for each of the next 7 days using the local Open-Meteo weather forecast — hotter, drier,
            and windier days push the line higher.
          </p>
          <p>
            <span className="font-medium text-foreground">Why it's on a 0–10 scale.</span>{" "}
            The model emits a probability between 0 and 1. The chart multiplies by 10 so the line
            reads on the familiar 0–10 "rate it" scale and small day-to-day shifts in the forecast
            are easy to see. This is a display scale only — it isn't tied to the Low / Medium /
            High / Extreme labels used on the risk maps.
          </p>
          <p>
            <span className="font-medium text-foreground">Reading the line.</span>{" "}
            A flat or low line (≲ 4) means the location's underlying conditions are mild and the
            week's weather isn't expected to make things worse. A line trending upward (≳ 6) means
            the forecast is loading on heat, low humidity, or wind on top of an already dry,
            high-vegetation, or drought-stressed location — the days at the top of the curve are
            the days to watch.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
