import { useState } from "react";
import { 
  Flame, 
  Bell,
  Menu,
  Settings,
  Search,
  LogOut
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Dashboard } from "./components/dashboard";
import { EvacuationRoutes } from "./components/evacuation-routes";
import { FireNews } from "./components/fire-news";
import { RiskMap } from "./components/risk-map";
import { AuthPage } from "./components/auth-page";
import { NotificationSettings } from "./components/notification-settings";
import { Toaster } from "sonner@2.0.3";
import { History } from "./components/history";



import {
  APIProvider,
} from "@vis.gl/react-google-maps";

type Page =
  | "dashboard"
  | "evacuation-routes"
  | "news"
  | "risk-map"
  | "alerts"
  | "history"
  | "settings";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <APIProvider apiKey="AIzaSyAsnZD5qi1po5EM3zUnTqg114_s7WWfajI">
      <div className="min-h-screen bg-background">
       <Toaster position="top-right" richColors />

        {/* ---------------- AUTH MODAL ---------------- */}
        {showAuthModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="relative max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowAuthModal(false)}
                className="absolute top-4 right-4 z-10 text-white hover:text-gray-300 transition-colors"
                aria-label="Close"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>

              <AuthPage
                onAuthSuccess={() => {
                  setIsAuthenticated(true);
                  setShowAuthModal(false);
                }}
              />
            </div>
          </div>
        )}

        {/* ---------------- HEADER ---------------- */}
        <header className="border-b bg-white/95 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Flame className="h-8 w-8 text-red-500" />
                  <span className="text-xl font-bold">FireWatch</span>
                </div>

                {/* NAVIGATION */}
                <nav className="hidden md:flex space-x-6 ml-8">
                  <button
                    onClick={() => setCurrentPage("dashboard")}
                    className={`text-sm font-medium hover:text-red-500 transition-colors ${
                      currentPage === "dashboard"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    Dashboard
                  </button>

                  <button
                    onClick={() => setCurrentPage("evacuation-routes")}
                    className={`text-sm font-medium hover:text-red-500 transition-colors ${
                      currentPage === "evacuation-routes"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    Evacuation Routes
                  </button>

                  <button
                    onClick={() => setCurrentPage("news")}
                    className={`text-sm font-medium hover:text-red-500 transition-colors ${
                      currentPage === "news"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    News
                  </button>

                  <button
                    onClick={() => setCurrentPage("risk-map")}
                    className={`text-sm font-medium hover:text-red-500 transition-colors ${
                      currentPage === "risk-map"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    Risk Map
                  </button>

                  <button
                    onClick={() => setCurrentPage("alerts")}
                    className={`text-sm font-medium hover:text-red-500 transition-colors ${
                      currentPage === "alerts"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    Alerts
                  </button>

                  <button
                    onClick={() => setCurrentPage("history")}
                    className={`text-sm font-medium hover:text-red-500 transition-colors ${
                      currentPage === "history"
                        ? "text-red-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    History
                  </button>
                </nav>
              </div>

              {/* RIGHT SIDE CONTROLS */}
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
                  onClick={() => setCurrentPage("settings")}
                  title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>


                {isAuthenticated && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAuthenticated(false)}
                    title="Logout"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}

                {!isAuthenticated && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAuthModal(true)}
                  >
                    Login
                  </Button>
                )}

                <Button variant="ghost" size="sm" className="md:hidden">
                  <Menu className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* ---------------- MAIN CONTENT ---------------- */}
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {currentPage === "dashboard" && (
            <Dashboard
              isAuthenticated={isAuthenticated}
              onLoginClick={() => setShowAuthModal(true)}
            />
          )}

          {currentPage === "evacuation-routes" && <EvacuationRoutes />}
          {currentPage === "news" && <FireNews />}
          {currentPage === "risk-map" && <RiskMap />}

          {currentPage === "alerts" && (
            <div className="text-center py-16">
              <h2 className="text-2xl font-bold mb-4">Alerts</h2>
              <p className="text-muted-foreground">Alert management coming soon</p>
            </div>
          )}

          {currentPage === "history" && <History />}
          {currentPage === "settings" && (
                    <NotificationSettings />
          )}
        </main>

        {/* ---------------- FOOTER ---------------- */}
        <footer className="border-t bg-muted/30 mt-12">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div>
                <div className="flex items-center space-x-2 mb-4">
                  <Flame className="h-6 w-6 text-red-500" />
                  <span className="text-lg font-bold">FireWatch</span>
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
                  <li>Support: help@firewatch.com</li>
                  <li>Updates: @FireWatch</li>
                </ul>
              </div>
            </div>

            <div className="border-t mt-8 pt-8 text-center text-sm text-muted-foreground">
              <p>
                © 2025 FireWatch. All rights reserved. Data provided by National Weather Service and local fire departments.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </APIProvider>
  );
}