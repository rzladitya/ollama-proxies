import { useState, useEffect } from "react";
import { PageHeader, Button, Input, InlineAlert } from "../components/ui/index.js";
import { useSettings, useUpdateSettings } from "../api/hooks.js";

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const [requestTimeout, setRequestTimeout] = useState("120");
  const [logRetentionDays, setLogRetentionDays] = useState("7");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      if (settings.request_timeout) setRequestTimeout(String(settings.request_timeout));
      if (settings.log_retention_days) setLogRetentionDays(String(settings.log_retention_days));
    }
  }, [settings]);

  const handleSave = async () => {
    await updateSettings.mutateAsync({
      request_timeout: parseInt(requestTimeout, 10) || 120,
      log_retention_days: parseInt(logRetentionDays, 10) || 7,
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

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={updateSettings.isPending}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}
