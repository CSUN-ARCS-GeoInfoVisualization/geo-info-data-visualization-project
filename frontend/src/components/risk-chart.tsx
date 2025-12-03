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
  Area
} from "recharts";

const riskData = [
  { day: "Mon", risk: 2.5, temperature: 78, humidity: 45 },
  { day: "Tue", risk: 3.2, temperature: 82, humidity: 38 },
  { day: "Wed", risk: 4.1, temperature: 86, humidity: 32 },
  { day: "Thu", risk: 4.8, temperature: 89, humidity: 28 },
  { day: "Fri", risk: 3.9, temperature: 84, humidity: 35 },
  { day: "Sat", risk: 3.1, temperature: 80, humidity: 42 },
  { day: "Sun", risk: 2.8, temperature: 79, humidity: 48 },
];

interface RiskChartProps {
  title: string;
  type?: "line" | "area";
}

export function RiskChart({ title, type = "line" }: RiskChartProps) {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3">
          <p className="font-medium">{label}</p>
          <p className="text-sm text-red-600">
            Risk Level: {payload[0].value}
          </p>
          <p className="text-sm text-orange-600">
            Temperature: {payload[0].payload.temperature}°F
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
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          {type === "area" ? (
            <AreaChart data={riskData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="day" 
                className="text-xs"
                tick={{ fontSize: 12 }}
              />
              <YAxis 
                domain={[0, 5]}
                className="text-xs"
                tick={{ fontSize: 12 }}
              />
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
            <LineChart data={riskData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="day" 
                className="text-xs"
                tick={{ fontSize: 12 }}
              />
              <YAxis 
                domain={[0, 5]}
                className="text-xs"
                tick={{ fontSize: 12 }}
              />
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