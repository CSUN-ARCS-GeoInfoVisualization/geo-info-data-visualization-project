import { Badge } from "./ui/badge";

export type RiskLevel = "low" | "moderate" | "high" | "extreme";

interface RiskLevelBadgeProps {
  level: RiskLevel;
  size?: "default" | "sm" | "lg";
}

export function RiskLevelBadge({ level, size = "default" }: RiskLevelBadgeProps) {
  const getRiskConfig = (level: RiskLevel) => {
    switch (level) {
      case "low":
        return {
          label: "Low Risk",
          className: "bg-green-100 text-green-800 border-green-200",
        };
      case "moderate":
        return {
          label: "Moderate Risk",
          className: "bg-yellow-100 text-yellow-800 border-yellow-200",
        };
      case "high":
        return {
          label: "High Risk",
          className: "bg-orange-100 text-orange-800 border-orange-200",
        };
      case "extreme":
        return {
          label: "Extreme Risk",
          className: "bg-red-100 text-red-800 border-red-200",
        };
    }
  };

  const config = getRiskConfig(level);

  return (
    <Badge 
      variant="outline" 
      className={`${config.className} border ${
        size === "sm" ? "text-xs px-2 py-1" : 
        size === "lg" ? "text-base px-4 py-2" : 
        "text-sm px-3 py-1"
      }`}
    >
      {config.label}
    </Badge>
  );
}