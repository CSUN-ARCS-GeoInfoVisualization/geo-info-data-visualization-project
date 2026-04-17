import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Loader2 } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import { apiFetch } from "../services/api";

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
        // Fetch 7-day weather forecast from Open-Meteo
        const url =
          `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${lat}&longitude=${lon}` +
          `&daily=temperature_2m_max,relative_humidity_2m_mean,wind_speed_10m_max` +
          `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
          `&timezone=auto&forecast_days=7`;
        const res = await fetch(url);
        const forecast = await res.json();

        if (forecast.daily) {
          const days: DayData[] = [];
          for (let i = 0; i < 7; i++) {
            const date = new Date(forecast.daily.time[i]);
            const temp = forecast.daily.temperature_2m_max[i];
            const hum = forecast.daily.relative_humidity_2m_mean[i];
            const wind = forecast.daily.wind_speed_10m_max[i];

            // Calculate risk score using the ML model via backend
            let risk = 0;
            try {
              const r = await apiFetch("/predict/batch", {
                method: "POST",
                body: JSON.stringify({ items: [{ lat, lon }] }),
              });
              if (r.ok) {
                const d = await r.json();
                risk = (d.results?.[0]?.prediction?.risk_probability ?? 0) * 5;
              }
            } catch {
              // Estimate risk from weather: higher temp + wind + lower humidity = higher risk
              risk = Math.min(5, ((temp - 60) / 20 + (30 - hum) / 30 + wind / 40) * 2);
              risk = Math.max(0, Math.round(risk * 10) / 10);
            }

            // Adjust risk slightly per day based on weather variation
            const weatherFactor = ((temp - 70) / 30 + (50 - hum) / 50 + wind / 50);
            const adjustedRisk = Math.max(0, Math.min(5, risk + weatherFactor * 0.5));

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
              <YAxis domain={[0, 5]} className="text-xs" tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="risk" stroke="#ef4444" fill="#fecaca" strokeWidth={2} />
            </AreaChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" className="text-xs" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 5]} className="text-xs" tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="risk" stroke="#ef4444" strokeWidth={3}
                dot={{ fill: "#ef4444", strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, stroke: "#ef4444", strokeWidth: 2 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
