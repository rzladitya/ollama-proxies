import { useState, useEffect } from "react";
import { PageHeader, Button, Input, InlineAlert } from "../components/ui/index.js";
import {
  useSettings,
  useUpdateSettings,
  usePasswordStatus,
  useChangePassword,
} from "../api/hooks.js";
import { setStoredAdminSecret } from "../api/client.js";

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const { data: passwordStatus } = usePasswordStatus();
  const changePassword = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordChanged(false);

    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      // The stored secret is what every later request authenticates with, so it
      // has to move to the new password or the session breaks on the next call.
      setStoredAdminSecret(newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordChanged(true);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password.");
    }
  };

  const [requestTimeout, setRequestTimeout] = useState("120");
  const [logRetentionDays, setLogRetentionDays] = useState("7");
  const [sessionWindowHours, setSessionWindowHours] = useState("5");
  const [sessionLimitRequests, setSessionLimitRequests] = useState("1000");
  const [weeklyWindowDays, setWeeklyWindowDays] = useState("7");
  const [weeklyLimitRequests, setWeeklyLimitRequests] = useState("5000");
  const [inputCostPerMTok, setInputCostPerMTok] = useState("0");
  const [outputCostPerMTok, setOutputCostPerMTok] = useState("0");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      if (settings.request_timeout) setRequestTimeout(String(settings.request_timeout));
      if (settings.log_retention_days) setLogRetentionDays(String(settings.log_retention_days));

      const usage = settings.usage_config as Record<string, number> | undefined;
      if (usage) {
        if (usage.sessionWindowHours != null) setSessionWindowHours(String(usage.sessionWindowHours));
        if (usage.sessionLimitRequests != null) setSessionLimitRequests(String(usage.sessionLimitRequests));
        if (usage.weeklyWindowDays != null) setWeeklyWindowDays(String(usage.weeklyWindowDays));
        if (usage.weeklyLimitRequests != null) setWeeklyLimitRequests(String(usage.weeklyLimitRequests));
        if (usage.inputCostPerMTok != null) setInputCostPerMTok(String(usage.inputCostPerMTok));
        if (usage.outputCostPerMTok != null) setOutputCostPerMTok(String(usage.outputCostPerMTok));
      }
    }
  }, [settings]);

  const handleSave = async () => {
    await updateSettings.mutateAsync({
      request_timeout: parseInt(requestTimeout, 10) || 120,
      log_retention_days: parseInt(logRetentionDays, 10) || 7,
      usage_config: {
        sessionWindowHours: parseFloat(sessionWindowHours) || 5,
        sessionLimitRequests: parseInt(sessionLimitRequests, 10) || 1000,
        weeklyWindowDays: parseFloat(weeklyWindowDays) || 7,
        weeklyLimitRequests: parseInt(weeklyLimitRequests, 10) || 5000,
        inputCostPerMTok: parseFloat(inputCostPerMTok) || 0,
        outputCostPerMTok: parseFloat(outputCostPerMTok) || 0,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <PageHeader
        title="Gateway Settings"
        description="Global proxy server configuration, timeouts, retention, and maintenance."
      />

      {saved && (
        <InlineAlert type="success" title="Settings Saved">
          Gateway settings updated.
        </InlineAlert>
      )}

      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-6">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Proxy Gateway Settings
        </h2>
        <div className="space-y-4">
          <Input
            label="Upstream Request Timeout (Seconds)"
            type="number"
            value={requestTimeout}
            onChange={setRequestTimeout}
            description="Max time to wait for upstream response before aborting."
          />
          <Input
            label="Log Retention Period (Days)"
            type="number"
            value={logRetentionDays}
            onChange={setLogRetentionDays}
            description="Number of days to preserve request_logs before automatic deletion."
          />
        </div>
      </div>

      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Usage Accounting
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Ollama Cloud exposes no quota or billing API, so these are your own
            numbers. Usage is counted from this gateway's request log; the limits
            and rates below are what the Quota Tracker and cost estimate compare
            against. Leave rates at 0 to show no cost rather than a guess.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Session Window (Hours)"
            type="number"
            value={sessionWindowHours}
            onChange={setSessionWindowHours}
            description="Rolling window for the session quota."
          />
          <Input
            label="Session Limit (Requests)"
            type="number"
            value={sessionLimitRequests}
            onChange={setSessionLimitRequests}
            description="Requests allowed per account within that window."
          />
          <Input
            label="Weekly Window (Days)"
            type="number"
            value={weeklyWindowDays}
            onChange={setWeeklyWindowDays}
            description="Rolling window for the weekly quota."
          />
          <Input
            label="Weekly Limit (Requests)"
            type="number"
            value={weeklyLimitRequests}
            onChange={setWeeklyLimitRequests}
            description="Requests allowed per account within that window."
          />
          <Input
            label="Input Cost (USD / 1M tokens)"
            type="number"
            value={inputCostPerMTok}
            onChange={setInputCostPerMTok}
            description="0 disables cost estimation."
          />
          <Input
            label="Output Cost (USD / 1M tokens)"
            type="number"
            value={outputCostPerMTok}
            onChange={setOutputCostPerMTok}
            description="0 disables cost estimation."
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={updateSettings.isPending}>
          Save Settings
        </Button>
      </div>

      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Admin Password
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            {passwordStatus?.customPasswordSet
              ? "A dashboard password is set. It is stored hashed with scrypt."
              : "You are signing in with OLLAMA_PROXY_ADMIN_SECRET from .env. Set a dashboard password to change it without editing files."}
          </p>
        </div>

        {passwordChanged && (
          <InlineAlert type="success" title="Password Updated">
            Sign-in now accepts your new password.
          </InlineAlert>
        )}
        {passwordError && (
          <InlineAlert type="error" title="Could not change password">
            {passwordError}
          </InlineAlert>
        )}

        <div className="space-y-4 max-w-md">
          <Input
            label="Current Password"
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            required
          />
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            description="At least 8 characters."
            required
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            required
          />
        </div>

        <InlineAlert type="warning" title="Recovery credential">
          The value of <code>OLLAMA_PROXY_ADMIN_SECRET</code> in <code>.env</code> keeps working
          even after you set a password here. That is deliberate — it is how you get back in if you
          forget this one. To retire it, change the value in <code>.env</code> and restart.
        </InlineAlert>

        <div className="flex justify-end">
          <Button
            onClick={handleChangePassword}
            loading={changePassword.isPending}
            disabled={!currentPassword || !newPassword || !confirmPassword}
          >
            Change Password
          </Button>
        </div>
      </div>
    </div>
  );
}
