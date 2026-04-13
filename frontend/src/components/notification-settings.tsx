import { useEffect, useMemo, useState } from "react";
import {
  Bell, Save, ShieldAlert, Zap, Clock, CalendarClock,
  BellOff, BellRing, Gauge, CheckCircle2, AlertCircle, Loader2, Undo2,
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
  { value: 50, label: "Low", bar: "bg-emerald-400", bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" },
  { value: 65, label: "Elevated", bar: "bg-yellow-400", bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700" },
  { value: 70, label: "High", bar: "bg-orange-400", bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
  { value: 75, label: "Very High", bar: "bg-orange-500", bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-800" },
  { value: 80, label: "Severe", bar: "bg-red-400", bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
  { value: 85, label: "Extreme", bar: "bg-red-500", bg: "bg-red-50", border: "border-red-300", text: "text-red-800" },
  { value: 90, label: "Critical", bar: "bg-red-600", bg: "bg-red-50", border: "border-red-300", text: "text-red-900" },
  { value: 95, label: "Catastrophic", bar: "bg-red-700", bg: "bg-red-100", border: "border-red-400", text: "text-red-950" },
];

export function NotificationSettings({ token }: NotificationSettingsProps) {
  const [preference, setPreference] = useState<NotificationPreference | null>(null);
  const [draft, setDraft] = useState<DraftPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (!preference || !draft) return false;
    return (
      draft.frequency !== preference.frequency ||
      draft.riskThreshold !== preference.risk_threshold ||
      localDateTimeToIso(draft.pausedUntilLocal) !== (preference.paused_until ? new Date(preference.paused_until).toISOString() : null) ||
      localDateTimeToIso(draft.blackoutStartLocal) !== (preference.blackout_start ? new Date(preference.blackout_start).toISOString() : null) ||
      localDateTimeToIso(draft.blackoutEndLocal) !== (preference.blackout_end ? new Date(preference.blackout_end).toISOString() : null)
    );
  }, [preference, draft]);

  const loadPreference = async () => {
    setLoading(true);
    setError(null);
    try {
      const pref = await getMyNotifications(token);
      setPreference(pref);
      setDraft(buildDraft(pref));
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
      });
      setPreference(updated);
      setDraft(buildDraft(updated));
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
      const updated = await subscribeNotifications(token);
      setPreference(updated);
      setDraft(buildDraft(updated));
      setMessage("Alerts subscribed.");
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
            You will receive alerts when fire risk reaches or exceeds your subscribed threshold.
            The scale below shows each alert tier.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {RISK_TIERS.map((tier) => {
              const isActive = draft.riskThreshold <= tier.value;
              return (
                <div
                  key={tier.value}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    isActive
                      ? `${tier.bg} ${tier.border}`
                      : "border-transparent bg-muted/30"
                  }`}
                >
                  <div className={`w-10 text-right text-sm font-bold tabular-nums ${isActive ? tier.text : "text-muted-foreground"}`}>
                    {tier.value}%
                  </div>
                  <div className={`h-2.5 flex-1 rounded-full overflow-hidden bg-gray-100`}>
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${tier.bar}`}
                      style={{ width: `${tier.value}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium w-20 text-right ${isActive ? tier.text : "text-muted-foreground"}`}>
                    {tier.label}
                  </span>
                  {isActive && (
                    <CheckCircle2 className={`h-4 w-4 shrink-0 ${tier.text}`} />
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Your current threshold: <strong>{draft.riskThreshold}%</strong> — you will be alerted at all tiers at or above this level.
          </p>
        </CardContent>
      </Card>

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

      {/* Action bar */}
      <Card className="border-0 shadow-lg bg-white sticky bottom-4 z-10">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {preference.opted_in ? (
              <Button variant="outline" size="sm" onClick={onUnsubscribe} disabled={saving} className="text-red-600 border-red-200 hover:bg-red-50">
                <BellOff className="h-3.5 w-3.5 mr-1.5" />
                Unsubscribe
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onSubscribe} disabled={saving} className="text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                <BellRing className="h-3.5 w-3.5 mr-1.5" />
                Subscribe
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => preference && setDraft(buildDraft(preference))}
              disabled={saving || !isDirty}
              className="transition-opacity"
            >
              <Undo2 className="h-3.5 w-3.5 mr-1.5" />
              Discard
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving || !isDirty}
              className="bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 shadow-md shadow-red-500/20 transition-all duration-200 min-w-[120px]"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
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
