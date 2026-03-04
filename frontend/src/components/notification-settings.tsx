import { useState } from "react";
import {
  Bell,
  Mail,
  MessageSquare,
  Clock,
  AlertCircle,
  CheckCircle2,
  Pause,
  Play,
  Trash2,
  Save
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { toast } from "sonner@2.0.3";

type RiskThreshold = "low" | "medium" | "high" | "extreme";
type Frequency = "instant" | "daily" | "weekly";

export function NotificationSettings() {
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>("instant");
  const [riskThreshold, setRiskThreshold] = useState<RiskThreshold>("medium");
  const [email, setEmail] = useState("user@example.com");
  const [phone, setPhone] = useState("+1 (555) 123-4567");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const handleSave = () => {
    // Simulate saving settings
    toast.success("Notification settings saved successfully!");
    setHasUnsavedChanges(false);
  };

  const handleReset = () => {
    // Reset to defaults
    setEmailEnabled(true);
    setSmsEnabled(false);
    setPushEnabled(true);
    setIsPaused(false);
    setFrequency("instant");
    setRiskThreshold("medium");
    toast.info("Settings reset to defaults");
    setHasUnsavedChanges(false);
  };

  const handleTogglePause = () => {
    setIsPaused(!isPaused);
    if (!isPaused) {
      toast.info("Notifications paused");
    } else {
      toast.success("Notifications resumed");
    }
    setHasUnsavedChanges(true);
  };

  const handleUnsubscribe = () => {
    // Disable all notifications
    setEmailEnabled(false);
    setSmsEnabled(false);
    setPushEnabled(false);
    toast.warning("Unsubscribed from all notifications");
    setHasUnsavedChanges(true);
  };

  const getRiskBadgeColor = (level: RiskThreshold) => {
    switch (level) {
      case "low":
        return "bg-green-100 text-green-800 hover:bg-green-100";
      case "medium":
        return "bg-yellow-100 text-yellow-800 hover:bg-yellow-100";
      case "high":
        return "bg-orange-100 text-orange-800 hover:bg-orange-100";
      case "extreme":
        return "bg-red-100 text-red-800 hover:bg-red-100";
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Notification Settings</h1>
        <p className="text-muted-foreground">
          Customize how and when you receive wildfire alerts and updates
        </p>
      </div>

      {/* Status Banner */}
      {isPaused && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div className="flex-1">
                <p className="font-medium text-amber-900">Notifications Paused</p>
                <p className="text-sm text-amber-700">
                  You won't receive any alerts until you resume notifications
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleTogglePause}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Play className="h-4 w-4 mr-2" />
                Resume
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alert Channels */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-red-500" />
            Alert Channels
          </CardTitle>
          <CardDescription>
            Choose how you want to receive wildfire alerts and notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email Notifications */}
          <div className="flex items-start justify-between space-x-4">
            <div className="flex items-start space-x-4 flex-1">
              <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Label htmlFor="email-toggle" className="cursor-pointer">Email Notifications</Label>
                  {emailEnabled && (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Receive detailed alerts and reports via email
                </p>
                {emailEnabled && (
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Enter your email"
                    className="max-w-sm"
                  />
                )}
              </div>
            </div>
            <Switch
              id="email-toggle"
              checked={emailEnabled}
              onCheckedChange={(checked) => {
                setEmailEnabled(checked);
                setHasUnsavedChanges(true);
              }}
            />
          </div>

          <Separator />

          {/* SMS Notifications */}
          <div className="flex items-start justify-between space-x-4">
            <div className="flex items-start space-x-4 flex-1">
              <MessageSquare className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Label htmlFor="sms-toggle" className="cursor-pointer">SMS Notifications</Label>
                  {smsEnabled && (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Get urgent alerts sent directly to your mobile phone
                </p>
                {smsEnabled && (
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setHasUnsavedChanges(true);
                    }}
                    placeholder="Enter your phone number"
                    className="max-w-sm"
                  />
                )}
              </div>
            </div>
            <Switch
              id="sms-toggle"
              checked={smsEnabled}
              onCheckedChange={(checked) => {
                setSmsEnabled(checked);
                setHasUnsavedChanges(true);
              }}
            />
          </div>

          <Separator />

          {/* Push Notifications */}
          <div className="flex items-start justify-between space-x-4">
            <div className="flex items-start space-x-4 flex-1">
              <Bell className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Label htmlFor="push-toggle" className="cursor-pointer">Push Notifications</Label>
                  {pushEnabled && (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Instant browser notifications for critical alerts
                </p>
              </div>
            </div>
            <Switch
              id="push-toggle"
              checked={pushEnabled}
              onCheckedChange={(checked) => {
                setPushEnabled(checked);
                setHasUnsavedChanges(true);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Alert Frequency */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-red-500" />
            Alert Frequency
          </CardTitle>
          <CardDescription>
            Control how often you receive notification updates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={frequency}
            onValueChange={(value: Frequency) => {
              setFrequency(value);
              setHasUnsavedChanges(true);
            }}
            className="space-y-4"
          >
            <div className="flex items-start space-x-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="instant" id="instant" className="mt-0.5" />
              <div className="flex-1">
                <Label htmlFor="instant" className="cursor-pointer">
                  Instant Alerts
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Receive notifications immediately as conditions change (recommended for high-risk areas)
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="daily" id="daily" className="mt-0.5" />
              <div className="flex-1">
                <Label htmlFor="daily" className="cursor-pointer">
                  Daily Digest
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Get a summary of risk updates once per day at 8:00 AM
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="weekly" id="weekly" className="mt-0.5" />
              <div className="flex-1">
                <Label htmlFor="weekly" className="cursor-pointer">
                  Weekly Summary
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Receive a comprehensive weekly report every Monday morning
                </p>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Risk Threshold */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Risk Threshold
          </CardTitle>
          <CardDescription>
            Set the minimum risk level that triggers an alert
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You'll only receive notifications when the wildfire risk reaches or exceeds this level:
            </p>

            <RadioGroup
              value={riskThreshold}
              onValueChange={(value: RiskThreshold) => {
                setRiskThreshold(value);
                setHasUnsavedChanges(true);
              }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <div className="flex items-center space-x-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="low" id="low" />
                <div className="flex-1">
                  <Label htmlFor="low" className="cursor-pointer flex items-center gap-2">
                    Low Risk
                    <Badge className={getRiskBadgeColor("low")}>Low</Badge>
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Get all alerts
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="medium" id="medium" />
                <div className="flex-1">
                  <Label htmlFor="medium" className="cursor-pointer flex items-center gap-2">
                    Medium Risk
                    <Badge className={getRiskBadgeColor("medium")}>Medium</Badge>
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Balanced alerts
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="high" id="high" />
                <div className="flex-1">
                  <Label htmlFor="high" className="cursor-pointer flex items-center gap-2">
                    High Risk
                    <Badge className={getRiskBadgeColor("high")}>High</Badge>
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Only urgent alerts
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors">
                <RadioGroupItem value="extreme" id="extreme" />
                <div className="flex-1">
                  <Label htmlFor="extreme" className="cursor-pointer flex items-center gap-2">
                    Extreme Risk
                    <Badge className={getRiskBadgeColor("extreme")}>Extreme</Badge>
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Critical only
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            Manage your notification preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              onClick={handleTogglePause}
              className="flex-1"
            >
              {isPaused ? (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Resume Notifications
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause Notifications
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={handleReset}
              className="flex-1"
            >
              Reset to Defaults
            </Button>

            <Button
              variant="outline"
              onClick={handleUnsubscribe}
              className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Unsubscribe All
            </Button>
          </div>

          <Separator />

          <div className="bg-muted/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 text-sm text-muted-foreground">
                <p className="mb-2">
                  <strong>Note:</strong> Emergency evacuation alerts will always be sent regardless of your settings.
                </p>
                <p>
                  For technical support or to permanently delete your notification preferences, contact us at{" "}
                  <a href="mailto:support@firewatch.com" className="text-red-600 hover:underline">
                    support@firewatch.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Actions */}
      <div className="flex items-center justify-between gap-4 sticky bottom-4 bg-background/95 backdrop-blur-sm border rounded-lg p-4 shadow-lg">
        <div className="text-sm text-muted-foreground">
          {hasUnsavedChanges && (
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
              You have unsaved changes
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!hasUnsavedChanges}
          >
            Discard Changes
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasUnsavedChanges}
            className="bg-red-500 hover:bg-red-600"
          >
            <Save className="h-4 w-4 mr-2" />
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
