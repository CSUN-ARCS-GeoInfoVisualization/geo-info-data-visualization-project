import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { AlertTriangle, Flame, Wind } from "lucide-react";

const alerts = [
  {
    id: 1,
    type: "warning",
    title: "Red Flag Warning",
    description: "High winds and low humidity create extreme fire weather conditions",
    location: "Northern Counties",
    severity: "high",
    icon: AlertTriangle,
    time: "2 hours ago"
  },
  {
    id: 2,
    type: "fire",
    title: "Active Fire Detected",
    description: "Small fire reported near Highway 101, contained by local fire department",
    location: "Marin County",
    severity: "moderate",
    icon: Flame,
    time: "4 hours ago"
  },
  {
    id: 3,
    type: "wind",
    title: "High Wind Advisory",
    description: "Sustained winds 25-35 mph with gusts up to 50 mph expected",
    location: "Bay Area",
    severity: "moderate",
    icon: Wind,
    time: "6 hours ago"
  }
];

export function ActiveAlerts() {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high":
        return "bg-red-100 text-red-800 border-red-200";
      case "moderate":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "low":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Active Alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerts.map((alert) => (
          <Alert key={alert.id} className="border-l-4 border-l-orange-500">
            <alert.icon className="h-4 w-4" />
            <AlertDescription>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{alert.title}</span>
                    <Badge 
                      variant="outline" 
                      className={getSeverityColor(alert.severity)}
                    >
                      {alert.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">
                    {alert.description}
                  </p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{alert.location}</span>
                    <span>{alert.time}</span>
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}