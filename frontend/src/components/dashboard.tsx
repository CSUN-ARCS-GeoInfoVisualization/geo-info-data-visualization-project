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
//import { MapPlaceholder } from "./map-placeholder";
import { Map, Marker } from '@vis.gl/react-google-maps';
import { GoogleRiskMap } from "./GoogleRiskMap";
import PredictionPanel from "./PredictionPanel";

export function Dashboard() {
  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Geo Info Data Visualization Project</h1>
            <p className="text-muted-foreground">
              Wildfire Prediction Senior Research Project conducted at California State University, Northridge

              Team Members:

              Ido Cohen,
              Alex Hernandez-Abrego,
              Sannia Jean,
              Ivan Lopez,
              Tony Song
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
        <div className="bg-white rounded-xl p-6 shadow border flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-700 font-medium"> Prediction</h3>
            <Eye className="h-5 w-5 text-gray-400" />
          </div>
          <PredictionPanel />
        </div>

      </div>

      {/* Charts and Map Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <RiskChart title="7-Day Risk Forecast" type="area" />
        <GoogleRiskMap />
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