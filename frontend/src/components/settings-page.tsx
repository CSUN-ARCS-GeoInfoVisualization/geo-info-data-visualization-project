import { useEffect, useState } from "react";
import { User, MapPin, Bell, Shield, ChevronRight, Info, Satellite, Building2, Newspaper, Map, Brain } from "lucide-react";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { MyLocations } from "./my-locations";
import { NotificationSettings } from "./notification-settings";
import { apiFetch } from "../services/api";

interface UserProfile {
  id: number;
  email: string;
  role: string;
}

type Tab = "profile" | "locations" | "notifications" | "about";

interface SettingsPageProps {
  defaultTab?: Tab;
}

const ROLE_COLORS: Record<string, string> = {
  Admin: "bg-red-100 text-red-700 border-red-200",
  Researcher: "bg-blue-100 text-blue-700 border-blue-200",
  Resident: "bg-green-100 text-green-700 border-green-200",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  Admin: "Full access to all system features and user management.",
  Researcher: "Access to detailed prediction data and analytics.",
  Resident: "Access to risk predictions and alert notifications.",
};

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType; description: string }[] = [
  { id: "profile", label: "Profile", icon: User, description: "Your account details" },
  { id: "locations", label: "My Locations", icon: MapPin, description: "Saved places & risk" },
  { id: "notifications", label: "Alert Preferences", icon: Bell, description: "Notification settings" },
  { id: "about", label: "About", icon: Info, description: "Data sources & credits" },
];

export function SettingsPage({ defaultTab = "profile" }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab ?? "profile");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    apiFetch("/me")
      .then(async (r) => { if (r.ok) setProfile(await r.json()); })
      .catch(() => {})
      .finally(() => setLoadingProfile(false));
  }, []);

  return (
    <div className="space-y-2">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account, saved locations, and alert preferences
        </p>
      </div>

      <div className="flex gap-6 items-start">
        {/* Sidebar nav */}
        <aside className="w-52 shrink-0 hidden sm:block">
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ id, label, icon: Icon, description }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-lg transition-colors group ${
                  activeTab === id
                    ? "bg-red-50 text-red-600"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${activeTab === id ? "text-red-500" : ""}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${activeTab === id ? "text-red-600" : ""}`}>
                    {label}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{description}</p>
                </div>
                {activeTab === id && <ChevronRight className="h-3.5 w-3.5 text-red-400 shrink-0" />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">

          {/* Profile */}
          {activeTab === "profile" && (
            <div className="border rounded-xl bg-white overflow-hidden">
              <div className="px-6 py-4 border-b bg-muted/30">
                <h2 className="font-semibold text-base">Account Information</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Your registered account details</p>
              </div>
              <div className="divide-y">
                {loadingProfile ? (
                  <div className="px-6 py-6 space-y-4">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-5 w-56" />
                  </div>
                ) : profile ? (
                  <>
                    <div className="px-6 py-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">User ID</p>
                        <p className="text-sm font-mono text-foreground">#{profile.id}</p>
                      </div>
                    </div>
                    <div className="px-6 py-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Email</p>
                        <p className="text-sm text-foreground">{profile.email}</p>
                      </div>
                    </div>
                    <div className="px-6 py-4">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">Role</p>
                      <div className="flex items-center gap-3">
                        <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ROLE_COLORS[profile.role] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                          {profile.role}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {ROLE_DESCRIPTIONS[profile.role]}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="px-6 py-6 text-sm text-muted-foreground">Could not load profile.</div>
                )}
              </div>
            </div>
          )}

          {/* My Locations */}
          {activeTab === "locations" && (
            <div className="border rounded-xl bg-white overflow-hidden">
              <div className="px-6 py-4 border-b bg-muted/30">
                <h2 className="font-semibold text-base">My Locations</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Save places and check their wildfire risk</p>
              </div>
              <div className="px-6 py-6">
                <MyLocations />
              </div>
            </div>
          )}

          {/* Alert Preferences — reuses the full NotificationSettings component */}
          {activeTab === "notifications" && (
            <NotificationSettings token={localStorage.getItem("token") || ""} />
          )}

          {/* About — Data Sources & Credits */}
          {activeTab === "about" && (
            <div className="space-y-6">
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30">
                  <h2 className="font-semibold text-base">About FireScope</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    FireScope aggregates open-source data from government agencies, satellite systems, and news providers to deliver real-time wildfire risk intelligence for California.
                  </p>
                </div>
                <div className="px-6 py-5 text-sm text-muted-foreground">
                  All data is sourced from publicly available APIs and open datasets. FireScope does not generate fire reports — it visualizes and analyzes data from the sources listed below.
                </div>
              </div>

              {/* Satellite Data */}
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-2">
                  <Satellite className="h-4 w-4 text-blue-500" />
                  <h3 className="font-semibold text-sm">Satellite Data</h3>
                </div>
                <div className="divide-y">
                  <AboutItem
                    name="NASA FIRMS (VIIRS SNPP)"
                    description="Real-time satellite fire detection. Provides active fire hotspots with latitude, longitude, confidence level, and Fire Radiative Power (FRP) measurements updated multiple times daily."
                    badge="Real-time"
                    badgeColor="bg-red-100 text-red-700"
                  />
                  <AboutItem
                    name="NASA ORNL DAAC — MODIS (MOD13Q1)"
                    description="Enhanced Vegetation Index (EVI) data used to assess fire fuel load and vegetation dryness. Sourced from the MODIS satellite via the Oak Ridge National Laboratory DAAC web service."
                    badge="250m resolution"
                    badgeColor="bg-green-100 text-green-700"
                  />
                </div>
              </div>

              {/* Fire Agencies */}
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-orange-500" />
                  <h3 className="font-semibold text-sm">Fire Agencies</h3>
                </div>
                <div className="divide-y">
                  <AboutItem
                    name="CAL FIRE Incidents API"
                    description="California Department of Forestry and Fire Protection active incident data — fire name, county, acres, percent contained. Used on the Active Fires map and as the containment-enrichment source when NIFC perimeters have null containment."
                    badge="State agency"
                    badgeColor="bg-orange-100 text-orange-700"
                  />
                  <AboutItem
                    name="NIFC WFIGS Interagency Perimeters (YearToDate)"
                    description="National Interagency Fire Center year-to-date California fire perimeter polygons with incident names, acreage, and containment status. The Active Fires map only renders perimeters where containment is below 100% — fully contained fires are hidden."
                    badge="Federal"
                    badgeColor="bg-amber-100 text-amber-700"
                  />
                  <AboutItem
                    name="NIFC WFIGS Incident Locations (YearToDate)"
                    description="Point-level WFIGS incident records with IRWIN IDs and PercentContained. Used to backfill containment percentages onto perimeter polygons that the perimeter layer reports as null, so the 4-tier color coding can actually kick in."
                    badge="Federal"
                    badgeColor="bg-amber-100 text-amber-700"
                  />
                  <AboutItem
                    name="CAL FIRE Historic Fire Perimeters (1878–present)"
                    description="California's authoritative fire-perimeter archive — 22k+ polygons back to 1878. Powers the History page's year-by-year selector; fetched server-side via /api/history/perimeters?year=N with a 1-hour cache. Filter: GIS_ACRES ≥ 100."
                    badge="State agency"
                    badgeColor="bg-orange-100 text-orange-700"
                  />
                  <AboutItem
                    name="CAL FIRE DINS (Damage Inspection)"
                    description="Post-fire structure damage inspection records available via /api/history/dins. Endpoint shipped; UI layer is currently disabled on the History page."
                    badge="State agency"
                    badgeColor="bg-orange-100 text-orange-700"
                  />
                  <AboutItem
                    name="FEMA National Shelter System"
                    description="Backend proxy /api/shelters queries FEMA's NSS (FEMA_NSS + OpenShelters fallback) for active California emergency shelters. Populates the Evacuation Routes map shelter clusters when FEMA has an open event for CA; otherwise the feed is intentionally empty."
                    badge="Federal"
                    badgeColor="bg-amber-100 text-amber-700"
                  />
                </div>
              </div>

              {/* News & Weather */}
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-2">
                  <Newspaper className="h-4 w-4 text-purple-500" />
                  <h3 className="font-semibold text-sm">News & Weather</h3>
                </div>
                <div className="divide-y">
                  <AboutItem
                    name="National Weather Service (NWS)"
                    description="NOAA weather alerts for California including Red Flag Warnings, Fire Weather Watches, and other hazardous weather advisories delivered via the ATOM feed."
                    badge="Government"
                    badgeColor="bg-blue-100 text-blue-700"
                  />
                  <AboutItem
                    name="GNews API"
                    description="Aggregated news articles from major outlets covering California wildfires, fire prevention, and emergency response. Used to power the news feed and breaking alerts."
                    badge="News aggregator"
                    badgeColor="bg-purple-100 text-purple-700"
                  />
                </div>
              </div>

              {/* Mapping & Visualization */}
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-2">
                  <Map className="h-4 w-4 text-emerald-500" />
                  <h3 className="font-semibold text-sm">Mapping & Visualization</h3>
                </div>
                <div className="divide-y">
                  <AboutItem
                    name="Google Maps Platform"
                    description="Interactive base maps, geocoding, and satellite imagery powering all map views throughout the application."
                    badge="Mapping"
                    badgeColor="bg-emerald-100 text-emerald-700"
                  />
                  <AboutItem
                    name="deck.gl (v9)"
                    description="Open-source WebGL-powered geospatial visualization framework by Vis.gl. Renders fire hotspots, risk heatmaps, zone polygons, and fire perimeter overlays with high-performance GPU acceleration."
                    badge="Open source"
                    badgeColor="bg-gray-100 text-gray-700"
                  />
                </div>
              </div>

              {/* Machine Learning */}
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-2">
                  <Brain className="h-4 w-4 text-red-500" />
                  <h3 className="font-semibold text-sm">Machine Learning</h3>
                </div>
                <div className="divide-y">
                  <AboutItem
                    name="scikit-learn Risk Model (active)"
                    description="Logistic-regression classifier that predicts wildfire risk from four live inputs: EVI (vegetation), LST (land-surface temperature), wind speed, and elevation. Drives the 3-tier risk-zone coloring (green / yellow / red) across Dashboard, Risk Map, and Research views. Per-zone overrides are applied through POST /api/predict-custom."
                    badge="ML model"
                    badgeColor="bg-red-100 text-red-700"
                  />
                  <AboutItem
                    name="ActiveFireSnapshot Pipeline (planned retrain)"
                    description="Tracking schema logged for the next model retrain (option 3): Date, Latitude, Longitude, EVI, TA (thermal anomalies), LST, Wind, Elevation, Fire (binary outcome), NDVI (vegetation cover). Researcher sliders already expose the full feature set so the snapshot-capture job can consume them directly."
                    badge="Pipeline"
                    badgeColor="bg-slate-100 text-slate-700"
                  />
                </div>
              </div>

              {/* Zone Data */}
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-indigo-500" />
                  <h3 className="font-semibold text-sm">Geographic Boundaries</h3>
                </div>
                <div className="px-6 py-4 text-sm text-muted-foreground">
                  Risk zones are available at four levels of granularity: 58 counties, 1,769 ZIP codes, 8,041 census tracts, and 1,521 neighborhoods — all derived from U.S. Census Bureau TIGER/Line shapefiles and California-specific boundary datasets.
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  About section helper                                               */
/* ------------------------------------------------------------------ */
function AboutItem({ name, description, badge, badgeColor }: {
  name: string;
  description: string;
  badge: string;
  badgeColor: string;
}) {
  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-2 mb-1">
        <p className="text-sm font-medium">{name}</p>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badgeColor}`}>{badge}</Badge>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
