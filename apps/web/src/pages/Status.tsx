import { PageHeader, Badge, MetricCard } from "../components/ui/index.js";
import { useSystemHealth, useAccounts, useModels } from "../api/hooks.js";

export function StatusPage() {
  const { data: health } = useSystemHealth();
  const { data: accounts } = useAccounts();
  const { data: models } = useModels();

  const activeAccounts = accounts?.filter((a) => a.state === "ACTIVE" && a.enabled).length || 0;
  const degradedAccounts = accounts?.filter((a) => a.state === "DEGRADED" || a.state === "COOLDOWN").length || 0;
  const invalidAccounts = accounts?.filter((a) => a.state === "INVALID").length || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Status & Health"
        description="Live status of internal services, runtime processes, database connectivity, and Ollama upstream pool."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-5">
          <div className="text-xs uppercase text-[var(--color-text-muted)] font-medium">Gateway Service</div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-lg font-semibold text-[var(--color-text-primary)]">HTTP 11435</span>
            <Badge variant={health?.live ? "success" : "danger"}>
              {health?.live ? "Online" : "Offline"}
            </Badge>
          </div>
        </div>

        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-5">
          <div className="text-xs uppercase text-[var(--color-text-muted)] font-medium">SQLite Database</div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-lg font-semibold text-[var(--color-text-primary)]">WAL Mode</span>
            <Badge variant={health?.ready ? "success" : "danger"}>
              {health?.ready ? "Healthy" : "Unreachable"}
            </Badge>
          </div>
        </div>

        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-5">
          <div className="text-xs uppercase text-[var(--color-text-muted)] font-medium">Account Pool</div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-lg font-semibold text-[var(--color-text-primary)]">{activeAccounts} Active</span>
            <Badge variant={activeAccounts > 0 ? "success" : "warning"}>
              {activeAccounts > 0 ? "Operational" : "No Accounts"}
            </Badge>
          </div>
        </div>

        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-5">
          <div className="text-xs uppercase text-[var(--color-text-muted)] font-medium">Models Sync</div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-lg font-semibold text-[var(--color-text-primary)]">{models?.length || 0} Models</span>
            <Badge variant="accent">Ready</Badge>
          </div>
        </div>
      </div>

      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Account Pool Breakdown
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          <div className="p-4 bg-[var(--color-bg-canvas)] rounded-lg border border-[var(--color-border)]">
            <div className="text-2xl font-semibold font-mono text-[var(--color-success)]">{activeAccounts}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Active & Healthy</div>
          </div>
          <div className="p-4 bg-[var(--color-bg-canvas)] rounded-lg border border-[var(--color-border)]">
            <div className="text-2xl font-semibold font-mono text-[var(--color-warning)]">{degradedAccounts}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Degraded / Cooldown</div>
          </div>
          <div className="p-4 bg-[var(--color-bg-canvas)] rounded-lg border border-[var(--color-border)]">
            <div className="text-2xl font-semibold font-mono text-[var(--color-danger)]">{invalidAccounts}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Invalid Auth</div>
          </div>
        </div>
      </div>
    </div>
  );
}
