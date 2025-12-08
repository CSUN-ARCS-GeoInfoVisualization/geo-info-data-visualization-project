import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { LucideIcon } from "lucide-react";

interface ConditionCardProps {
  title: string;
  value: string;
  unit?: string;
  icon: LucideIcon;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
}

export function ConditionCard({ 
  title, 
  value, 
  unit, 
  icon: Icon, 
  trend, 
  trendValue,
  children
}: ConditionCardProps) {
  const getTrendColor = () => {
    switch (trend) {
      case "up":
        return "text-red-500";
      case "down":
        return "text-green-500";
      case "stable":
        return "text-gray-500";
      default:
        return "text-gray-500";
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case "up":
        return "↗";
      case "down":
        return "↘";
      case "stable":
        return "→";
      default:
        return "";
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline space-x-1">
          <div className="text-2xl font-bold">
            {value}
          </div>
          {unit && (
            <span className="text-sm text-muted-foreground">
              {unit}
            </span>
          )}
        </div>
        {trend && trendValue && (
          <div className={`flex items-center text-xs ${getTrendColor()} mt-1`}>
            <span className="mr-1">{getTrendIcon()}</span>
            {trendValue}
          </div>
        )}
    {children && <div className="mt-4">{children}</div>}
      </CardContent>
    </Card>
  );
}