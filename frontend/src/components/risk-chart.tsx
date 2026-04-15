import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { apiFetch } from "../services/api";

const DEMO_RISK_DATA = [
  { day: "Mon", risk: 2.5, temperature: 78, humidity: 45 },
  { day: "Tue", risk: 3.2, temperature: 82, humidity: 38 },
  { day: "Wed", risk: 4.1, temperature: 86, humidity: 32 },
  { day: "Thu", risk: 4.8, temperature: 89, humidity: 28 },
  { day: "Fri", risk: 3.9, temperature: 84, humidity: 35 },
  { day: "Sat", risk: 3.1, temperature: 80, humidity: 42 },
  { day: "Sun", risk: 2.8, temperature: 79, humidity: 48 },
];

type Row = { day: string; risk: number; temperature: number; humidity: number };

interface RiskChartProps {
  title: string;
  type?: "line" | "area";
  /** When set with longitude, loads Open-Meteo + API risk for a live 7-day series. */
  latitude?: number;
  longitude?: number;
}

export function RiskChart({ title, type = "line", latitude, longitude }: RiskChartProps) {
  const [data, setData] = useState<Row[]>(DEMO_RISK_DATA);
  const [loading, setLoading] = useState(false);
  const [subtitle, setSubtitle] = useState<string | null>(null);

  useEffect(() => {
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      setData(DEMO_RISK_DATA);
      setSubtitle("Demo data — add a saved location for a forecast tied to your place.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSubtitle(null);

    async function load() {
      try {
        const weatherUrl =
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&daily=temperature_2m_max,relative_humidity_2m_mean` +
          `&temperature_unit=fahrenheit&forecast_days=7&timezone=auto`;
        const wRes = await fetch(weatherUrl);
        if (!wRes.ok) throw new Error("weather");
        const wJson = await wRes.json();
        const times: string[] = wJson.daily?.time ?? [];
        const temps: number[] = wJson.daily?.temperature_2m_max ?? [];
        const hums: number[] = wJson.daily?.relative_humidity_2m_mean ?? [];
        if (times.length === 0) throw new Error("no daily");

        let baseRisk = 2.5;
        try {
          const pRes = await apiFetch("/predict/batch", {
            method: "POST",
            body: JSON.stringify({ items: [{ lat: latitude, lon: longitude }] }),
          });
          if (pRes.ok) {
            const pJson = await pRes.json();
            const prob = pJson.results?.[0]?.prediction?.risk_probability;
            if (typeof prob === "number") {
              baseRisk = Math.min(5, Math.max(0, prob * 5));
            }
          }
        } catch {
          /* API URL unset or unreachable — keep default baseRisk */
        }

        const refTemp = temps[0] ?? 75;
        const rows: Row[] = times.map((date: string, i: number) => {
          const day = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
          const temperature = Math.round(temps[i] ?? 0);
          const humidity = Math.round(hums[i] ?? 0);
          const temp = temps[i] ?? refTemp;
          const drift = (temp - refTemp) * 0.06;
          const risk = Math.min(5, Math.max(0, baseRisk + drift));
          return { day, risk, temperature, humidity };
        });

        if (!cancelled) {
          setData(rows);
          setSubtitle("Open-Meteo weather + model risk baseline for this location.");
        }
      } catch {
        if (!cancelled) {
          setData(DEMO_RISK_DATA);
          setSubtitle("Could not load live forecast — showing demo data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3">
          <p className="font-medium">{label}</p>
          <p className="text-sm text-red-600">
            Risk index: {Number(payload[0].value).toFixed(1)}
          </p>
          <p className="text-sm text-orange-600">
            Temp (high): {payload[0].payload.temperature}°F
          </p>
          <p className="text-sm text-blue-600">
            Humidity: {payload[0].payload.humidity}%
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {loading && (
          <p className="text-xs text-muted-foreground">Loading forecast…</p>
        )}
        {subtitle && !loading && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          {type === "area" ? (
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" className="text-xs" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 5]} className="text-xs" tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="risk"
                stroke="#ef4444"
                fill="#fecaca"
                strokeWidth={2}
              />
            </AreaChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" className="text-xs" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 5]} className="text-xs" tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="risk"
                stroke="#ef4444"
                strokeWidth={3}
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
