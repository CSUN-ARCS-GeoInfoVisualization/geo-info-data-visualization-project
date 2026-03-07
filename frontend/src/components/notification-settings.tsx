import { useEffect, useMemo, useState } from "react";
import { Bell, PauseCircle, RotateCcw, Save, ShieldAlert } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
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
    return <p className="text-muted-foreground">Loading notification settings...</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-red-500" />
            Notification Settings
          </CardTitle>
          <CardDescription>
            Configure alert frequency, risk sensitivity, and temporary pause windows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Frequency</label>
              <select
                className="w-full h-9 rounded-md border border-input bg-input-background px-3 text-sm"
                value={draft.frequency}
                onChange={(e) => setDraft({ ...draft, frequency: e.target.value as DraftPreference["frequency"] })}
              >
                <option value="instant">Instant</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Risk Threshold (0-100)</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.riskThreshold}
                onChange={(e) => setDraft({ ...draft, riskThreshold: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Pause Until</label>
              <Input
                type="datetime-local"
                value={draft.pausedUntilLocal}
                onChange={(e) => setDraft({ ...draft, pausedUntilLocal: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Blackout Start</label>
              <Input
                type="datetime-local"
                value={draft.blackoutStartLocal}
                onChange={(e) => setDraft({ ...draft, blackoutStartLocal: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Blackout End</label>
              <Input
                type="datetime-local"
                value={draft.blackoutEndLocal}
                onChange={(e) => setDraft({ ...draft, blackoutEndLocal: e.target.value })}
              />
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            Status: {preference.opted_in ? "Subscribed" : "Unsubscribed"}
          </div>

          {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex flex-wrap gap-3">
            <Button onClick={onSave} disabled={saving || !isDirty}>
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              variant="outline"
              onClick={() => preference && setDraft(buildDraft(preference))}
              disabled={saving || !isDirty}
            >
              Discard
            </Button>
            <Button variant="outline" onClick={onSubscribe} disabled={saving || preference.opted_in}>
              Subscribe
            </Button>
            <Button variant="outline" onClick={onUnsubscribe} disabled={saving || !preference.opted_in}>
              Unsubscribe
            </Button>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={onPause24Hours} disabled={saving}>
              <PauseCircle className="h-4 w-4" />
              Pause 24 Hours
            </Button>
            <Button variant="secondary" onClick={onResetSchedule} disabled={saving}>
              <RotateCcw className="h-4 w-4" />
              Reset Pause/Blackout
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-orange-200 bg-orange-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-900">
            <ShieldAlert className="h-5 w-5" />
            Emergency Alert Notice
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-orange-900">
            Emergency alerts may still be delivered even when regular alerts are paused or unsubscribed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
