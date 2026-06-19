import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
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
import { APIProvider } from '@vis.gl/react-google-maps';
import { AuthPage } from "./components/auth-page";
import { Toaster } from "sonner";
import { apiFetch } from "./services/api";

// Lazy-load every non-default page so the initial bundle ships only the Dashboard.
// Each chunk is downloaded on first navigation and then cached by the browser.
//
// Recovery contract: if a chunk 404s — typical scenario is a long-open tab across
// a redeploy where index.html still references stale hashed filenames — we hard
// reload the page once. The fresh index.html points at the new chunks, and a
// session-storage flag prevents an infinite reload loop if the failure is real.
function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await importer();
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isChunkLoad =
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Importing a module script failed") ||
        msg.toLowerCase().includes("chunkloaderror");
      const flag = "firescope.chunk-reload-once";
      if (isChunkLoad && !sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, "1");
        window.location.reload();
        // Resolve with an empty component so React doesn't crash before reload kicks in.
        return { default: (() => null) as unknown as T };
      }
      throw err;
    }
  });
}

const EvacuationRoutes = lazyWithRetry(() => import("./components/evacuation-routes").then(m => ({ default: m.EvacuationRoutes })));
const FireNews = lazyWithRetry(() => import("./components/fire-news").then(m => ({ default: m.FireNews })));
const RiskMap = lazyWithRetry(() => import("./components/risk-map").then(m => ({ default: m.RiskMap })));
const NotificationSettings = lazyWithRetry(() => import("./components/notification-settings").then(m => ({ default: m.NotificationSettings })));
const SettingsPage = lazyWithRetry(() => import("./components/settings-page").then(m => ({ default: m.SettingsPage })));
const History = lazyWithRetry(() => import("./components/history").then(m => ({ default: m.History })));
const AdminPage = lazyWithRetry(() => import("./components/admin-page").then(m => ({ default: m.AdminPage })));
const ResearchPage = lazyWithRetry(() => import("./components/research-page").then(m => ({ default: m.ResearchPage })));

const PageFallback = () => (
  <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">Loading…</div>
);

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

type SettingsTab = "profile" | "locations" | "notifications";

const NAV_LINKS: { page: Page; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "evacuation-routes", label: "Shelters & Evacuation" },
  { page: "news", label: "News" },
  { page: "risk-map", label: "Risk Map" },
  { page: "alerts", label: "Alerts" },
  { page: "history", label: "History" },
];

const GUEST_FLAG_KEY = "firescope.guest";
const POST_LOGIN_PAGE_KEY = "firescope.postLoginPage";

// Deep-link bootstrap. Email alerts and shareable URLs land at
// `https://firescope.dev/?page=news#article-<id>` — read the query param once
// on mount and seed currentPage. The hash is left intact for FireNews to
// pick up and scroll the right card into view.
function pageFromUrl(): Page {
  if (typeof window === "undefined") return "dashboard";
  const p = new URLSearchParams(window.location.search).get("page");
  const valid = new Set([
    "dashboard", "evacuation-routes", "news", "history", "risk-map",
    "research", "settings", "admin",
  ]);
  return (p && valid.has(p) ? p : "dashboard") as Page;
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>(() => pageFromUrl());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [isGuest, setIsGuest] = useState<boolean>(() => localStorage.getItem(GUEST_FLAG_KEY) === "1");
  // When set, the AuthPage takes over the screen even if the user is in guest
  // mode — used to ferry guests through sign-up and back to whatever page they
  // were trying to access (e.g. submitting a researcher request).
  const [authOverlay, setAuthOverlay] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [userRole, setUserRole] = useState<string | null>(null);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
  const isAuthenticated = Boolean(authToken);
  // Either a real session or a guest pass-through unlocks the app.
  const canAccessApp = isAuthenticated || isGuest;

  const fetchUserRole = useCallback(async () => {
    try {
      const r = await apiFetch("/me");
      if (r.ok) {
        const data = await r.json();
        setUserRole(data.role);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // Only authenticated users have a server-side role to fetch; guests skip this.
    if (isAuthenticated) fetchUserRole();
  }, [isAuthenticated, fetchUserRole]);

  // Prefetch the other lazy page chunks during browser idle time so navigating
  // from Dashboard to Risk Map / History / Research is instant — the chunks
  // are already in the browser cache by the time the user clicks a nav link.
  // Non-blocking: dashboard's own initial render is unaffected.
  useEffect(() => {
    if (!canAccessApp) return;
    const idle: any =
      (window as any).requestIdleCallback ||
      ((cb: () => void) => setTimeout(cb, 1500));
    const handle = idle(() => {
      import("./components/risk-map");
      import("./components/history");
      import("./components/research-page");
      import("./components/fire-news");
      import("./components/evacuation-routes");
      // Auth-required pages — only worth prefetching for real accounts.
      if (isAuthenticated) {
        import("./components/notification-settings");
        import("./components/settings-page");
      }
    });
    return () => {
      const cancel = (window as any).cancelIdleCallback;
      if (cancel && handle) cancel(handle);
    };
  }, [canAccessApp, isAuthenticated]);

  const extraNavLinks = useMemo(() => {
    const links: { page: Page; label: string }[] = [
      { page: "research", label: "Research" },
    ];
    if (userRole === "Admin") links.push({ page: "admin", label: "Admin" });
    return links;
  }, [userRole]);

  // Guests do not have a server account, so the alerts/settings pages would
  // 401 on every save. Hide them from the nav rather than offer broken links.
  const visibleNavLinks = useMemo(
    () => isGuest ? NAV_LINKS.filter((l) => l.page !== "alerts") : NAV_LINKS,
    [isGuest]
  );

  const onAuthSuccess = () => {
    const token = localStorage.getItem("token");
    if (token) {
      // Real login: clear any stale guest pass-through, hydrate auth state.
      localStorage.removeItem(GUEST_FLAG_KEY);
      setIsGuest(false);
      setAuthToken(token);
      fetchUserRole();
      setAuthOverlay(false);
      // If the user was bounced through auth from a specific page, send them back.
      const target = localStorage.getItem(POST_LOGIN_PAGE_KEY);
      if (target) {
        localStorage.removeItem(POST_LOGIN_PAGE_KEY);
        setCurrentPage(target as Page);
      }
    } else {
      // "Continue without login" — no token in localStorage. Flip guest mode on.
      localStorage.setItem(GUEST_FLAG_KEY, "1");
      setIsGuest(true);
      setAuthOverlay(false);
    }
  };

  // Called from any page that needs the user upgraded from guest to a real
  // account. Records where to come back to, then renders the AuthPage.
  const requireLogin = useCallback((returnToPage: Page) => {
    localStorage.setItem(POST_LOGIN_PAGE_KEY, returnToPage);
    setAuthOverlay(true);
  }, []);

  const onSignOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem(GUEST_FLAG_KEY);
    setAuthToken(null);
    setIsGuest(false);
    setUserRole(null);
  };

  const goToPage = (page: Page) => {
    setCurrentPage(page);
    setMobileNavOpen(false);
  };

  const goToSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setCurrentPage("settings");
  };

  // Show auth page if user has neither a real session nor opted into guest
  // mode, OR if a guest action explicitly requested login (authOverlay).
  if (!canAccessApp || authOverlay) {
    return <AuthPage onAuthSuccess={onAuthSuccess} />;
  }

  return (
    <APIProvider apiKey={apiKey} onLoad={() => console.log('Maps API loaded')}>
      <div className="min-h-screen bg-background">
        <Toaster position="top-right" richColors />

        {/* Header */}
        {/* z-index set inline, not via Tailwind `z-[…]`: this project's build
            does not compile arbitrary z-index utilities (only the standard
            scale like .z-50), so `z-[1100]` produced NO rule and the header
            stayed at z-index:auto — sliding behind the map overlays. Inline
            style always applies. Paired with `isolation:isolate` on <main>
            below so Google Maps / deck.gl internals can't escape above it. */}
        <header className="border-b bg-white/95 backdrop-blur-sm sticky top-0" style={{ zIndex: 1100 }}>
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
                    items={visibleNavLinks.map(({ page, label }) => ({
                      label,
                      onClick: () => setCurrentPage(page),
                    }))}
                    activeIndex={visibleNavLinks.findIndex((l) => l.page === currentPage)}
                    onItemClick={(i) => setCurrentPage(visibleNavLinks[i].page)}
                    particleCount={8}
                    particleDistances={[40, 6]}
                    particleR={50}
                    animationTime={350}
                    timeVariance={150}
                    colors={[1, 2, 3, 1, 2, 3, 1, 4]}
                  />
                  {extraNavLinks.map(({ page, label }) => (
                    <Button
                      key={page}
                      variant={currentPage === page ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                      className="ml-2"
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-4">
                {/* Bell + Settings require a server account; hide for guests so we
                    don't strand them on a 401 page. Sign-out doubles as "leave guest". */}
                {!isGuest && (
                  <>
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
                  </>
                )}

                <Button variant="outline" size="sm" onClick={onSignOut} title={isGuest ? "Exit guest mode" : "Sign Out"}>
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
                    {visibleNavLinks.map(({ page, label }) => (
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
                    {extraNavLinks.map(({ page, label }) => (
                      <DropdownMenuItem
                        key={page}
                        onSelect={() => goToPage(page)}
                        className={currentPage === page ? "text-red-600 font-medium" : undefined}
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
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ isolation: 'isolate' }}>
          <Suspense fallback={<PageFallback />}>
            {currentPage === "dashboard" && <Dashboard onAddLocation={() => goToSettings("locations")} />}
            {currentPage === "evacuation-routes" && <EvacuationRoutes />}
            {currentPage === "news" && <FireNews />}
            {currentPage === "risk-map" && <RiskMap />}
            {currentPage === "alerts" && (
              <NotificationSettings token={authToken as string} />
            )}
            {currentPage === "history" && <History />}
            {currentPage === "research" && (
              <ResearchPage
                userRole={userRole}
                isGuest={isGuest}
                onLoginRequired={() => requireLogin("research")}
              />
            )}
            {currentPage === "admin" && userRole === "Admin" && <AdminPage />}
            {currentPage === "settings" && <SettingsPage key={settingsTab} defaultTab={settingsTab} />}
          </Suspense>
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
