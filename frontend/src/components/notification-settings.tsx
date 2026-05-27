import { useEffect, useState } from "react";
import {
  Bell, BellOff, BellRing, Flame, Newspaper, Siren, MapPin, AlertCircle, CheckCircle2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "./ui/dialog";
import { apiFetch } from "../services/api";
import { type NotificationPreference } from "../services/AuthService";

type NotificationSettingsProps = {
  token: string;
  onNavigateToLocations?: () => void;
};

type Prefs = {
  opted_in: boolean;
  email_enabled: boolean;
  contact_email: string;
  breaking_news_enabled: boolean;
  high_risk_enabled: boolean;
  evacuation_enabled: boolean;
  fire_alerts_enabled: boolean;
};

const DEFAULT_PREFS: Prefs = {
  opted_in: false,
  email_enabled: true,
  contact_email: "",
  breaking_news_enabled: false,
  high_risk_enabled: true,
  evacuation_enabled: true,
  fire_alerts_enabled: false,
};

function fromServer(p: NotificationPreference): Prefs {
  return {
    opted_in: p.opted_in,
    email_enabled: p.email_enabled,
    contact_email: p.contact_email || "",
    breaking_news_enabled: p.breaking_news_enabled,
    high_risk_enabled: p.high_risk_enabled,
    evacuation_enabled: p.evacuation_enabled,
    fire_alerts_enabled: p.fire_alerts_enabled,
  };
}

export function NotificationSettings({ onNavigateToLocations }: NotificationSettingsProps) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [original, setOriginal] = useState<Prefs>(DEFAULT_PREFS);
  const [locationCount, setLocationCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needLocationDialog, setNeedLocationDialog] = useState(false);

  // Initial load: prefs + saved location count (gates the high-risk toggle).
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/me/notifications").then(r => r.json()).catch(() => null),
      apiFetch("/me/locations").then(r => r.json()).catch(() => []),
    ]).then(([prefData, locs]) => {
      if (cancelled) return;
      if (prefData && prefData.user_id != null) {
        const p = fromServer(prefData);
        setPrefs(p);
        setOriginal(p);
      }
      setLocationCount(Array.isArray(locs) ? locs.length : 0);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const dirty =
    prefs.opted_in !== original.opted_in ||
    prefs.email_enabled !== original.email_enabled ||
    prefs.contact_email !== original.contact_email ||
    prefs.breaking_news_enabled !== original.breaking_news_enabled ||
    prefs.high_risk_enabled !== original.high_risk_enabled ||
    prefs.evacuation_enabled !== original.evacuation_enabled ||
    prefs.fire_alerts_enabled !== original.fire_alerts_enabled;

  const noLocations = locationCount === 0;

  function tryToggleHighRisk(checked: boolean) {
    if (checked && noLocations) {
      setNeedLocationDialog(true);
      return;
    }
    setPrefs({ ...prefs, high_risk_enabled: checked });
  }

  function tryToggleFireAlerts(checked: boolean) {
    // Wildfires-in-your-county requires a saved location to compute the
    // county overlap — same gate as high-risk.
    if (checked && noLocations) {
      setNeedLocationDialog(true);
      return;
    }
    setPrefs({ ...prefs, fire_alerts_enabled: checked });
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch("/me/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opted_in: prefs.opted_in,
          email_enabled: prefs.email_enabled,
          contact_email: prefs.contact_email.trim() || null,
          breaking_news_enabled: prefs.breaking_news_enabled,
          high_risk_enabled: prefs.high_risk_enabled,
          evacuation_enabled: prefs.evacuation_enabled,
          fire_alerts_enabled: prefs.fire_alerts_enabled,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (HTTP ${res.status})`);
      }
      const body = await res.json();
      const next = fromServer(body);
      setPrefs(next);
      setOriginal(next);
      setMessage("Alert settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center text-muted-foreground">
        Loading alert settings…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <div className="rounded-xl bg-gradient-to-br from-red-500 to-orange-500 p-2 shadow-lg shadow-red-500/20">
              <Bell className="h-5 w-5 text-white" />
            </div>
            Alert Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Choose which wildfire alerts you want emailed to you.
          </p>
        </div>
        <Badge
          variant="outline"
          className={`px-3 py-1.5 text-sm font-medium ${
            prefs.opted_in && prefs.email_enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-zinc-200 bg-zinc-50 text-zinc-700"
          }`}
        >
          {prefs.opted_in && prefs.email_enabled ? (
            <BellRing className="h-3.5 w-3.5 mr-1.5" />
          ) : (
            <BellOff className="h-3.5 w-3.5 mr-1.5" />
          )}
          {prefs.opted_in && prefs.email_enabled ? "Subscribed" : "Off"}
        </Badge>
      </div>

      {/* Master switch + contact email */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Email alerts</CardTitle>
          <CardDescription>Master switch. Turn off to silence every channel below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">Send me wildfire alerts by email</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Threshold is fixed at <span className="font-semibold">High</span> risk and above.
              </div>
            </div>
            <Switch
              checked={prefs.opted_in && prefs.email_enabled}
              onCheckedChange={(checked) =>
                setPrefs({ ...prefs, opted_in: checked, email_enabled: checked })
              }
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Send to</label>
            <Input
              type="email"
              placeholder="Leave blank to use your account email"
              value={prefs.contact_email}
              onChange={(e) => setPrefs({ ...prefs, contact_email: e.target.value })}
              disabled={!prefs.opted_in || !prefs.email_enabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Channels */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Alert channels</CardTitle>
          <CardDescription>Pick which kinds of fires & risk we email you about.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {/* High-risk zones */}
          <ChannelRow
            icon={<Flame className="h-4 w-4 text-red-500" />}
            title="High risk near your saved locations"
            description="Email when ANY of the 4 zone types at one of your saved locations reaches High (40%+) or above on the 5-tier NFDRS scale. All 4 zones are listed in the email regardless of which one triggered."
            checked={prefs.high_risk_enabled && prefs.opted_in && prefs.email_enabled}
            onChange={tryToggleHighRisk}
            disabled={!prefs.opted_in || !prefs.email_enabled}
            badge={noLocations ? "No locations saved" : null}
          />

          {/* Breaking news */}
          <ChannelRow
            icon={<Newspaper className="h-4 w-4 text-amber-500" />}
            title="Breaking fire news"
            description="Hourly email when new is_breaking=true wildfire stories are published (NWS Red Flag Warnings, GNews feed)."
            checked={prefs.breaking_news_enabled && prefs.opted_in && prefs.email_enabled}
            onChange={(c) => setPrefs({ ...prefs, breaking_news_enabled: c })}
            disabled={!prefs.opted_in || !prefs.email_enabled}
            badge={null}
          />

          {/* Evacuation */}
          <ChannelRow
            icon={<Siren className="h-4 w-4 text-orange-600" />}
            title="Evacuation warnings & orders"
            description="Every 10 min — email when an active CalOES evacuation zone overlaps any of your saved locations (or is in the same county), plus the 3 nearest open shelters."
            checked={prefs.evacuation_enabled && prefs.opted_in && prefs.email_enabled}
            onChange={(c) => setPrefs({ ...prefs, evacuation_enabled: c })}
            disabled={!prefs.opted_in || !prefs.email_enabled}
            badge={null}
          />

          {/* Wildfires in your county */}
          <ChannelRow
            icon={<Flame className="h-4 w-4 text-orange-500" />}
            title="Wildfires in your saved-location counties"
            description="Every 10 min — email when an active CAL FIRE incident is reported in a county containing one of your saved locations, plus updates when containment, status, or size meaningfully changes (every 10% containment, new 100-acre bracket, or status flip). One email per county. ZIP / neighborhood / census-tract granularity coming soon."
            checked={prefs.fire_alerts_enabled && prefs.opted_in && prefs.email_enabled}
            onChange={tryToggleFireAlerts}
            disabled={!prefs.opted_in || !prefs.email_enabled}
            badge={noLocations ? "No locations saved" : null}
          />
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          {message && (
            <span className="text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> {message}
            </span>
          )}
          {error && (
            <span className="text-red-700 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" /> {error}
            </span>
          )}
        </div>
        <Button onClick={onSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      {/* No-locations dialog (gates the high-risk toggle) */}
      <Dialog open={needLocationDialog} onOpenChange={setNeedLocationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-red-500" /> Add a location first
            </DialogTitle>
            <DialogDescription>
              High-risk alerts watch the places that matter to you. Add a saved{" "}
              <button
                type="button"
                onClick={() => {
                  setNeedLocationDialog(false);
                  onNavigateToLocations?.();
                }}
                className="text-red-600 underline font-medium hover:text-red-700"
              >
                location
              </button>
              {" "}before turning this channel on.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeedLocationDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setNeedLocationDialog(false);
                onNavigateToLocations?.();
              }}
            >
              Add a location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChannelRow(props: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (c: boolean) => void;
  disabled?: boolean;
  badge?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex gap-3 flex-1 min-w-0">
        <div className="mt-0.5 rounded-lg bg-muted/50 p-1.5">{props.icon}</div>
        <div className="min-w-0">
          <div className="font-medium flex flex-wrap items-center gap-2">
            <span>{props.title}</span>
            {props.badge && (
              <Badge variant="outline" className="text-xs font-normal text-muted-foreground border-zinc-200">
                {props.badge}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{props.description}</div>
        </div>
      </div>
      <Switch checked={props.checked} onCheckedChange={props.onChange} disabled={props.disabled} />
    </div>
  );
}
