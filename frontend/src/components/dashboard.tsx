import { 
  Thermometer, 
  Droplets, 
  Wind, 
  Eye,
  LogIn,
  UserPlus
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { RiskLevelBadge } from "./risk-level-badge";
import { ConditionCard } from "./condition-card";
import { RiskChart } from "./risk-chart";
import { ActiveAlerts } from "./active-alerts";
import { FIRMSMap } from "./FIRMSMap";
import PredictionPanel from "./PredictionPanel";
import PredictionConditionCard from "./PredictionConditionCard";
import { Button } from "./ui/button";

interface DashboardProps {
  isAuthenticated?: boolean;
  onLoginClick?: () => void;
}

export function Dashboard({
  isAuthenticated = false,
  onLoginClick,
}: DashboardProps) {
  return (
    <div className="space-y-8">

      {/* --- LOGIN WIDGET (only shows if not authenticated) --- */}
      {!isAuthenticated && (
        <Card className="bg-gradient-to-r from-red-50 to-orange-50 border-red-200">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex-1 text-center md:text-left">
                <h3 className="font-semibold mb-1">Unlock Full Features</h3>
                <p className="text-sm text-muted-foreground">
                  Sign in for alerts, track locations, and get personalized wildfire notifications
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={onLoginClick}
                  className="bg-red-500 hover:bg-red-600"
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Login
                </Button>

                <Button
                  onClick={onLoginClick}
                  variant="outline"
                  className="border-red-300 hover:bg-red-50"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Create Account
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- HERO SECTION --- */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Geo Info Data Visualization Project</h1>
            <p className="text-muted-foreground">
              Wildfire Prediction Senior Research Project conducted at California State University, Northridge
              <br />
              <strong>Team Members:</strong> Ido Cohen, Alex Hernandez-Abrego, Sannia Jean, Ivan Lopez, Tony Song
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

      {/* --- CURRENT CONDITIONS GRID --- */}
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

        {/* Your prediction module stays untouched */}
        <PredictionPanel />
      </div>

      {/* --- CHART + ACTIVE FIRES MAP GRID --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <RiskChart title="7-Day Risk Forecast" type="area" />
        <FIRMSMap />
      </div>

      {/* --- DETAILED ANALYSIS --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <RiskChart title="Hourly Risk Trends" type="line" />
        </div>
        <ActiveAlerts />
      </div>

      {/* --- ADDITIONAL INFO CARDS --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        <Card>
          <CardHeader><CardTitle>Fire Weather Index</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600 mb-2">4.2</div>
            <p className="text-sm text-muted-foreground">
              High fire weather conditions expected. Exercise extreme caution with any outdoor activities involving fire.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fuel Moisture</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 mb-2">8%</div>
            <p className="text-sm text-muted-foreground">
              Critically low fuel moisture levels. Vegetation is extremely dry and highly flammable.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Active Fires</CardTitle></CardHeader>
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