import { useEffect, useState } from "react";
import { User, MapPin, Bell, Shield, Save, Loader2, ChevronRight } from "lucide-react";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Skeleton } from "./ui/skeleton";
import { MyLocations } from "./my-locations";
import { apiFetch } from "../services/api";

interface UserProfile {
  id: number;
  email: string;
  role: string;
}

interface NotificationPrefs {
  opted_in: boolean;
  frequency: string;
  risk_threshold: number;
  paused_until: string | null;
  blackout_start: string | null;
  blackout_end: string | null;
}

type Tab = "profile" | "locations" | "notifications";

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

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  return iso.replace("Z", "").slice(0, 16);
}

function toISOOrNull(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType; description: string }[] = [
  { id: "profile", label: "Profile", icon: User, description: "Your account details" },
  { id: "locations", label: "My Locations", icon: MapPin, description: "Saved places & risk" },
  { id: "notifications", label: "Alert Preferences", icon: Bell, description: "Notification settings" },
];

export function SettingsPage({ defaultTab = "profile" }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab ?? "profile");

  useEffect(() => {
    setActiveTab(defaultTab ?? "profile");
  }, [defaultTab]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    apiFetch("/me")
      .then(async (r) => { if (r.ok) setProfile(await r.json()); })
      .catch(() => {})
      .finally(() => setLoadingProfile(false));

    apiFetch("/me/notifications")
      .then(async (r) => { if (r.ok) setPrefs(await r.json()); })
      .catch(() => {})
      .finally(() => setLoadingPrefs(false));
  }, []);

  const handleToggleOptIn = async (checked: boolean) => {
    if (!prefs) return;
    const endpoint = checked ? "/notifications/subscribe" : "/notifications/unsubscribe";
    const res = await apiFetch(endpoint, { method: "POST" });
    if (res.ok) setPrefs(await res.json());
  };

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      const res = await apiFetch("/me/notifications", {
        method: "PUT",
        body: JSON.stringify({
          frequency: prefs.frequency,
          risk_threshold: prefs.risk_threshold,
          paused_until: prefs.paused_until,
          blackout_start: prefs.blackout_start,
          blackout_end: prefs.blackout_end,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        /* silent */
      } else {
        setPrefs(data);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  };

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

          {/* Alert Preferences */}
          {activeTab === "notifications" && (
            <div className="border rounded-xl bg-white overflow-hidden">
              <div className="px-6 py-4 border-b bg-muted/30">
                <h2 className="font-semibold text-base">Alert Preferences</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Control when and how you receive wildfire alerts</p>
              </div>
              <div className="divide-y">
                {loadingPrefs ? (
                  <div className="px-6 py-6 space-y-4">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : prefs ? (
                  <>
                    {/* Enable toggle */}
                    <div className="px-6 py-5 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">Enable email alerts</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Receive wildfire risk notifications to your email
                        </p>
                      </div>
                      <Switch checked={prefs.opted_in} onCheckedChange={handleToggleOptIn} />
                    </div>

                    {/* Frequency */}
                    <div className="px-6 py-5 space-y-3">
                      <div>
                        <p className="text-sm font-medium">Alert frequency</p>
                        <p className="text-xs text-muted-foreground mt-0.5">How often you want to be notified</p>
                      </div>
                      <Select
                        value={prefs.frequency}
                        onValueChange={(val) => setPrefs({ ...prefs, frequency: val })}
                        disabled={false}
                      >
                        <SelectTrigger className="w-full sm:w-80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="instant">Instant — as soon as risk is detected</SelectItem>
                          <SelectItem value="daily">Daily digest</SelectItem>
                          <SelectItem value="weekly">Weekly digest</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Risk threshold */}
                    <div className="px-6 py-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Minimum risk threshold</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Only alert when risk exceeds this level
                          </p>
                        </div>
                        <Badge variant="outline" className="text-sm font-semibold px-3">
                          {prefs.risk_threshold}%
                        </Badge>
                      </div>
                      <Slider
                        min={0}
                        max={100}
                        step={5}
                        value={[prefs.risk_threshold]}
                        onValueChange={([val]) => setPrefs({ ...prefs, risk_threshold: val })}
                        disabled={false}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Alert on any risk (0%)</span>
                        <span>High risk only (100%)</span>
                      </div>
                    </div>

                    {/* Pause until */}
                    <div className="px-6 py-5 space-y-3">
                      <div>
                        <p className="text-sm font-medium">Pause alerts until</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Temporarily silence all alerts until a date</p>
                      </div>
                      <input
                        type="datetime-local"
                        className="border rounded-md px-3 py-2 text-sm bg-background w-full sm:w-80 disabled:opacity-50"
                        value={toDatetimeLocal(prefs.paused_until)}
                        onChange={(e) => setPrefs({ ...prefs, paused_until: toISOOrNull(e.target.value) })}
                        disabled={false}
                      />
                    </div>

                    {/* Quiet hours */}
                    <div className="px-6 py-5 space-y-3">
                      <div>
                        <p className="text-sm font-medium">Quiet hours</p>
                        <p className="text-xs text-muted-foreground mt-0.5">No alerts will be sent during this window</p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Start</Label>
                          <input
                            type="datetime-local"
                            className="border rounded-md px-3 py-2 text-sm bg-background w-full sm:w-60 disabled:opacity-50"
                            value={toDatetimeLocal(prefs.blackout_start)}
                            onChange={(e) => setPrefs({ ...prefs, blackout_start: toISOOrNull(e.target.value) })}
                            disabled={false}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">End</Label>
                          <input
                            type="datetime-local"
                            className="border rounded-md px-3 py-2 text-sm bg-background w-full sm:w-60 disabled:opacity-50"
                            value={toDatetimeLocal(prefs.blackout_end)}
                            onChange={(e) => setPrefs({ ...prefs, blackout_end: toISOOrNull(e.target.value) })}
                            disabled={false}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Save */}
                    <div className="px-6 py-4 bg-muted/30 flex items-center justify-between gap-4">
                      <div>
                        {saveSuccess && <p className="text-sm text-green-600">Preferences saved!</p>}
                      </div>
                      <Button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-red-500 hover:bg-red-600"
                      >
                        {saving
                          ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          : <Save className="h-4 w-4 mr-2" />}
                        Save preferences
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="px-6 py-6 text-sm text-muted-foreground">Could not load preferences.</div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
