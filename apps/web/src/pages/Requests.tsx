import { useState, useRef, useEffect } from "react";
import { PageHeader, Button } from "../components/ui/index.js";
import { useRequests, useClearRequests } from "../api/hooks.js";
import { Terminal, Trash2, ArrowDown } from "lucide-react";

export function RequestsPage() {
  const { data: requests, isLoading } = useRequests({ limit: 1000 });
  const clearRequests = useClearRequests();
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto scroll down when new logs arrive if autoScroll is on
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [requests, autoScroll]);

  const handleClear = async () => {
    if (window.confirm("Clear all console logs?")) {
      await clearRequests.mutateAsync();
    }
  };

  // Reverse list so oldest is at top, latest at bottom like live console output
  const logsInOrder = [...(requests ?? [])].reverse();

  return (
    <div className="space-y-4 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <Terminal className="w-6 h-6 text-[#ef4444]" />
            <h1 className="text-2xl font-bold tracking-tight text-white font-mono">
              Console Log
            </h1>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 font-mono">
            Live server console output · Max 1000 lines auto-retention
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAutoScroll(!autoScroll)}
            className="text-xs font-mono"
            title="Toggle Auto-Scroll to Bottom"
          >
            <ArrowDown className={`w-3.5 h-3.5 mr-1 ${autoScroll ? "text-[var(--color-accent)]" : "text-neutral-500"}`} />
            Auto-Scroll: {autoScroll ? "ON" : "OFF"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={clearRequests.isPending}
            onClick={handleClear}
            className="text-xs font-mono"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Terminal View Container matching exact UI screenshot */}
      <div className="bg-[#0c0d12] border border-[#1e2230] rounded-xl p-4 shadow-2xl relative">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#1e2230]/60 text-xs font-mono text-[var(--color-text-muted)]">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
            <span className="ml-2 text-[11px] text-neutral-400 font-mono">terminal@ollama-proxy:~</span>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-[#161922] hover:bg-[#202533] border border-[#282e42] text-neutral-300 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3 h-3 text-neutral-400" />
            Clear
          </button>
        </div>

        <div className="overflow-y-auto max-h-[72vh] min-h-[480px] font-mono text-[12.5px] leading-relaxed select-text space-y-1 pr-2">
          {logsInOrder.length > 0 ? (
            logsInOrder.map((r, idx) => {
              const time = new Date(r.timestamp).toTimeString().split(" ")[0];
              const isOk = (r.statusCode || 200) < 400;
              const isTest = r.requestId?.startsWith("test_") || r.requestId?.startsWith("embtest_");
              const modelName = r.publicModelId || "unknown";
              // Never invent an account here. A missing id used to render as the
              // literal "Ollama Acc 1", which attributed requests to an account
              // that may not have served them — or may not exist at all.
              const accName = r.finalAccountId ? r.finalAccountId.slice(0, 8) : "—";
              const modeTag = r.stream ? "STREAM" : "JSON";

              return (
                <div key={r.requestId || idx} className="hover:bg-white/[0.02] py-0.5 px-1 rounded transition-colors space-y-0.5">
                  {/* Line 1: Inbound / Start */}
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-neutral-300">
                    <span className="text-neutral-500">[server]</span>
                    <span className="text-neutral-500">[{time}]</span>
                    <span className="text-[#38bdf8]">▶</span>
                    <span className="font-semibold text-white">{isTest ? "TEST model" : "POST"}</span>
                    <span className="text-[#f97316] font-semibold">{modelName}</span>
                    <span className="text-neutral-400">via ACC:{accName}</span>
                  </div>

                  {/* Line 2: Done / Metric */}
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-neutral-200">
                    <span className="text-neutral-500">[server]</span>
                    <span className="text-neutral-500">[{time}]</span>
                    <span className={isOk ? "text-[#10b981]" : "text-[#ef4444]"}>
                      {isOk ? "✔" : "✖"}
                    </span>
                    <span className="font-semibold text-white">DONE</span>
                    <span className="text-white font-mono">{r.latencyMs || 0}ms</span>
                    {r.ttfbMs != null && r.ttfbMs > 0 && (
                      <>
                        <span className="text-neutral-500">·</span>
                        <span className="text-neutral-400">TTFT {r.ttfbMs}ms</span>
                      </>
                    )}
                    {(r.inputTokens != null || r.outputTokens != null) && (
                      <>
                        <span className="text-neutral-500">·</span>
                        <span className="text-[#38bdf8]">IN {r.inputTokens ?? 0}</span>
                        <span className="text-neutral-500">·</span>
                        <span className="text-[#10b981]">OUT {r.outputTokens ?? 0}</span>
                      </>
                    )}
                    <span className="text-neutral-500">·</span>
                    <span className="text-neutral-300">ACC:{accName}</span>
                    <span className="text-neutral-500">·</span>
                    <span className="text-[#f97316]">{modelName}</span>
                    <span className="text-neutral-400">[{isTest ? "TEST-OK" : modeTag}]</span>
                    {!isTest && (
                      <span className={isOk ? "text-[#10b981] font-semibold" : "text-[#ef4444] font-semibold"}>
                        [{r.statusCode || 200}]
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          ) : !isLoading ? (
            <div className="text-center text-neutral-500 py-24 font-mono text-sm">
              <p className="text-neutral-400">[NO RECENT REQUEST LOGS]</p>
              <p className="text-xs text-neutral-600 mt-1">
                Send chat completions to /v1/chat/completions or click Test in Providers to see live output.
              </p>
            </div>
          ) : null}
          <div ref={terminalEndRef} />
        </div>
      </div>
    </div>
  );
}
