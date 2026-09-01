import { useState } from "react";
import {
  PageHeader,
  Button,
  Badge,
  CodeValue,
  Modal,
  Input,
  InlineAlert,
  EmptyState,
} from "../components/ui/index.js";
import {
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useTestAccount,
  useTestApiKey,
  useToggleAccountState,
  useRefreshModels,
  useModels,
  useToggleModel,
  useTestModel,
  type UpstreamAccount,
} from "../api/hooks.js";
import {
  Plus,
  RefreshCw,
  Play,
  Trash2,
  Power,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Bot,
  Copy,
  ChevronLeft,
  Search,
  Sparkles,
  Cloud,
  Check,
} from "lucide-react";

export function AccountsPage() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: allModels } = useModels();
  const createAccount = useCreateAccount();
  const deleteAccount = useDeleteAccount();
  const testAccount = useTestAccount();
  const testApiKey = useTestApiKey();
  const toggleAccount = useToggleAccountState();
  const refreshModels = useRefreshModels();
  const toggleModel = useToggleModel();
  const testModel = useTestModel();

  // Mode view: "catalog" (list providers grid) or "detail" (ollama cloud detail view)
  const [selectedProvider, setSelectedProvider] = useState<string | null>("ollama-cloud");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formPriority, setFormPriority] = useState(1);
  const [formWeight, setFormWeight] = useState(1.0);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [copiedModel, setCopiedModel] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  const [testResult, setTestResult] = useState<{ id: string; msg: string; success: boolean } | null>(null);
  const [modelTestResult, setModelTestResult] = useState<{
    modelId: string;
    success: boolean;
    latencyMs: number;
    response?: string;
    accountName?: string;
    error?: string;
  } | null>(null);

  // Pre-add test state
  const [preTestResult, setPreTestResult] = useState<{
    tested: boolean;
    success: boolean;
    msg: string;
    modelCount?: number;
  } | null>(null);

  const handlePreTestKey = async () => {
    if (!formApiKey.trim()) return;
    setPreTestResult(null);
    try {
      const res = await testApiKey.mutateAsync(formApiKey.trim());
      if (res.success) {
        setPreTestResult({
          tested: true,
          success: true,
          msg: `Valid! Connected in ${res.latencyMs}ms (${res.modelCount} models found)`,
          modelCount: res.modelCount,
        });
      } else {
        setPreTestResult({
          tested: true,
          success: false,
          msg: res.error || "Authentication failed against Ollama Cloud",
        });
      }
    } catch (err: unknown) {
      setPreTestResult({
        tested: true,
        success: false,
        msg: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  };

  const [formTier, setFormTier] = useState<"free" | "pro" | "max" | "team">("free");

  const handleCreate = async () => {
    if (!formName || !formApiKey) return;
    await createAccount.mutateAsync({
      name: formName,
      apiKey: formApiKey.trim(),
      tier: formTier,
      priority: formPriority,
      weight: formWeight,
    });
    setIsCreateOpen(false);
    setFormName("");
    setFormApiKey("");
    setFormTier("free");
    setPreTestResult(null);
  };

  const handleTest = async (account: UpstreamAccount) => {
    setTestingId(account.id);
    setTestResult(null);
    try {
      const res = await testAccount.mutateAsync(account.id);
      setTestResult({
        id: account.id,
        msg: res.success ? `Connected! Found ${res.modelCount} models in ${res.latencyMs}ms` : `Failed: ${res.error}`,
        success: res.success,
      });
    } catch (err: unknown) {
      setTestResult({
        id: account.id,
        msg: err instanceof Error ? err.message : "Test failed",
        success: false,
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleInstantModelTest = async (modelId: string) => {
    setTestingModelId(modelId);
    setModelTestResult(null);
    try {
      const res = await testModel.mutateAsync({
        id: modelId,
        prompt: "Say hello and confirm operational in 1 sentence.",
      });
      setModelTestResult({
        modelId,
        ...res,
      });
    } catch (err: unknown) {
      setModelTestResult({
        modelId,
        success: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Test request failed",
      });
    } finally {
      setTestingModelId(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedModel(text);
    setTimeout(() => setCopiedModel(null), 2000);
  };

  const activeAccountsCount = accounts?.filter((a) => a.enabled && a.state === "ACTIVE").length || 0;
  const totalAccountsCount = accounts?.length || 0;

  // Filter models: Only show available/enabled models that don't require paid tiers
  const freeAvailableModels = (allModels || []).filter((m) => {
    if (!m.enabled) return false;
    if (!searchFilter.trim()) return true;
    return m.publicModelId.toLowerCase().includes(searchFilter.toLowerCase());
  });

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Providers</h1>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Manage your AI provider connections and cloud model catalogs
          </p>
        </div>

        {selectedProvider && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSelectedProvider(null)}
            className="text-xs font-mono self-start sm:self-auto"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back to Providers
          </Button>
        )}
      </div>

      {/* ── View 1: Provider Catalog Grid (when selectedProvider === null) ── */}
      {!selectedProvider ? (
        <div className="space-y-8">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 font-mono">
                Free Tier Providers
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {/* Ollama Cloud Card */}
              <div
                onClick={() => setSelectedProvider("ollama-cloud")}
                className="bg-[#11131a] hover:bg-[#161922] border border-[#242838] hover:border-[#38bdf8]/50 rounded-xl p-4 cursor-pointer transition-all duration-150 flex items-center gap-3.5 group relative"
              >
                <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center shrink-0">
                  <Cloud className="w-5 h-5 text-[#38bdf8] group-hover:scale-110 transition-transform" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate group-hover:text-[#38bdf8] transition-colors">
                    Ollama Cloud
                  </div>
                  <div className="text-xs text-neutral-400 font-mono mt-0.5">
                    {totalAccountsCount > 0
                      ? `${activeAccountsCount} active (${totalAccountsCount} total)`
                      : "No connections"}
                  </div>
                </div>
                {totalAccountsCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-[#10b981] absolute top-3.5 right-3.5" />
                )}
              </div>

              {/* Placeholder Provider Cards matching 9router UI style */}
              {[
                { name: "OpenCode Free", desc: "Built-in endpoints", icon: Sparkles, active: false },
                { name: "OpenRouter", desc: "No connections", icon: Bot, active: false },
                { name: "Cloudflare Workers AI", desc: "No connections", icon: Cloud, active: false },
                { name: "Gemini CLI", desc: "No connections", icon: Bot, active: false },
                { name: "NVIDIA NIM", desc: "No connections", icon: Bot, active: false },
                { name: "Kiro AI", desc: "No connections", icon: Bot, active: false },
                { name: "Vertex AI", desc: "No connections", icon: Cloud, active: false },
              ].map((p, idx) => {
                const Icon = p.icon;
                return (
                  <div
                    key={idx}
                    className="bg-[#11131a]/60 border border-[#1e2230] rounded-xl p-4 flex items-center gap-3.5 opacity-60 hover:opacity-90 transition-opacity"
                  >
                    <div className="w-10 h-10 rounded-xl bg-black/30 border border-white/5 flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-neutral-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-neutral-300 truncate">{p.name}</div>
                      <div className="text-xs text-neutral-500 font-mono mt-0.5">{p.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ── View 2: Ollama Cloud Detail & Connections (Exact 9Router Style) ── */
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Provider Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-[#11131a] border border-[#242838] rounded-2xl">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center text-[#38bdf8]">
                <Cloud className="w-7 h-7" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-white tracking-tight">Ollama Cloud</h2>
                  <a
                    href="https://ollama.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#f97316] hover:underline font-medium ml-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Get API Key
                  </a>
                </div>
                <p className="text-xs text-neutral-400 font-mono mt-0.5">
                  {totalAccountsCount} connection{totalAccountsCount !== 1 ? "s" : ""} · {freeAvailableModels.length} free models available
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setIsCreateOpen(true)}
                className="bg-[#f97316] hover:bg-[#ea580c] text-white border-0 font-medium text-xs px-3.5 py-2 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Connection
              </Button>
            </div>
          </div>

          {/* Tier Info Banner */}
          <div className="flex items-center justify-between p-3 px-4 rounded-xl bg-blue-950/30 border border-blue-900/40 text-xs text-blue-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                <strong>Free tier:</strong> Available models supported on standard quota. Tier-restricted / subscription models are automatically hidden.
              </span>
            </div>
            <a
              href="https://ollama.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-medium shrink-0 ml-3 transition-colors"
            >
              Get API Key →
            </a>
          </div>

          {/* Model Instant Test Feedback Alert */}
          {modelTestResult && (
            <InlineAlert
              type={modelTestResult.success ? "success" : "error"}
              title={
                modelTestResult.success
                  ? `Live Test: ${modelTestResult.modelId} (Success in ${modelTestResult.latencyMs}ms via ${modelTestResult.accountName || "Ollama Cloud"})`
                  : `Live Test: ${modelTestResult.modelId} (Failed in ${modelTestResult.latencyMs}ms)`
              }
            >
              <div className="mt-1 space-y-1">
                {modelTestResult.response && (
                  <p className="text-xs font-mono bg-black/40 p-2.5 rounded-lg border border-white/10 text-white">
                    {modelTestResult.response}
                  </p>
                )}
                {modelTestResult.error && (
                  <p className="text-xs font-mono text-red-300">
                    {modelTestResult.error}
                  </p>
                )}
              </div>
            </InlineAlert>
          )}

          {/* ── Section: Connections List ── */}
          <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300 font-mono">
                Connections
              </h3>
              <div className="text-xs text-neutral-400 font-mono">
                Round Robin / Least-Load Weighted
              </div>
            </div>

            {accounts?.length ? (
              <div className="divide-y divide-[#1e2230] border border-[#1e2230] rounded-xl overflow-hidden bg-[#0c0d12]">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[#f97316]">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white flex items-center gap-2">
                          <span>{acc.name}</span>
                          <Badge variant={acc.enabled && acc.state === "ACTIVE" ? "success" : "danger"}>
                            {acc.state}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-neutral-500 font-mono mt-0.5">
                          ID: {acc.id.slice(0, 8)}... · Priority: {acc.priority} · Weight: {acc.weight.toFixed(1)}
                          {acc.lastSuccessAt && ` · Success: ${new Date(acc.lastSuccessAt).toLocaleTimeString()}`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={testingId === acc.id}
                        onClick={() => handleTest(acc)}
                        title="Test upstream connection"
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={refreshModels.isPending && refreshModels.variables === acc.id}
                        onClick={() => refreshModels.mutate(acc.id)}
                        title="Refresh models catalog"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        Sync Models
                      </Button>
                      <Button
                        size="sm"
                        variant={acc.enabled ? "secondary" : "primary"}
                        loading={toggleAccount.isPending && toggleAccount.variables?.id === acc.id}
                        onClick={() => toggleAccount.mutate({ id: acc.id, enable: !acc.enabled })}
                        title={acc.enabled ? "Disable" : "Enable"}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={deleteAccount.isPending && deleteAccount.variables === acc.id}
                        onClick={async () => {
                          if (window.confirm(`Remove connection '${acc.name}'? Models will be cleaned automatically.`)) {
                            try {
                              await deleteAccount.mutateAsync(acc.id);
                            } catch (err: unknown) {
                              alert(err instanceof Error ? err.message : "Failed to delete connection");
                            }
                          }
                        }}
                        title="Delete connection"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : !isLoading ? (
              <div className="text-center py-8 border border-dashed border-[#242838] rounded-xl bg-[#0c0d12]/50 text-neutral-400 space-y-2">
                <p className="text-sm">No Ollama Cloud accounts connected yet.</p>
                <Button
                  size="sm"
                  onClick={() => setIsCreateOpen(true)}
                  className="bg-[#f97316] hover:bg-[#ea580c] text-white border-0 text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add First Connection
                </Button>
              </div>
            ) : null}
          </div>

          {/* ── Section: Available Models Grid (9Router Card Layout with 1-Click Instant Test) ── */}
          <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300 font-mono">
                  Available Models ({freeAvailableModels.length})
                </h3>
                <p className="text-xs text-neutral-400 font-mono mt-0.5">
                  Free tier cloud models available for routing and testing
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-500" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Search models..."
                    className="w-full pl-8 pr-3 py-1.5 bg-[#0c0d12] border border-[#242838] rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#38bdf8]"
                  />
                </div>
              </div>
            </div>

            {freeAvailableModels.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {freeAvailableModels.map((m) => {
                  const isCopied = copiedModel === m.publicModelId;
                  const isTesting = testingModelId === m.id;

                  return (
                    <div
                      key={m.id}
                      className="p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-2.5 relative group bg-[#0c0d12] border-[#242838] hover:border-[#38bdf8]/50 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-white/5 text-[#38bdf8]">
                            <Bot className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white font-mono truncate" title={m.publicModelId}>
                              {m.publicModelId}
                            </div>
                            <div className="text-[10px] text-neutral-500 font-mono truncate">
                              Target: {m.upstreamModelId}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => copyToClipboard(m.publicModelId)}
                          className="p-1 rounded text-neutral-500 hover:text-white hover:bg-white/5 transition-colors shrink-0 cursor-pointer"
                          title="Copy model ID"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px]">
                        <span className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Available
                        </span>

                        <Button
                          size="sm"
                          variant="secondary"
                          loading={isTesting}
                          onClick={() => handleInstantModelTest(m.id)}
                          className="h-6 px-2 text-[11px] font-mono bg-white/5 hover:bg-white/10 border-white/10"
                          title="1-Click Instant Test"
                        >
                          <Play className="w-3 h-3 mr-1 text-[#38bdf8]" />
                          Test
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10 border border-dashed border-[#242838] rounded-xl bg-[#0c0d12]/50 text-neutral-400 font-mono text-xs">
                No free tier models available. Click "Sync Models" on an active connection to populate catalog.
              </div>
            )}
          </div>
        </div>
      )}

      {testResult && (
        <InlineAlert type={testResult.success ? "success" : "error"} title="Connection Test Result">
          {testResult.msg}
        </InlineAlert>
      )}

      {/* ── Add Connection Modal ── */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Add Ollama Cloud Account Connection"
        description="Encrypted securely in SQLite (AES-256-GCM). Free and Pro API keys supported."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              loading={createAccount.isPending}
              className="bg-[#f97316] hover:bg-[#ea580c] text-white border-0"
            >
              Save Connection
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Account Display Name"
            placeholder="e.g. Personal Account 1, Org Cluster"
            value={formName}
            onChange={setFormName}
            required
          />

          {/* Tier Selection Radio / Card Toggle */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Account Subscription Tier & Concurrency Limit
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setFormTier("free")}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  formTier === "free"
                    ? "bg-[#161922] border-[#38bdf8] text-white shadow-sm"
                    : "bg-[#0c0d12] border-[#242838] text-neutral-400 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Free</span>
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    1 Req
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 leading-tight">
                  Free models only (1 slot).
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFormTier("pro")}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  formTier === "pro"
                    ? "bg-[#161922] border-[#f97316] text-white shadow-sm"
                    : "bg-[#0c0d12] border-[#242838] text-neutral-400 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Pro</span>
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    3 Reqs
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 leading-tight">
                  All models (3 concurrent slots).
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFormTier("max")}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  formTier === "max" || formTier === "team"
                    ? "bg-[#161922] border-[#a855f7] text-white shadow-sm"
                    : "bg-[#0c0d12] border-[#242838] text-neutral-400 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">Max/Team</span>
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    10 Reqs
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1 leading-tight">
                  High capacity (10 concurrent slots).
                </p>
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              Ollama API Key / Bearer Token <span className="text-[var(--color-danger)]">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="ae1dca08... or ollama_..."
                value={formApiKey}
                onChange={(e) => {
                  setFormApiKey(e.target.value);
                  setPreTestResult(null);
                }}
                required
                className="flex-1 px-3 py-2 bg-[var(--color-bg-canvas)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={!formApiKey.trim()}
                loading={testApiKey.isPending}
                onClick={handlePreTestKey}
              >
                Test Key
              </Button>
            </div>
            <span className="block text-xs text-[var(--color-text-muted)] mt-1.5">
              Get your API key at https://ollama.com/settings/keys
            </span>

            {preTestResult && (
              <div
                className={`mt-2.5 p-3 rounded-lg border text-xs flex items-center gap-2 ${
                  preTestResult.success
                    ? "bg-[var(--color-success-bg)] border-[var(--color-success)]/30 text-[var(--color-success)]"
                    : "bg-[var(--color-danger-bg)] border-[var(--color-danger)]/30 text-[var(--color-danger)]"
                }`}
              >
                {preTestResult.success ? (
                  <CheckCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{preTestResult.msg}</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Priority Group"
              type="number"
              value={formPriority}
              onChange={(val) => setFormPriority(parseInt(val, 10) || 1)}
              description="Higher number = tried first"
            />
            <Input
              label="Traffic Weight"
              type="number"
              value={formWeight}
              onChange={(val) => setFormWeight(parseFloat(val) || 1.0)}
              description="Tie-break multiplier"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}