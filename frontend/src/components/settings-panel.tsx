import { useEffect, useState } from "react";
import { User, Bell, Shield, Save, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Skeleton } from "./ui/skeleton";
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

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "profile" | "notifications";
}

const ROLE_COLORS: Record<string, string> = {
  Admin: "bg-red-100 text-red-700",
  Researcher: "bg-blue-100 text-blue-700",
  Resident: "bg-green-100 text-green-700",
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  return iso.replace("Z", "").slice(0, 16);
}

function toISOOrNull(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

export function SettingsPanel({ open, onOpenChange, defaultTab = "profile" }: SettingsPanelProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;

    setLoadingProfile(true);
    apiFetch("/me")
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoadingProfile(false));

    setLoadingPrefs(true);
    apiFetch("/me/notifications")
      .then((r) => r.json())
      .then((data) => setPrefs(data))
      .catch(() => setPrefs(null))
      .finally(() => setLoadingPrefs(false));
  }, [open]);

  const handleToggleOptIn = async (checked: boolean) => {
    if (!prefs) return;
    const endpoint = checked ? "/notifications/subscribe" : "/notifications/unsubscribe";
    const res = await apiFetch(endpoint, { method: "POST" });
    if (res.ok) {
      const updated = await res.json();
      setPrefs(updated);
    }
  };

  const handleSaveNotifications = async () => {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" /> Profile
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center gap-2">
              <Bell className="h-4 w-4" /> Notifications
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6 pt-4">
            {loadingProfile ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : profile ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">User ID</Label>
                  <p className="text-sm font-mono">#{profile.id}</p>
                </div>
                <Separator />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Email</Label>
                  <p className="text-sm">{profile.email}</p>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Role</Label>
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${ROLE_COLORS[profile.role] ?? "bg-gray-100 text-gray-700"}`}>
                      {profile.role}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Could not load profile. Make sure you are logged in.</p>
            )}
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="space-y-6 pt-4">
            {loadingPrefs ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : prefs ? (
              <>
                {/* Enable alerts */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Enable email alerts</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">Receive wildfire risk notifications</p>
                  </div>
                  <Switch
                    checked={prefs.opted_in}
                    onCheckedChange={handleToggleOptIn}
                  />
                </div>

                <Separator />

                {/* Frequency */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Alert frequency</Label>
                  <Select
                    value={prefs.frequency}
                    onValueChange={(val) => setPrefs({ ...prefs, frequency: val })}
                    disabled={!prefs.opted_in}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instant">Instant — alert as soon as risk detected</SelectItem>
                      <SelectItem value="daily">Daily digest</SelectItem>
                      <SelectItem value="weekly">Weekly digest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Risk threshold */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Risk threshold</Label>
                    <Badge variant="outline">{prefs.risk_threshold}%</Badge>
                  </div>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[prefs.risk_threshold]}
                    onValueChange={([val]) => setPrefs({ ...prefs, risk_threshold: val })}
                    disabled={!prefs.opted_in}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Any risk</span>
                    <span>High risk only</span>
                  </div>
                </div>

                <Separator />

                {/* Pause until */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Pause alerts until</Label>
                  <p className="text-xs text-muted-foreground">Leave blank to never pause</p>
                  <input
                    type="datetime-local"
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                    value={toDatetimeLocal(prefs.paused_until)}
                    onChange={(e) => setPrefs({ ...prefs, paused_until: toISOOrNull(e.target.value) })}
                    disabled={!prefs.opted_in}
                  />
                </div>

                {/* Blackout window */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Quiet hours (blackout window)</Label>
                  <p className="text-xs text-muted-foreground">No alerts will be sent during this window</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Start</Label>
                      <input
                        type="datetime-local"
                        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                        value={toDatetimeLocal(prefs.blackout_start)}
                        onChange={(e) => setPrefs({ ...prefs, blackout_start: toISOOrNull(e.target.value) })}
                        disabled={!prefs.opted_in}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">End</Label>
                      <input
                        type="datetime-local"
                        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                        value={toDatetimeLocal(prefs.blackout_end)}
                        onChange={(e) => setPrefs({ ...prefs, blackout_end: toISOOrNull(e.target.value) })}
                        disabled={!prefs.opted_in}
                      />
                    </div>
                  </div>
                </div>

                {/* Save */}
                <div className="flex flex-col items-end gap-2 pt-2">
                  {saveSuccess && <p className="text-sm text-green-600">Saved!</p>}
                  <Button
                    onClick={handleSaveNotifications}
                    disabled={saving || !prefs.opted_in}
                    className="bg-red-500 hover:bg-red-600"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Save preferences
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Could not load notification preferences.</p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}