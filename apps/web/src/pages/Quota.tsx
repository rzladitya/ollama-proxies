import { useState, useEffect } from "react";
import { Button } from "../components/ui/index.js";
import { useQuotaTracker, useToggleAccountState, useDeleteAccount } from "../api/hooks.js";
import {
  RefreshCw,
  Activity,
  Trash2,
  Edit2,
  Power,
  RotateCw,
  ChevronDown,
  Layers,
  Sparkles,
  EyeOff,
  Cloud,
} from "lucide-react";

export function QuotaPage() {
  const { data: quotaData, refetch, isFetching } = useQuotaTracker();
  const toggleAccount = useToggleAccountState();
  const deleteAccount = useDeleteAccount();

  const [countdown, setCountdown] = useState(25);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Auto-refresh timer loop
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          refetch();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, refetch]);

  const accounts = quotaData?.accounts ?? [];

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      {/* ── Top Bar matching 9Router Screenshot ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-[#38bdf8]" />
          <h1 className="text-xl font-bold tracking-tight text-white font-mono">Quota Tracker</h1>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Provider Filter Select */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#11131a] border border-[#242838] text-xs font-mono text-neutral-300">
            <Layers className="w-3.5 h-3.5 text-neutral-500" />
            <span>All Providers</span>
            <ChevronDown className="w-3 h-3 text-neutral-500 ml-1" />
          </div>

          {/* Account Filter Select */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#11131a] border border-[#242838] text-xs font-mono text-neutral-300">
            <span>All accounts</span>
            <ChevronDown className="w-3 h-3 text-neutral-500 ml-1" />
          </div>

          {/* Auto Refresh pill toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono border transition-colors cursor-pointer ${
              autoRefresh
                ? "bg-[#f97316]/10 border-[#f97316]/40 text-[#f97316]"
                : "bg-[#11131a] border-[#242838] text-neutral-400"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? "bg-[#f97316] animate-pulse" : "bg-neutral-600"}`} />
            <span>Auto-refresh ({countdown}s)</span>
          </button>

          {/* Manual Refresh button */}
          <button
            type="button"
            onClick={() => {
              refetch();
              setCountdown(30);
            }}
            className="p-2 rounded-xl bg-[#11131a] hover:bg-[#161922] border border-[#242838] text-neutral-300 hover:text-white transition-colors cursor-pointer"
            title="Refresh quota now"
          >
            <RotateCw className={`w-4 h-4 ${isFetching ? "animate-spin text-[#38bdf8]" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Grid Account Cards (Matching 9Router side-by-side card UI) ── */}
      {accounts.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {accounts.map((acc) => {
            const isEnabled = acc.enabled && acc.state === "ACTIVE";

            return (
              <div
                key={acc.accountId}
                className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 shadow-2xl space-y-4"
              >
                {/* Account Card Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-[#38bdf8]">
                      <Cloud className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                        <span>{acc.accountName}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                          isEnabled
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}>
                          {acc.state}
                        </span>
                      </div>
                      <div className="text-xs text-neutral-400 font-mono mt-0.5">
                        {acc.email}
                      </div>
                    </div>
                  </div>

                  {/* Top Right Account Actions & Switch */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                      title="Sync account"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (window.confirm(`Delete connection '${acc.accountName}'?`)) {
                          await deleteAccount.mutateAsync(acc.accountId);
                        }
                      }}
                      className="p-1.5 rounded-lg text-[#ef4444] hover:bg-red-500/10 transition-colors cursor-pointer"
                      title="Delete account"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    {/* iOS style toggle switch */}
                    <button
                      type="button"
                      onClick={() => toggleAccount.mutate({ id: acc.accountId, enable: !acc.enabled })}
                      className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ml-1 ${
                        acc.enabled ? "bg-[#f97316]" : "bg-[#262a38]"
                      }`}
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.75 transition-transform ${
                          acc.enabled ? "right-1" : "left-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Subtitle */}
                <div className="text-[11px] font-mono text-neutral-500 border-b border-[#1e2230] pb-2 flex items-center justify-between">
                  <span>Quota windows (5h session & 7d weekly)</span>
                  <span className="text-neutral-400 font-semibold">{acc.tier.toUpperCase()} TIER</span>
                </div>

                {/* ── 5H Session & 7D Weekly Quota Progress Bars ── */}
                <div className="space-y-4 pt-1">
                  {/* 1. Session 5H Usage */}
                  <div className="space-y-1.5 p-3 rounded-xl bg-black/30 border border-white/5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            acc.session.remainingPercent > 20 ? "bg-[#10b981]" : "bg-[#ef4444]"
                          }`}
                        />
                        <span className="text-white font-semibold">5-Hour Session Quota</span>
                        <span className="text-neutral-500 text-[11px]">
                          {acc.session.remaining} / {acc.session.limit} reqs
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#10b981] font-bold">
                          {acc.session.remainingPercent}%
                        </span>
                        <span className="text-neutral-400 text-[11px]">
                          {acc.session.resetText}
                        </span>
                      </div>
                    </div>

                    <div className="w-full h-2 rounded-full bg-[#1e2230] overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          acc.session.remainingPercent > 20 ? "bg-[#10b981]" : "bg-[#ef4444]"
                        }`}
                        style={{ width: `${Math.max(2, acc.session.remainingPercent)}%` }}
                      />
                    </div>
                  </div>

                  {/* 2. Weekly 7D Usage */}
                  <div className="space-y-1.5 p-3 rounded-xl bg-black/30 border border-white/5">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            acc.weekly.remainingPercent > 20 ? "bg-[#10b981]" : "bg-[#ef4444]"
                          }`}
                        />
                        <span className="text-white font-semibold">7-Day Weekly Quota</span>
                        <span className="text-neutral-500 text-[11px]">
                          {acc.weekly.remaining} / {acc.weekly.limit} reqs
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#10b981] font-bold">
                          {acc.weekly.remainingPercent}%
                        </span>
                        <span className="text-neutral-400 text-[11px]">
                          {acc.weekly.resetText}
                        </span>
                      </div>
                    </div>

                    <div className="w-full h-2 rounded-full bg-[#1e2230] overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          acc.weekly.remainingPercent > 20 ? "bg-[#10b981]" : "bg-[#ef4444]"
                        }`}
                        style={{ width: `${Math.max(2, acc.weekly.remainingPercent)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* ── Per-Model Breakdown Accordion/Grid ── */}
                <div className="pt-2 border-t border-[#1e2230]">
                  <div className="text-[11px] font-mono text-neutral-400 mb-2 font-semibold">
                    Model Session Quotas ({acc.models.length} models)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {acc.models.map((m) => (
                      <div key={m.modelId} className="p-2 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] font-mono flex items-center justify-between">
                        <div className="truncate mr-2 text-neutral-300 font-medium" title={m.name}>
                          {m.name}
                        </div>
                        <div className="text-emerald-400 shrink-0 font-bold">
                          {m.remainingPercent}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 bg-[#11131a] border border-[#242838] rounded-2xl text-neutral-400 font-mono space-y-2">
          <p className="text-sm">No provider accounts found.</p>
          <p className="text-xs text-neutral-500">Add an Ollama Cloud account in the Providers tab to start tracking quotas.</p>
        </div>
      )}
    </div>
  );
}
