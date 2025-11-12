import { 
  Thermometer, 
  Droplets, 
  Wind, 
  Eye
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { RiskLevelBadge } from "./risk-level-badge";
import { ConditionCard } from "./condition-card";
import { RiskChart } from "./risk-chart";
import { ActiveAlerts } from "./active-alerts";
import { MapPlaceholder } from "./map-placeholder";

export function Dashboard() {
  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Wildfire Risk Dashboard</h1>
            <p className="text-muted-foreground">
              Real-time wildfire risk assessment and monitoring for your area
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Current Risk Level</p>
              <RiskLevelBadge level="high" size="lg" />
            </div>
          </div>
        </div>
      </div>

      {/* Current Conditions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <ConditionCard
          title="Temperature"
          value="89"
          unit="°F"
          icon={Thermometer}
          trend="up"
          trendValue="+5°F from yesterday"
        />
        <ConditionCard
          title="Humidity"
          value="28"
          unit="%"
          icon={Droplets}
          trend="down"
          trendValue="-12% from yesterday"
        />
        <ConditionCard
          title="Wind Speed"
          value="25"
          unit="mph"
          icon={Wind}
          trend="up"
          trendValue="Gusts up to 45 mph"
        />
        <ConditionCard
          title="Visibility"
          value="8"
          unit="miles"
          icon={Eye}
          trend="stable"
          trendValue="Good conditions"
        />
      </div>

      {/* Charts and Map Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <RiskChart title="7-Day Risk Forecast" type="area" />
        <MapPlaceholder />
      </div>

      {/* Detailed Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <RiskChart title="Hourly Risk Trends" type="line" />
        </div>
        <ActiveAlerts />
      </div>

      {/* Additional Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Fire Weather Index</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600 mb-2">4.2</div>
            <p className="text-sm text-muted-foreground">
              High fire weather conditions expected. Exercise extreme caution with any outdoor activities involving fire.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fuel Moisture</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 mb-2">8%</div>
            <p className="text-sm text-muted-foreground">
              Critically low fuel moisture levels. Vegetation is extremely dry and highly flammable.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Fires</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 mb-2">3</div>
            <p className="text-sm text-muted-foreground">
              Currently monitoring 3 active fires in the region. All are contained but under surveillance.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}