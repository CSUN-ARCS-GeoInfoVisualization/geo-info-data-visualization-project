import { useState, useMemo } from "react";
import { Bell, Menu, Settings, Search, LogOut } from "lucide-react";
import { GooeyNav } from "./components/GooeyNav";
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
import { APIProvider } from '@vis.gl/react-google-maps';
import { AuthPage } from "./components/auth-page";
import { NotificationSettings } from "./components/notification-settings";
import { SettingsPage } from "./components/settings-page";
import { History } from "./components/history";
import { Toaster } from "sonner";

type Page =
  | "dashboard"
  | "evacuation-routes"
  | "news"
  | "risk-map"
  | "alerts"
  | "history"
  | "settings";

type SettingsTab = "profile" | "locations" | "notifications";

const NAV_LINKS: { page: Page; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "evacuation-routes", label: "Evacuation Routes" },
  { page: "news", label: "News" },
  { page: "risk-map", label: "Risk Map" },
  { page: "alerts", label: "Alerts" },
  { page: "history", label: "History" },
];

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
  const isAuthenticated = Boolean(authToken);

  const onAuthSuccess = () => {
    setAuthToken(localStorage.getItem("token"));
  };

  const onSignOut = () => {
    localStorage.removeItem("token");
    setAuthToken(null);
  };

  const goToPage = (page: Page) => {
    setCurrentPage(page);
    setMobileNavOpen(false);
  };

  const goToSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setCurrentPage("settings");
  };

  // Show auth page if not authenticated
  if (!isAuthenticated) {
    return <AuthPage onAuthSuccess={onAuthSuccess} />;
  }

  return (
    <APIProvider apiKey={apiKey} onLoad={() => console.log('Maps API loaded')}>
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

                <div className="ml-8 hidden md:flex items-center overflow-visible" aria-label="Main">
                  <GooeyNav
                    items={NAV_LINKS.map(({ page, label }) => ({
                      label,
                      onClick: () => setCurrentPage(page),
                    }))}
                    activeIndex={NAV_LINKS.findIndex((l) => l.page === currentPage)}
                    onItemClick={(i) => setCurrentPage(NAV_LINKS[i].page)}
                    particleCount={8}
                    particleDistances={[40, 6]}
                    particleR={50}
                    animationTime={350}
                    timeVariance={150}
                    colors={[1, 2, 3, 1, 2, 3, 1, 4]}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="relative hidden sm:block">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search locations..."
                    className="pl-10 w-64"
                  />
                </div>

                <Button variant="ghost" size="sm" onClick={() => goToSettings("notifications")} title="Alert preferences">
                  <Bell className="h-4 w-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => goToSettings("profile")}
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
                      className="md:hidden"
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
                    {NAV_LINKS.map(({ page, label }) => (
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
                      onSelect={() => goToPage("settings")}
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
          {currentPage === "dashboard" && <Dashboard onAddLocation={() => goToSettings("locations")} />}
          {currentPage === "evacuation-routes" && <EvacuationRoutes />}
          {currentPage === "news" && <FireNews />}
          {currentPage === "risk-map" && <RiskMap />}
          {currentPage === "alerts" && (
            <NotificationSettings token={authToken as string} />
          )}
          {currentPage === "history" && <History />}
          {currentPage === "settings" && <SettingsPage key={settingsTab} defaultTab={settingsTab} />}
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
    </APIProvider>
  );
}
