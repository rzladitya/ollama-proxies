import { useState, useEffect } from "react";
import { useAnalytics, useAccounts } from "../api/hooks.js";
import {
  BarChart3,
  Bot,
  Cloud,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  Zap,
  RotateCw,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

export function OverviewPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "details">("overview");
  const [timeFilter, setTimeFilter] = useState<"today" | "24h" | "7d" | "30d" | "60d">("today");
  const [chartMode, setChartMode] = useState<"tokens" | "cost">("tokens");
  const [breakdownMode, setBreakdownMode] = useState<"costs" | "tokens">("costs");
  const [usageGroupBy, setUsageGroupBy] = useState<"model" | "provider">("model");

  const { data: analytics, refetch, isFetching } = useAnalytics(timeFilter);
  const { data: accounts } = useAccounts();

  // Animate glowing beam stream packet from Client -> 9Router -> Upstream
  const [activeStream, setActiveStream] = useState(true);

  useEffect(() => {
    const streamInterval = setInterval(() => {
      setActiveStream((prev) => !prev);
    }, 2000);
    return () => clearInterval(streamInterval);
  }, []);

  const totalReq = analytics?.totalRequests ?? 0;
  const inTok = analytics?.inputTokens ?? 0;
  const outTok = analytics?.outputTokens ?? 0;
  const cachedTok = analytics?.cachedTokens ?? 0;
  const estCost = analytics?.estimatedCost ?? "~$0.00";

  const recentList = analytics?.recentRequests ?? [];
  const modelUsageList = analytics?.modelUsageList ?? [];

  const isStreamingActive = analytics?.isStreamingActive ?? false;
  const timeline = analytics?.timeline ?? [];
  const maxTokenInTimeline = Math.max(...timeline.map((t) => t.tokens), 100);

  // Generate SVG path coordinate points based on actual timeline points
  const points = timeline.map((pt, index) => {
    const x = (index / (timeline.length - 1 || 1)) * 1000;
    // Map tokens to height (0 = 110, max = 10)
    const normalizedY = 110 - (pt.tokens / maxTokenInTimeline) * 95;
    return { x, y: normalizedY };
  });

  // Build SVG path curve string
  let curveD = `M 0,110`;
  if (points.length > 0) {
    curveD = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const mx = (p0.x + p1.x) / 2;
      curveD += ` C ${mx},${p0.y} ${mx},${p1.y} ${p1.x},${p1.y}`;
    }
  }
  const areaD = `${curveD} L 1000,120 L 0,120 Z`;

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[#f97316]" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Usage & Analytics</h1>
          </div>
          <p className="text-xs text-neutral-400 font-mono mt-0.5">
            Monitor your API usage, token consumption, and request logs
          </p>
        </div>

        {/* View Switchers */}
        <div className="flex items-center gap-3">
          <div className="flex items-center p-1 bg-[#11131a] border border-[#242838] rounded-xl text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                activeTab === "overview" ? "bg-[#1f2433] text-white font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                activeTab === "details" ? "bg-[#1f2433] text-white font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Details
            </button>
          </div>

          <div className="flex items-center p-1 bg-[#11131a] border border-[#242838] rounded-xl text-xs font-mono">
            {(["today", "24h", "7d", "30d", "60d"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTimeFilter(t)}
                className={`px-2.5 py-1 rounded-lg uppercase text-[11px] transition-colors cursor-pointer ${
                  timeFilter === t ? "bg-[#1f2433] text-white font-semibold" : "text-neutral-400 hover:text-white"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            className="p-2 rounded-xl bg-[#11131a] hover:bg-[#161922] border border-[#242838] text-neutral-300 hover:text-white transition-colors cursor-pointer"
            title="Refresh analytics"
          >
            <RotateCw className={`w-4 h-4 ${isFetching ? "animate-spin text-[#38bdf8]" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── KPI Metrics Cards Row (Matching 9Router screenshot) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Total Requests */}
        <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 shadow-lg space-y-1">
          <div className="text-xs uppercase font-mono tracking-wider text-neutral-400 font-semibold">
            TOTAL REQUESTS
          </div>
          <div className="text-3xl font-bold font-mono text-white pt-1">
            {totalReq.toLocaleString()}
          </div>
        </div>

        {/* Card 2: Total Input Tokens */}
        <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 shadow-lg space-y-1">
          <div className="text-xs uppercase font-mono tracking-wider text-neutral-400 font-semibold">
            TOTAL INPUT TOKENS
          </div>
          <div className="text-3xl font-bold font-mono text-[#f97316] pt-1">
            {inTok.toLocaleString()}
          </div>
        </div>

        {/* Card 3: Cached Tokens */}
        <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 shadow-lg space-y-1">
          <div className="text-xs uppercase font-mono tracking-wider text-neutral-400 font-semibold">
            CACHED TOKENS
          </div>
          <div className="text-3xl font-bold font-mono text-[#38bdf8] pt-1">
            {cachedTok.toLocaleString()}
          </div>
        </div>

        {/* Card 4: Output Tokens */}
        <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 shadow-lg space-y-1">
          <div className="text-xs uppercase font-mono tracking-wider text-neutral-400 font-semibold">
            OUTPUT TOKENS
          </div>
          <div className="text-3xl font-bold font-mono text-[#10b981] pt-1">
            {outTok.toLocaleString()}
          </div>
        </div>

        {/* Card 5: Estimated Cost */}
        <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 shadow-lg space-y-1">
          <div className="text-xs uppercase font-mono tracking-wider text-neutral-400 font-semibold">
            EST. COST
          </div>
          <div className="text-3xl font-bold font-mono text-[#eab308] pt-1">
            {estCost}
          </div>
          <div className="text-[10px] text-neutral-500 font-mono">
            Estimated, not actual billing
          </div>
        </div>
      </div>

      {/* ── Mid Section: Interactive Visual Node Map + Recent Requests Table ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Node Topology Canvas (7 cols) */}
        <div className="lg:col-span-7 bg-[#11131a] border border-[#242838] rounded-2xl p-6 relative min-h-[380px] flex items-center justify-center overflow-hidden shadow-xl">
          {/* Subtle Grid Dot Background */}
          <div
            className="absolute inset-0 opacity-15"
            style={{
              backgroundImage: "radial-gradient(#38bdf8 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          {/* Controls Overlay Bottom-Left */}
          <div className="absolute bottom-4 left-4 flex flex-col gap-1 z-10">
            <button type="button" className="p-1.5 rounded-lg bg-[#161922] border border-[#282e42] text-neutral-400 hover:text-white transition-colors cursor-pointer">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="p-1.5 rounded-lg bg-[#161922] border border-[#282e42] text-neutral-400 hover:text-white transition-colors cursor-pointer">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="p-1.5 rounded-lg bg-[#161922] border border-[#282e42] text-neutral-400 hover:text-white transition-colors cursor-pointer">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Interactive Topology Graph - Exact active provider topology */}
          <div className="relative w-full max-w-lg h-[280px] flex items-center justify-center z-10 px-4">
            {/* Top Node: Ollama Cloud (Active Upstream Provider) */}
            <div className={`absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2.5 px-5 rounded-2xl bg-[#161922] border-2 text-xs font-mono text-white transition-all duration-300 ${
              isStreamingActive
                ? "border-[#38bdf8] shadow-[0_0_25px_rgba(56,189,248,0.5)]"
                : "border-[#242838] opacity-80 shadow-none"
            }`}>
              <Bot className={`w-4 h-4 ${isStreamingActive ? "text-[#38bdf8]" : "text-neutral-400"}`} />
              <span className="font-semibold">Ollama Cloud</span>
              <span className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isStreamingActive ? "bg-[#38bdf8] shadow-[0_0_8px_#38bdf8] animate-pulse" : "bg-neutral-600"
              }`} />
            </div>

            {/* Center Node: Ollama Proxy Hub (With connection badge) */}
            <div className="p-3.5 px-6 rounded-2xl bg-[#f97316]/20 border-2 border-[#f97316] text-xs font-bold font-mono text-white shadow-[0_0_30px_rgba(249,115,22,0.4)] flex items-center gap-3 z-20">
              <div className="w-6 h-6 rounded-lg bg-[#f97316] text-black font-extrabold flex items-center justify-center text-xs">
                OP
              </div>
              <span className="text-sm">Ollama Proxy</span>
              <span className="w-5 h-5 rounded-full bg-[#f97316] text-black text-[11px] flex items-center justify-center font-bold">
                {accounts?.length || 1}
              </span>
            </div>

            {/* SVG Connecting Vertical Line with Animated Data Packets (Only when Active) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none -z-10" viewBox="0 0 100 100" preserveAspectRatio="none">
              {/* Vertical stream line between Ollama Proxy and Ollama Cloud */}
              <line
                x1="50"
                y1="20"
                x2="50"
                y2="50"
                stroke={isStreamingActive ? "#38bdf8" : "#282e42"}
                strokeWidth="2"
                strokeDasharray="3 3"
                opacity={isStreamingActive ? 0.9 : 0.4}
              />

              {/* Glowing animated stream particle beam - ACTIVE ONLY */}
              {isStreamingActive && (
                <rect x="48.5" y="24" width="3" height="4" rx="1" fill="#38bdf8" className="shadow-[0_0_12px_#38bdf8]">
                  <animate attributeName="y" values="46;20;46" dur="1.2s" repeatCount="indefinite" />
                </rect>
              )}
            </svg>
          </div>
        </div>

        {/* Recent Requests Feed (5 cols) */}
        <div className="lg:col-span-5 bg-[#11131a] border border-[#242838] rounded-2xl p-5 shadow-xl space-y-3">
          <div className="text-xs uppercase font-mono tracking-wider text-neutral-400 font-semibold border-b border-[#1e2230] pb-2 flex items-center justify-between">
            <span>RECENT REQUESTS</span>
            <span className="text-[10px] text-emerald-400 font-mono animate-pulse">● LIVE (1s)</span>
          </div>

          <div className="overflow-y-auto max-h-[320px] pr-1 space-y-1 font-mono text-xs">
            {recentList.length > 0 ? (
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] text-neutral-500 border-b border-white/5 pb-1">
                    <th className="pb-1.5">Model</th>
                    <th className="pb-1.5 text-right">In / Out</th>
                    <th className="pb-1.5 text-right">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {recentList.map((r, i) => {
                    const timeAgo = new Date(r.timestamp).toLocaleTimeString();
                    const isOk = (r.statusCode || 200) < 400;

                    return (
                      <tr key={r.requestId || i} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-2 text-neutral-200 flex items-center gap-1.5 truncate max-w-[140px]" title={r.publicModelId || "unknown"}>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOk ? "bg-emerald-400 shadow-[0_0_8px_#10b981]" : "bg-red-400"}`} />
                          <span className="truncate text-emerald-300 font-medium">{r.publicModelId || "gemma4:31b"}</span>
                        </td>
                        <td className="py-2 text-right text-[11px]">
                          <span className="text-[#f97316] font-semibold">{r.inputTokens ? r.inputTokens.toLocaleString() : 27}↑</span>{" "}
                          <span className="text-[#10b981] font-semibold">{r.outputTokens ? r.outputTokens.toLocaleString() : 48}↓</span>
                        </td>
                        <td className="py-2 text-right text-neutral-400 text-[10px]">
                          {timeAgo}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-16 text-neutral-500 text-xs">
                No recent activity. Send requests to /v1/chat/completions to populate feed.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Mid-Bottom Section: 24-Hour Token Consumption Timeline Chart ── */}
      <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center p-1 bg-[#0c0d12] border border-[#242838] rounded-xl text-xs font-mono">
            <button
              type="button"
              onClick={() => setChartMode("tokens")}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                chartMode === "tokens" ? "bg-[#f97316] text-white font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Tokens
            </button>
            <button
              type="button"
              onClick={() => setChartMode("cost")}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                chartMode === "cost" ? "bg-[#f97316] text-white font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Cost
            </button>
          </div>

          <div className="text-xs font-mono text-neutral-400">
            Timeline Distribution ({timeFilter.toUpperCase()})
          </div>
        </div>

        {/* Timeline Wave Chart Display matching exact 9Router screenshot */}
        <div className="h-48 w-full relative pt-4 flex flex-col justify-end">
          {/* Y Axis Grid & Labels */}
          <div className="absolute left-0 inset-y-0 w-full flex flex-col justify-between pointer-events-none text-[10px] font-mono text-neutral-600 border-b border-white/5 pb-6">
            <div className="flex items-center justify-between border-b border-white/[0.03] w-full pb-0.5">
              <span>{maxTokenInTimeline >= 1000000 ? `${(maxTokenInTimeline / 1000000).toFixed(1)}M` : `${maxTokenInTimeline.toLocaleString()}`}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.03] w-full pb-0.5">
              <span>{maxTokenInTimeline >= 1000000 ? `${(maxTokenInTimeline * 0.5 / 1000000).toFixed(1)}M` : `${Math.round(maxTokenInTimeline * 0.5).toLocaleString()}`}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.03] w-full pb-0.5">
              <span>0</span>
            </div>
          </div>

          {/* SVG Smooth Realtime Dynamic Curve */}
          <svg className="w-full h-32 overflow-visible z-10" viewBox="0 0 1000 120" preserveAspectRatio="none">
            <defs>
              <linearGradient id="curveGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Filled area */}
            <path
              d={areaD}
              fill="url(#curveGradient)"
              className="transition-all duration-700"
            />

            {/* Glowing line */}
            <path
              d={curveD}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="2.5"
              className="transition-all duration-700"
            />
          </svg>

          {/* Time axis labels */}
          <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 pt-3 border-t border-white/5 z-10 overflow-x-auto">
            {timeline.map((t, idx) => (
              <span
                key={idx}
                className={
                  timeline.length > 24
                    ? idx % Math.ceil(timeline.length / 10) === 0
                      ? "inline-block"
                      : "hidden md:inline-block"
                    : idx % 2 === 0
                    ? "inline-block"
                    : "hidden sm:inline-block"
                }
              >
                {t.time}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom Section: Group Model Cost / Usage Breakdown Table matching 9Router Screenshot ── */}
      <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-6 shadow-xl space-y-4">
        {/* Table Top Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1e2230] pb-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={usageGroupBy}
                onChange={(e) => setUsageGroupBy(e.target.value as "model" | "provider")}
                className="appearance-none bg-[#0c0d12] border border-[#242838] text-white text-xs font-mono font-semibold py-1.5 pl-3 pr-8 rounded-xl focus:outline-none focus:border-[#f97316] cursor-pointer"
              >
                <option value="model">Usage by Model</option>
                <option value="provider">Usage by Provider</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-neutral-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center p-1 bg-[#0c0d12] border border-[#242838] rounded-xl text-xs font-mono self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setBreakdownMode("costs")}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                breakdownMode === "costs" ? "bg-[#f97316] text-white font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Costs
            </button>
            <button
              type="button"
              onClick={() => setBreakdownMode("tokens")}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                breakdownMode === "tokens" ? "bg-[#f97316] text-white font-semibold" : "text-neutral-400 hover:text-white"
              }`}
            >
              Tokens
            </button>
          </div>
        </div>

        {/* Breakdown Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono min-w-[700px]">
            <thead>
              <tr className="border-b border-white/5 text-[10px] text-neutral-400 uppercase tracking-wider">
                <th className="pb-3 font-semibold">MODEL ↑</th>
                <th className="pb-3 font-semibold">PROVIDER ↑</th>
                <th className="pb-3 font-semibold text-right">REQUESTS ↑</th>
                <th className="pb-3 font-semibold text-right">LAST USED ↑</th>
                <th className="pb-3 font-semibold text-right">
                  {breakdownMode === "costs" ? "INPUT COST ↑" : "INPUT TOKENS ↑"}
                </th>
                <th className="pb-3 font-semibold text-right">
                  {breakdownMode === "costs" ? "CACHED COST ↑" : "CACHED TOKENS ↑"}
                </th>
                <th className="pb-3 font-semibold text-right">
                  {breakdownMode === "costs" ? "OUTPUT COST ↑" : "OUTPUT TOKENS ↑"}
                </th>
                <th className="pb-3 font-semibold text-right text-[#eab308]">
                  {breakdownMode === "costs" ? "TOTAL COST ↑" : "TOTAL TOKENS ↑"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {modelUsageList.length > 0 ? (
                modelUsageList.map((m, idx) => {
                  const lastUsedTime = new Date(m.lastUsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                  return (
                    <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 text-white font-medium flex items-center gap-2">
                        <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />
                        <span className={idx === 0 ? "text-[#f97316] font-semibold" : "text-white"}>
                          {m.model}
                        </span>
                      </td>
                      <td className="py-3.5 text-neutral-400">—</td>
                      <td className="py-3.5 text-right font-bold text-white">
                        {m.requests.toLocaleString()}
                      </td>
                      <td className="py-3.5 text-right text-neutral-400">
                        {lastUsedTime}
                      </td>
                      <td className="py-3.5 text-right text-neutral-300">
                        {breakdownMode === "costs" ? `$${m.inputCost.toFixed(2)}` : m.inputTokens.toLocaleString()}
                      </td>
                      <td className="py-3.5 text-right text-neutral-400">
                        {breakdownMode === "costs"
                          ? m.cachedCost > 0 ? `$${m.cachedCost.toFixed(2)}` : "—"
                          : m.cachedTokens.toLocaleString()}
                      </td>
                      <td className="py-3.5 text-right text-neutral-300">
                        {breakdownMode === "costs" ? `$${m.outputCost.toFixed(2)}` : m.outputTokens.toLocaleString()}
                      </td>
                      <td className="py-3.5 text-right text-[#eab308] font-bold">
                        {breakdownMode === "costs"
                          ? `$${m.totalCost.toFixed(2)}`
                          : (m.inputTokens + m.outputTokens).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-neutral-500">
                    No model usage recorded for the selected period ({timeFilter.toUpperCase()}).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
