import { useState, useEffect, useMemo, useCallback } from "react";
import { Bell, Menu, Settings, Search, LogOut } from "lucide-react";
import { FireScopeBrandMark } from "./components/firescope-brand";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Dashboard } from "./components/dashboard";
import { EvacuationRoutes } from "./components/evacuation-routes";
import { FireNews } from "./components/fire-news";
import { RiskMap } from "./components/risk-map";
import { MapsRuntimeProvider } from "./context/maps-config";
import { AuthPage } from "./components/auth-page";
import { NotificationSettings } from "./components/notification-settings";
import { apiFetch, GUEST_SESSION_KEY } from "./services/api";
import { SettingsPage } from "./components/settings-page";
import { History } from "./components/history";
import { AdminPage } from "./components/admin-page";
import { ResearchPage } from "./components/research-page";
import { Toaster } from "sonner";

type Page =
  | "dashboard"
  | "evacuation-routes"
  | "news"
  | "risk-map"
  | "alerts"
  | "history"
  | "settings"
  | "research"
  | "admin";

const NAV_LINKS: { page: Page; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "evacuation-routes", label: "Evacuation Routes" },
  { page: "news", label: "News" },
  { page: "risk-map", label: "Risk Map" },
  { page: "alerts", label: "Alerts" },
  { page: "history", label: "History" },
];

type SettingsTab = "profile" | "locations" | "notifications";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>("profile");
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [guestMode, setGuestMode] = useState(() => {
    if (localStorage.getItem("token")) return false;
    return localStorage.getItem(GUEST_SESSION_KEY) === "1";
  });
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isSupreme, setIsSupreme] = useState(false);
  const isAuthenticated = Boolean(authToken) || guestMode;

  const fetchUserRole = useCallback(async () => {
    try {
      const r = await apiFetch("/me");
      if (r.ok) {
        const data = await r.json();
        setUserRole(data.role);
        setIsSupreme(data.is_supreme || false);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (authToken) fetchUserRole();
  }, [authToken, fetchUserRole]);

  // Extra nav items based on role
  const extraNavLinks = useMemo(() => {
    const links: { page: Page; label: string }[] = [
      { page: "research", label: "Research" },
    ];
    if (userRole === "Admin") links.push({ page: "admin", label: "Admin" });
    return links;
  }, [userRole]);

  const allNavLinks = useMemo(() => [...NAV_LINKS, ...extraNavLinks], [extraNavLinks]);

  const onAuthSuccess = () => {
    const t = localStorage.getItem("token");
    if (t) {
      localStorage.removeItem(GUEST_SESSION_KEY);
      setGuestMode(false);
    }
    setAuthToken(t);
    fetchUserRole();
  };

  const onGuestContinue = () => {
    localStorage.setItem(GUEST_SESSION_KEY, "1");
    setGuestMode(true);
  };

  const onSignOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem(GUEST_SESSION_KEY);
    setAuthToken(null);
    setGuestMode(false);
    setUserRole(null);
    setIsSupreme(false);
  };

  const goToPage = (page: Page) => {
    setCurrentPage(page);
    setMobileNavOpen(false);
  };

  // Show auth page if not authenticated
  if (!isAuthenticated) {
    return <AuthPage onAuthSuccess={onAuthSuccess} onGuestContinue={onGuestContinue} />;
  }

  const openSettings = (tab: SettingsTab) => {
    setSettingsDefaultTab(tab);
    setCurrentPage("settings");
    setMobileNavOpen(false);
  };

  return (
    <MapsRuntimeProvider>
        <div className="min-h-screen bg-background">
          <Toaster position="top-right" richColors />

        {/* Header */}
        <header className="border-b bg-white/95 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center space-x-4 transition-none">
                <FireScopeBrandMark
                  height={36}
                  variant="plain"
                  className="min-w-0 shrink-0"
                />

                <nav className="ml-8 hidden space-x-6 xl:flex" aria-label="Main">
                  {NAV_LINKS.map(({ page, label }) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`text-sm font-medium hover:text-red-500 transition-colors ${
                        currentPage === page ? "text-red-500" : "text-muted-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {/* Role-based nav items */}
                  {extraNavLinks.map(({ page, label }) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`text-sm font-medium hover:text-red-500 transition-colors ${
                        currentPage === page ? "text-red-500" : "text-muted-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="flex items-center space-x-4">
                <div className="relative hidden sm:block">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search locations..."
                    className="pl-10 w-64"
                  />
                </div>

                <Button variant="ghost" size="sm">
                  <Bell className="h-4 w-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openSettings("profile")}
                  title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>

                <Button variant="outline" size="sm" onClick={onSignOut} title="Sign Out">
                  <LogOut className="h-4 w-4" />
                </Button>

                <DropdownMenu
                  open={mobileNavOpen}
                  onOpenChange={setMobileNavOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="xl:hidden"
                      type="button"
                      aria-label="Open navigation menu"
                      id="mobile-navigation-trigger"
                    >
                      <Menu className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    id="mobile-navigation"
                    align="end"
                    sideOffset={8}
                    className="z-[500] w-56"
                    aria-label="Site navigation"
                  >
                    <DropdownMenuLabel>Navigate</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {allNavLinks.map(({ page, label }) => (
                      <DropdownMenuItem
                        key={page}
                        onSelect={() => goToPage(page)}
                        className={
                          currentPage === page ? "text-red-600 font-medium" : undefined
                        }
                      >
                        {label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => openSettings("profile")}
                      className={
                        currentPage === "settings"
                          ? "text-red-600 font-medium"
                          : undefined
                      }
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {currentPage === "dashboard" && (
            <Dashboard
              onAddLocation={() => openSettings("locations")}
            />
          )}
          {currentPage === "evacuation-routes" && <EvacuationRoutes />}
          {currentPage === "news" && <FireNews />}
          {currentPage === "risk-map" && <RiskMap />}
          {currentPage === "alerts" &&
            (authToken ? (
              <NotificationSettings token={authToken} />
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/30 px-6 py-10 text-center text-sm text-muted-foreground">
                Sign in to manage alert notifications and subscription settings.
              </div>
            ))}
          {currentPage === "history" && <History />}
          {currentPage === "research" && <ResearchPage userRole={userRole} />}
          {currentPage === "admin" && userRole === "Admin" && <AdminPage />}
          {currentPage === "settings" && (
            <SettingsPage defaultTab={settingsDefaultTab} />
          )}
        </main>

        {/* Footer */}
        <footer className="border-t bg-muted/30 mt-12">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div>
                <div className="flex items-center mb-4">
                  <FireScopeBrandMark height={32} variant="plain" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Advanced wildfire risk prediction and monitoring system powered by real-time data and machine learning.
                </p>
              </div>

              <div>
                <h3 className="font-medium mb-4">Features</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Real-time risk assessment</li>
                  <li>Weather monitoring</li>
                  <li>Interactive maps</li>
                  <li>Alert notifications</li>
                </ul>
              </div>

              <div>
                <h3 className="font-medium mb-4">Resources</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Fire safety tips</li>
                  <li>Emergency contacts</li>
                  <li>Evacuation plans</li>
                  <li>Historical data</li>
                </ul>
              </div>

              <div>
                <h3 className="font-medium mb-4">Contact</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Emergency: 911</li>
                  <li>Fire Dept: (555) 123-4567</li>
                  <li>Support: help@firescope.app</li>
                  <li>Updates: @FireScope</li>
                </ul>
              </div>
            </div>

            <div className="border-t mt-8 pt-8 text-center text-sm text-muted-foreground">
              <p>
                © 2025 FireScope. All rights reserved. Data provided by National Weather Service and local fire departments.
              </p>
            </div>
          </div>
        </footer>
        </div>
    </MapsRuntimeProvider>
  );
}
