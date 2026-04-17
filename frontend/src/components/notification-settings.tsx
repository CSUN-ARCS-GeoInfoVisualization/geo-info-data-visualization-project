import { useEffect, useMemo, useState } from "react";
import {
  Bell, ShieldAlert, Zap, Clock, CalendarClock, Mail, Phone,
  BellOff, BellRing, Gauge, CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  getMyNotifications,
  subscribeNotifications,
  unsubscribeNotifications,
  updateMyNotifications,
  type NotificationPreference,
} from "../services/AuthService";

type NotificationSettingsProps = {
  token: string;
};

type DraftPreference = {
  frequency: "instant" | "daily" | "weekly";
  riskThreshold: number;
  pausedUntilLocal: string;
  blackoutStartLocal: string;
  blackoutEndLocal: string;
};

function isoToLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function buildDraft(pref: NotificationPreference): DraftPreference {
  return {
    frequency: pref.frequency,
    riskThreshold: pref.risk_threshold,
    pausedUntilLocal: isoToLocalDateTime(pref.paused_until),
    blackoutStartLocal: isoToLocalDateTime(pref.blackout_start),
    blackoutEndLocal: isoToLocalDateTime(pref.blackout_end),
  };
}

const FREQ_OPTIONS: { value: DraftPreference["frequency"]; label: string; desc: string; icon: typeof Zap }[] = [
  { value: "instant", label: "Instant", desc: "Get notified immediately", icon: Zap },
  { value: "daily", label: "Daily Digest", desc: "Once per day summary", icon: Clock },
  { value: "weekly", label: "Weekly Digest", desc: "Weekly summary email", icon: CalendarClock },
];

const RISK_TIERS = [
  { value: 50, label: "Low",          color: "#22c55e", bgTint: "#f0fdf4" },  // Green
  { value: 55, label: "Guarded",      color: "#facc15", bgTint: "#fefce8" },  // Bright Yellow
  { value: 65, label: "Elevated",     color: "#ca8a04", bgTint: "#fefce8" },  // Dark Yellow
  { value: 70, label: "High",         color: "#fb923c", bgTint: "#fff7ed" },  // Bright Orange
  { value: 75, label: "Very High",    color: "#f97316", bgTint: "#fff7ed" },  // Orange
  { value: 80, label: "Severe",       color: "#c2410c", bgTint: "#fff7ed" },  // Dark Orange
  { value: 85, label: "Extreme",      color: "#f87171", bgTint: "#fef2f2" },  // Light Red
  { value: 90, label: "Critical",     color: "#dc2626", bgTint: "#fef2f2" },  // Red
  { value: 95, label: "Catastrophic", color: "#991b1b", bgTint: "#fef2f2" },  // Dark Red
];

export function NotificationSettings({ token }: NotificationSettingsProps) {
  const [preference, setPreference] = useState<NotificationPreference | null>(null);
  const [draft, setDraft] = useState<DraftPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const isDirty = useMemo(() => {
    if (!preference || !draft) return false;
    return (
      draft.frequency !== preference.frequency ||
      draft.riskThreshold !== preference.risk_threshold ||
      localDateTimeToIso(draft.pausedUntilLocal) !== (preference.paused_until ? new Date(preference.paused_until).toISOString() : null) ||
      localDateTimeToIso(draft.blackoutStartLocal) !== (preference.blackout_start ? new Date(preference.blackout_start).toISOString() : null) ||
      localDateTimeToIso(draft.blackoutEndLocal) !== (preference.blackout_end ? new Date(preference.blackout_end).toISOString() : null) ||
      (contactEmail || "") !== (preference.contact_email || "") ||
      (contactPhone || "") !== (preference.contact_phone || "")
    );
  }, [preference, draft, contactEmail, contactPhone]);

  const loadPreference = async () => {
    setLoading(true);
    setError(null);
    try {
      const pref = await getMyNotifications(token);
      setPreference(pref);
      setDraft(buildDraft(pref));
      setContactEmail(pref.contact_email || "");
      setContactPhone(pref.contact_phone || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notification settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreference();
  }, [token]);

  const onSave = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await updateMyNotifications(token, {
        frequency: draft.frequency,
        risk_threshold: draft.riskThreshold,
        paused_until: localDateTimeToIso(draft.pausedUntilLocal),
        blackout_start: localDateTimeToIso(draft.blackoutStartLocal),
        blackout_end: localDateTimeToIso(draft.blackoutEndLocal),
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      });
      setPreference(updated);
      setDraft(buildDraft(updated));
      setContactEmail(updated.contact_email || "");
      setContactPhone(updated.contact_phone || "");
      setMessage("Notification settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const onSubscribe = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      // Subscribe is the single action that saves the contact info AND opts in.
      const updated = await subscribeNotifications(token, {
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      });
      setPreference(updated);
      setDraft(buildDraft(updated));
      setContactEmail(updated.contact_email || "");
      setContactPhone(updated.contact_phone || "");
      setMessage("Alerts subscribed. You will receive wildfire alerts at the contact info above.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to subscribe");
    } finally {
      setSaving(false);
    }
  };

  const onUnsubscribe = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await unsubscribeNotifications(token);
      setPreference(updated);
      setDraft(buildDraft(updated));
      setMessage("Alerts unsubscribed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unsubscribe");
    } finally {
      setSaving(false);
    }
  };

  const onPause24Hours = () => {
    if (!draft) return;
    const pauseUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    setDraft({ ...draft, pausedUntilLocal: isoToLocalDateTime(pauseUntil.toISOString()) });
    setMessage("Pause set for 24 hours. Save to apply.");
  };

  const onResetSchedule = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      pausedUntilLocal: "",
      blackoutStartLocal: "",
      blackoutEndLocal: "",
    });
    setMessage("Pause/blackout cleared. Save to apply.");
  };

  if (loading || !draft || !preference) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-red-500" />
          <p className="text-sm text-muted-foreground">Loading notification settings...</p>
        </div>
      </div>
    );
  }

  const thresholdColor =
    draft.riskThreshold <= 30 ? "text-emerald-600" :
    draft.riskThreshold <= 60 ? "text-yellow-600" :
    "text-red-600";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <div className="rounded-xl bg-gradient-to-br from-red-500 to-orange-500 p-2 shadow-lg shadow-red-500/20">
              <Bell className="h-5 w-5 text-white" />
            </div>
            Alert Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure how and when you receive wildfire alerts.
          </p>
        </div>
        <Badge
          variant="outline"
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            preference.opted_in
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {preference.opted_in ? (
            <BellRing className="h-3.5 w-3.5 mr-1.5" />
          ) : (
            <BellOff className="h-3.5 w-3.5 mr-1.5" />
          )}
          {preference.opted_in ? "Subscribed" : "Unsubscribed"}
        </Badge>
      </div>

      {/* Frequency selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Alert Frequency</CardTitle>
          <CardDescription>Choose how often you want to receive notifications.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {FREQ_OPTIONS.map(({ value, label, desc, icon: Icon }) => {
              const selected = draft.frequency === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDraft({ ...draft, frequency: value })}
                  className={`relative flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all duration-200 hover:shadow-md ${
                    selected
                      ? "border-red-500 bg-red-50/50 shadow-sm shadow-red-500/10"
                      : "border-transparent bg-muted/40 hover:border-gray-200"
                  }`}
                >
                  <div className={`rounded-lg p-1.5 ${selected ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"} transition-colors`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className={`text-sm font-semibold ${selected ? "text-red-700" : "text-foreground"}`}>{label}</span>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                  {selected && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="h-4 w-4 text-red-500" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Risk threshold levels */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            Risk Threshold Levels
          </CardTitle>
          <CardDescription>
            Choose your minimum alert level. You will automatically be notified for all tiers above the one you select.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {RISK_TIERS.map((tier) => {
              const isSelected = draft.riskThreshold === tier.value;
              const isAbove = draft.riskThreshold <= tier.value;
              return (
                <button
                  key={tier.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, riskThreshold: tier.value })}
                  className="w-full flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-all duration-200"
                  style={{
                    borderWidth: 2,
                    borderStyle: "solid",
                    borderColor: isSelected || isAbove ? tier.color : "transparent",
                    backgroundColor: isSelected || isAbove ? tier.bgTint : "rgba(0,0,0,0.03)",
                    opacity: isSelected ? 1 : isAbove ? 0.85 : 0.45,
                    boxShadow: isSelected ? `0 1px 4px ${tier.color}33` : "none",
                  }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      borderWidth: 2,
                      borderStyle: "solid",
                      borderColor: isSelected ? tier.color : "#d1d5db",
                    }}
                  >
                    {isSelected && (
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tier.color }} />
                    )}
                  </div>
                  <div
                    className="w-10 text-right text-sm font-bold tabular-nums"
                    style={{ color: isAbove ? tier.color : "#9ca3af" }}
                  >
                    {tier.value}%
                  </div>
                  <div className="h-2.5 flex-1 rounded-full overflow-hidden" style={{ backgroundColor: "#e5e7eb" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${tier.value}%`, backgroundColor: tier.color }}
                    />
                  </div>
                  <span
                    className="text-xs font-medium w-24 text-right"
                    style={{ color: isAbove ? tier.color : "#9ca3af" }}
                  >
                    {tier.label}
                  </span>
                  {isAbove && !isSelected && (
                    <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: tier.color }} />
                  )}
                </button>
              );
            })}
          </div>
          {(() => {
            const selected = RISK_TIERS.find((t) => t.value === draft.riskThreshold);
            return (
              <div
                className="mt-4 rounded-lg px-3 py-2.5"
                style={{
                  backgroundColor: selected ? `${selected.color}12` : "#eff6ff",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: selected ? `${selected.color}40` : "#bfdbfe",
                }}
              >
                <p className="text-xs" style={{ color: selected?.color ?? "#1e40af" }}>
                  <strong>Your selection: {selected?.label ?? `${draft.riskThreshold}%`}</strong>
                  {" "}— you will receive alerts for this level and all higher tiers automatically.
                </p>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Contact info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Contact Information
          </CardTitle>
          <CardDescription>
            How should we reach you when an alert is triggered?
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="alert-email" className="text-sm font-medium">Email Address</label>
            <div className="relative group">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-red-500" />
              <Input
                id="alert-email"
                type="email"
                placeholder="your.email@example.com"
                className="pl-10 h-10"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="alert-phone" className="text-sm font-medium flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              Phone Number <span className="text-xs text-muted-foreground font-normal">(optional — SMS alerts coming soon)</span>
            </label>
            <Input
              id="alert-phone"
              type="tel"
              placeholder="(555) 123-4567"
              className="h-10"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Current subscription summary — always visible once contact info is saved */}
      {(preference.contact_email || preference.contact_phone) && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="py-3 text-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-medium text-emerald-900">
                  {preference.opted_in ? "Subscribed — alerts will be sent to:" : "Saved contact info (not yet subscribed):"}
                </div>
                {preference.contact_email && (
                  <div className="text-emerald-800 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> {preference.contact_email}
                  </div>
                )}
                {preference.contact_phone && (
                  <div className="text-emerald-800 flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> {preference.contact_phone}
                  </div>
                )}
                <div className="text-xs text-emerald-700/80 pt-1">
                  Edit the fields above and press <strong>{preference.opted_in ? "Save changes" : "Subscribe"}</strong> to update.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feedback messages */}
      {message && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 animate-[fadeIn_0.2s_ease-out]">
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          <p className="text-sm text-emerald-700">{message}</p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 animate-[fadeIn_0.2s_ease-out]">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Subscribe action */}
      <Card className="border-0 shadow-lg bg-white sticky bottom-4 z-10">
        <CardContent className="py-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {preference.opted_in
              ? "You are subscribed to wildfire alerts."
              : "Subscribe to start receiving wildfire alerts."}
          </p>
          {preference.opted_in ? (
            <div className="flex gap-2">
              {isDirty && (
                <Button onClick={onSave} disabled={saving} className="min-w-[130px]">
                  {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                  {saving ? "Saving..." : "Save changes"}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={onUnsubscribe}
                disabled={saving}
                className="text-red-600 border-red-200 hover:bg-red-50 min-w-[140px]"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <BellOff className="h-4 w-4 mr-1.5" />
                )}
                {saving ? "Processing..." : "Unsubscribe"}
              </Button>
            </div>
          ) : (
            <Button
              onClick={async () => {
                if (isDirty) await onSave();
                await onSubscribe();
              }}
              disabled={saving}
              variant="outline"
              className="border-2 border-red-500 text-black font-medium hover:bg-red-500 hover:text-white active:bg-red-600 transition-all duration-200 min-w-[140px]"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <BellRing className="h-4 w-4 mr-1.5" />
              )}
              {saving ? "Subscribing..." : "Subscribe"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Emergency notice */}
      <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50/50 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-orange-400 to-amber-500" />
        <CardHeader className="pb-2 pl-6">
          <CardTitle className="flex items-center gap-2 text-orange-900 text-base">
            <ShieldAlert className="h-5 w-5 text-orange-500" />
            Emergency Alert Notice
          </CardTitle>
        </CardHeader>
        <CardContent className="pl-6">
          <p className="text-sm text-orange-800/80">
            Emergency alerts may still be delivered even when regular alerts are paused or unsubscribed.
            These include imminent fire threats and mandatory evacuation orders.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
