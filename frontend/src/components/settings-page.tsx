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
            <NotificationSettings
              token={localStorage.getItem("token") || ""}
              onNavigateToLocations={() => setActiveTab("locations")}
            />
          )}

          {/* About — Data Sources & Credits */}
          {activeTab === "about" && (
            <div className="space-y-6">
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30">
                  <h2 className="font-semibold text-base">About FireScope</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    FireScope aggregates open-source data from government agencies, satellite systems, and news providers to deliver real-time wildfire risk intelligence for California — visualizations, ML risk prediction, and an opt-in email alerts system.
                  </p>
                </div>
                <div className="px-6 py-5 text-sm text-muted-foreground space-y-3">
                  <p>
                    All data is sourced from publicly available APIs and open datasets. FireScope does not generate fire reports — it visualizes and analyzes data from the sources listed below. Risk labels follow the National Fire Danger Rating System (NFDRS) 5-tier scale: Low / Moderate / High / Very High / Extreme.
                  </p>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs pt-2 border-t">
                    <div>
                      <span className="font-semibold text-foreground">Website: </span>
                      <a
                        href="https://firescope.dev"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        firescope.dev
                      </a>
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">Alerts: </span>
                      <a href="mailto:alerts@firescope.dev" className="text-blue-600 hover:underline">alerts@firescope.dev</a>
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">Source: </span>
                      <a
                        href="https://github.com/CSUN-ARCS-GeoInfoVisualization/geo-info-data-visualization-project"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        GitHub repository
                      </a>
                    </div>
                  </div>
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
                    description="California Department of Forestry and Fire Protection active incident data — fire name, county, acres, percent contained, latitude/longitude. Powers three things: (1) the Active Fires list, (2) containment-enrichment when NIFC perimeters report null containment, and (3) circle-polygon fallbacks on every fire map (dashboard, risk map, evacuation routes, research) for incidents from the alerts/news feed that don't yet have a WFIGS perimeter — radius is computed from AcresBurned (equal-area circle, 400 m floor)."
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
                    name="CAL FIRE DINS (Damage Inspection) — 2013 to present"
                    description="Post-fire structure damage inspection records from CAL FIRE's POSTFIRE_MASTER_DATA_SHARE feature service (132,000+ structures statewide). Coverage starts 2013 — older fires don't have DINS records because the program didn't exist. Backend /api/history/dins?year=YYYY filters by INCIDENTSTARTDATE; the History page's 'Structure Damage (DINS)' toggle renders the matching points layered over that year's fire perimeters, plus a per-fire damage breakdown in the fire-info card."
                    badge="State agency · 2013→present"
                    badgeColor="bg-orange-100 text-orange-700"
                  />
                  <AboutItem
                    name="CalOES CA_Shelter_system (replaces FEMA NSS)"
                    description="Backend /api/shelters queries the CalOES-published CA_Shelter_system feature service on services2.arcgis.com — a statewide mirror of the legacy FEMA National Shelter System California subset, with 8,014 pre-staged emergency facilities (5,096 dual-purpose, 2,218 evacuation, 699 post-impact). We migrated off FEMA's own public NSS endpoint after CAL FIRE / FEMA reduced it to currently-open shelters only (~10 features nationwide, zero in CA). Field names are 10-char ArcGIS-shapefile style upstream and remapped server-side to the original FEMA NSS schema (shelter_name, address_1, evacuation_capacity, etc.) so the Shelters & Evacuation page consumes them directly. Refreshes every 6 h; treat as a slow-moving inventory snapshot."
                    badge="State agency"
                    badgeColor="bg-orange-100 text-orange-700"
                  />
                  <AboutItem
                    name="Cal OES CA_EVACUATIONS_PROD (active evacuation zones)"
                    description="Backend /api/evacuation-zones proxies the Cal OES statewide evacuation feature service on services3.arcgis.com — the same source Watch Duty consumes. It aggregates Genasys PROTECT (formerly Zonehaven) zone polygons plus county sheriff / EOC publication feeds into one statewide layer. Filtered to active statuses only: Evacuation Order, Warning, Advisory, Shelter in Place. Cleared zones drop off the upstream layer rather than persisting with an 'All Clear' status. Powers the live red banner + always-visible centroid pins on the Shelters & Evacuation page; auto-refresh every 60 s."
                    badge="State agency"
                    badgeColor="bg-orange-100 text-orange-700"
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
                    description="A monotonicity-constrained gradient-boosted classifier (scikit-learn HistGradientBoosting) with 5-fold isotonic probability calibration, trained over 6 live inputs: EVI (vegetation greenness), air temperature, wind speed, relative humidity, elevation, and the KBDI drought index. Output is mapped to the canonical 5-tier NFDRS scale (Low / Moderate / High / Very High / Extreme — equal 20% bands) that drives every polygon color, popup chip, side-panel badge, and alert email subject on the site. Per-zone overrides are applied through POST /api/predict-custom for researcher experiments."
                    badge="ML model"
                    badgeColor="bg-red-100 text-red-700"
                  />
                  <AboutItem
                    name="How a risk score is computed"
                    description="For any location — a county, ZIP, neighborhood, or census-tract centroid, or a custom lat/lon — the six inputs are looked up live, standardized with the model's saved StandardScaler, and passed to the calibrated, monotonicity-constrained gradient-boosted model. By construction the model can only move risk UP with temperature, wind, and drought (KBDI) and DOWN with humidity, so it can never learn a physically-backwards relationship. It returns a probability of the 'fire' class between 0.0 and 1.0; that probability IS the risk score. The score is then binned into the five NFDRS tiers using fixed 20% cutoffs — Low (below 0.20), Moderate (0.20–0.40), High (0.40–0.60), Very High (0.60–0.80), Extreme (0.80 and up). The exact same thresholds live on the backend (ml/inference.py) and the frontend (lib/riskTiers.ts), so a zone's map color, popup chip, side-panel badge, and alert email all agree on the tier."
                    badge="Scoring"
                    badgeColor="bg-red-100 text-red-700"
                  />
                  <AboutItem
                    name="Live data inputs & where they come from"
                    description="EVI — vegetation greenness, a proxy for available fuel — from Google Earth Engine's MODIS MOD13Q1 product. Air temperature, wind speed, and relative humidity from Open-Meteo. Ground elevation from USGS 3DEP (with Open-Elevation as a fallback). And the Keetch–Byram Drought Index (KBDI), a 0–800 cumulative soil-moisture-deficit measure of how dry the landscape has become. Every lookup follows a resilient fallback chain — cached map tile → live API → inverse-distance-weighted interpolation from reference stations — so the model always receives a complete six-value feature vector and never has to return a blank score."
                    badge="Data inputs"
                    badgeColor="bg-sky-100 text-sky-700"
                  />
                  <AboutItem
                    name="Daily training ingest (NASA FIRMS)"
                    description="Every day a GitHub Actions workflow (.github/workflows/daily-retrain.yml) pulls the latest NASA FIRMS satellite fire detections, computes the six features at each detection plus sampled no-fire points, and appends the rows that pass the data-quality checks to the committed training set (backend/ml/training_data/california_daily.csv). It runs all year, so winter no-fire conditions accumulate alongside summer fires — the model learns the full seasonal range through the weather and drought features, not a calendar input."
                    badge="Cron · daily"
                    badgeColor="bg-amber-100 text-amber-700"
                  />
                  <AboutItem
                    name="Data-quality safeguards (every row is vetted)"
                    description="Before a row can train the model it must clear several checks: physical-range and missing-value sanity; a low-confidence filter on FIRMS fire labels (drops likely false positives); a California-land mask plus active-perimeter and 3-day fire-window check on no-fire points (so a 'no-fire' point is never actually in a burning area); and cross-source weather corroboration — each point's Open-Meteo reading is compared against an independent provider (MET Norway) and dropped if they grossly disagree. Rejected rows are quarantined for review, never trained on."
                    badge="Data quality"
                    badgeColor="bg-sky-100 text-sky-700"
                  />
                  <AboutItem
                    name="Weekly monitoring & gated auto-promotion"
                    description="Every Sunday night the system scans the ingested data for statistical outliers and distribution drift, back-tests the live model against recent real fires, and cross-checks cached terrain data — emailing the team on any problem. It then retrains on the full rolling dataset and auto-promotes the new model to production only if it clears the gate (physics monotonicity + held-out AUROC/Brier non-regression); the previous model is archived. Manual promotion any day before Sunday remains available."
                    badge="Auto · weekly"
                    badgeColor="bg-red-100 text-red-700"
                  />
                </div>
              </div>

              {/* Alerts System */}
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-2">
                  <Brain className="h-4 w-4 text-amber-600" />
                  <h3 className="font-semibold text-sm">Alerts System</h3>
                </div>
                <div className="divide-y">
                  <AboutItem
                    name="Resend (transactional email)"
                    description="All alert emails are sent from alerts@firescope.dev through Resend, with DKIM + SPF + MX records published on the firescope.dev domain (Porkbun DNS). Free tier covers up to 3,000 sends/month — well above our current volume. Subjects and bodies are rendered server-side from backend/routes/internal_alerts.py templates."
                    badge="Email provider"
                    badgeColor="bg-amber-100 text-amber-700"
                  />
                  <AboutItem
                    name="High-Risk Zone Alerts (every 30 min)"
                    description="GitHub Actions workflow .github/workflows/alerts-high-risk.yml hits POST /api/internal/alerts/high-risk on a */30 * * * * schedule. For every opted-in user with high_risk_enabled, the cron scores each saved location across all four zone types (county / ZIP / neighborhood / census tract) and emails when any zone crosses the Very High (60%+) threshold. Body lists every zone's 5-tier label and percentage; state-driven dedup so users only get re-emailed when the picture actually changes."
                    badge="Cron · 30 min"
                    badgeColor="bg-red-100 text-red-700"
                  />
                  <AboutItem
                    name="Breaking Fire News Alerts (hourly)"
                    description="Workflow alerts-breaking-news.yml runs 0 * * * *. For each opted-in user with breaking_news_enabled the cron pulls news_articles where is_breaking=true and published_at > the user's last news send (24h floor), capped at 8 per email. Links route through firescope.dev/?page=news#article-<id> so recipients land on our summary instead of a raw upstream JSON page."
                    badge="Cron · hourly"
                    badgeColor="bg-amber-100 text-amber-700"
                  />
                  <AboutItem
                    name="Evacuation & Shelter Alerts (every 10 min)"
                    description="Workflow alerts-evacuation.yml runs */10 * * * *. Two sub-channels share the same cron: (1) per-zone evac alerts — ray-casting PIP of each saved location against active CalOES zones, county-match fallback so users in the affected county also get notified, body includes the 3 nearest OPEN shelters by haversine; (2) shelter-opened alerts — newly OPEN shelters in the same county as a saved location, batched per cron tick. Per-(user,zone) and per-(user,shelter) dedup so each event fires exactly once."
                    badge="Cron · 10 min"
                    badgeColor="bg-orange-100 text-orange-700"
                  />
                </div>
              </div>

              {/* Infrastructure */}
              <div className="border rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b bg-muted/30 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-zinc-500" />
                  <h3 className="font-semibold text-sm">Infrastructure</h3>
                </div>
                <div className="divide-y">
                  <AboutItem
                    name="Custom domain — firescope.dev"
                    description="Domain purchased on Porkbun, DNS points at Netlify (ALIAS apex + CNAME www). HTTPS via Let's Encrypt; .dev is HSTS-preloaded so all traffic is forced over TLS."
                    badge="Porkbun + Netlify"
                    badgeColor="bg-zinc-100 text-zinc-700"
                  />
                  <AboutItem
                    name="Frontend — React + Vite + Netlify"
                    description="React 18 + TypeScript + Vite, deployed to Netlify with auto-build on every push to the domain-deployment branch (auto-synced from main by a GitHub Actions workflow). Map rendering via @vis.gl/react-google-maps + deck.gl v9."
                    badge="Hosting"
                    badgeColor="bg-zinc-100 text-zinc-700"
                  />
                  <AboutItem
                    name="Backend — Flask + Render"
                    description="Flask 3 + SQLAlchemy + gunicorn on Render's Standard plan, fronted by a Postgres database (Basic-256MB) for endpoint caching and user/notification state. preDeployCommand runs flask db upgrade on every deploy; pool sized 20 + 30 overflow + 5-minute recycle to survive cold-cache compute storms."
                    badge="Hosting"
                    badgeColor="bg-zinc-100 text-zinc-700"
                  />
                  <AboutItem
                    name="Three-tier cache (memory → Postgres → live)"
                    description="services/cache.py implements a shared 3-tier cache for every heavy endpoint (risk-by-county, risk-by-zone/*, shelters, evac-zones, fire-perimeters, news, history). Memory expires fast (60s–15min depending on freshness needs), Postgres survives redeploys, live recompute is single-flight so concurrent requests share one upstream call. Brotli pre-compressed bodies + weak ETag matching keep the wire small."
                    badge="Perf"
                    badgeColor="bg-zinc-100 text-zinc-700"
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
