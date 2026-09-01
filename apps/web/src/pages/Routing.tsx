import { useState, useEffect } from "react";
import { PageHeader, Button, Input, InlineAlert } from "../components/ui/index.js";
import { useRoutingConfig, useUpdateRoutingConfig } from "../api/hooks.js";

export function RoutingPage() {
  const { data: config, isLoading } = useRoutingConfig();
  const updateConfig = useUpdateRoutingConfig();

  const [form, setForm] = useState({
    stickyEnabled: true,
    leaseTtlSeconds: 1800,
    maxAttempts: 3,
    rateLimitCooldownSeconds: 300,
    transientFailureCooldownSeconds: 120,
    transientFailureThreshold: 3,
  });

  const [savedMessage, setSavedMessage] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({
        stickyEnabled: config.stickyEnabled,
        leaseTtlSeconds: config.leaseTtlSeconds,
        maxAttempts: config.maxAttempts,
        rateLimitCooldownSeconds: config.rateLimitCooldownSeconds,
        transientFailureCooldownSeconds: config.transientFailureCooldownSeconds,
        transientFailureThreshold: config.transientFailureThreshold,
      });
    }
  }, [config]);

  const handleSave = async () => {
    await updateConfig.mutateAsync(form);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 3000);
  };

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <PageHeader
        title="Routing & Load Balancing Policy"
        description="Configure account selection logic, sticky session affinity, health state triggers, and failover behavior."
      />

      {savedMessage && (
        <InlineAlert type="success" title="Success">
          Routing policy updated successfully.
        </InlineAlert>
      )}

      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-6">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Sticky Session Affinity
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-[var(--color-text-primary)]">
                Enable Sticky Sessions
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">
                Pin requests with identical X-Proxy-Session-ID to the same account lease.
              </div>
            </div>
            <input
              type="checkbox"
              checked={form.stickyEnabled}
              onChange={(e) => setForm({ ...form, stickyEnabled: e.target.checked })}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
          </div>

          <Input
            label="Lease TTL (Seconds)"
            type="number"
            value={form.leaseTtlSeconds}
            onChange={(val) => setForm({ ...form, leaseTtlSeconds: parseInt(val, 10) || 1800 })}
            description="How long an affinity lease remains valid before expiring."
          />
        </div>
      </div>

      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-6">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Failover & Retry Policy
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Max Upstream Attempts"
            type="number"
            value={form.maxAttempts}
            onChange={(val) => setForm({ ...form, maxAttempts: parseInt(val, 10) || 3 })}
            description="Number of distinct accounts to try before returning an error."
          />
          <Input
            label="429 Rate Limit Cooldown (Seconds)"
            type="number"
            value={form.rateLimitCooldownSeconds}
            onChange={(val) => setForm({ ...form, rateLimitCooldownSeconds: parseInt(val, 10) || 300 })}
            description="Duration an account remains in cooldown after a 429 response."
          />
          <Input
            label="Transient Failure Threshold"
            type="number"
            value={form.transientFailureThreshold}
            onChange={(val) => setForm({ ...form, transientFailureThreshold: parseInt(val, 10) || 3 })}
            description="Number of errors in 120s before placing account in cooldown."
          />
          <Input
            label="Transient Cooldown (Seconds)"
            type="number"
            value={form.transientFailureCooldownSeconds}
            onChange={(val) => setForm({ ...form, transientFailureCooldownSeconds: parseInt(val, 10) || 120 })}
            description="Duration of cooldown triggered by transient errors."
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={updateConfig.isPending}>
          Save Routing Policy
        </Button>
      </div>
    </div>
  );
}
