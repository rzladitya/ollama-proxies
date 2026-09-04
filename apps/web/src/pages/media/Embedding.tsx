import { useState } from "react";
import {
  Button,
  Badge,
  Modal,
  Input,
  InlineAlert,
} from "../../components/ui/index.js";
import {
  useEmbeddingProviders,
  useEmbeddingProvider,
  useCreateEmbeddingConnection,
  useUpdateEmbeddingConnection,
  useDeleteEmbeddingConnection,
  useTestEmbeddingConnection,
  useCreateEmbeddingModel,
  useDeleteEmbeddingModel,
  useUpdateEmbeddingConfig,
  useTestEmbeddingModel,
  type EmbeddingConnection,
  type EmbeddingModelTestResult,
} from "../../api/hooks.js";
import {
  Plus,
  Play,
  Trash2,
  Power,
  AlertCircle,
  ExternalLink,
  Bot,
  Copy,
  ChevronLeft,
  Search,
  Brackets,
  Check,
  Pencil,
  Lock,
} from "lucide-react";

export function EmbeddingPage() {
  const { data: providerList } = useEmbeddingProviders();

  // Same shape as the Providers page: one screen, two views, and the only
  // implemented provider is opened by default.
  const [selectedProvider, setSelectedProvider] = useState<string | null>("openrouter");

  const { data, isLoading } = useEmbeddingProvider(selectedProvider ?? "");
  const createConnection = useCreateEmbeddingConnection(selectedProvider ?? "");
  const updateConnection = useUpdateEmbeddingConnection(selectedProvider ?? "");
  const deleteConnection = useDeleteEmbeddingConnection(selectedProvider ?? "");
  const testConnection = useTestEmbeddingConnection(selectedProvider ?? "");
  const createModel = useCreateEmbeddingModel(selectedProvider ?? "");
  const deleteModel = useDeleteEmbeddingModel(selectedProvider ?? "");
  const updateConfig = useUpdateEmbeddingConfig(selectedProvider ?? "");
  const testModel = useTestEmbeddingModel();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EmbeddingConnection | null>(null);
  const [formName, setFormName] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [isModelOpen, setIsModelOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [modelLabel, setModelLabel] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);

  const [searchFilter, setSearchFilter] = useState("");
  const [copiedModel, setCopiedModel] = useState<string | null>(null);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [modelTestResult, setModelTestResult] = useState<EmbeddingModelTestResult | null>(null);

  // Test console — a model test with the input and dimensions spelled out.
  const [consoleInput, setConsoleInput] = useState("The quick brown fox jumps over the lazy dog");
  const [consoleDimensions, setConsoleDimensions] = useState("");
  const [consoleModelId, setConsoleModelId] = useState("");

  const [preTestResult, setPreTestResult] = useState<{
    success: boolean;
    msg: string;
  } | null>(null);

  const providers = providerList?.providers ?? [];
  const provider = data?.provider;
  const connections = data?.connections ?? [];
  const models = data?.models ?? [];

  const activeConnectionCount = connections.filter(
    (c) => c.enabled && c.state === "ACTIVE",
  ).length;

  const filteredModels = models.filter((m) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return m.publicModelId.toLowerCase().includes(q) || m.label.toLowerCase().includes(q);
  });

  const copyToClipboard = (value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedModel(value);
    setTimeout(() => setCopiedModel(null), 2000);
  };

  const handleInstantModelTest = async (id: string, input?: string, dimensions?: number) => {
    setTestingModelId(id);
    setModelTestResult(null);
    try {
      const res = await testModel.mutateAsync({ id, input, dimensions });
      setModelTestResult(res);
    } catch (err: unknown) {
      const model = models.find((m) => m.id === id);
      setModelTestResult({
        success: false,
        modelId: model?.publicModelId ?? id,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTestingModelId(null);
    }
  };

  const handlePreTestKey = async () => {
    if (!formApiKey.trim() && !editing) return;
    setPreTestResult(null);
    try {
      const res = await testConnection.mutateAsync(
        formApiKey.trim() ? { apiKey: formApiKey.trim() } : { connectionId: editing?.id },
      );
      setPreTestResult({
        success: res.success,
        msg: res.success
          ? `Valid! Connected in ${res.latencyMs}ms (${res.dimensions} dimensions)`
          : res.error || "Authentication failed against the provider",
      });
    } catch (err: unknown) {
      setPreTestResult({
        success: false,
        msg: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormApiKey("");
    setFormError(null);
    setPreTestResult(null);
    setIsCreateOpen(true);
  };

  const openEdit = (conn: EmbeddingConnection) => {
    setEditing(conn);
    setFormName(conn.name);
    setFormApiKey("");
    setFormError(null);
    setPreTestResult(null);
    setIsCreateOpen(true);
  };

  const handleSaveConnection = async () => {
    setFormError(null);
    try {
      if (editing) {
        await updateConnection.mutateAsync({
          id: editing.id,
          name: formName.trim(),
          ...(formApiKey.trim() ? { apiKey: formApiKey.trim() } : {}),
        });
      } else {
        await createConnection.mutateAsync({
          name: formName.trim(),
          apiKey: formApiKey.trim(),
        });
      }
      setIsCreateOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save connection");
    }
  };

  const handleAddModel = async () => {
    setModelError(null);
    try {
      await createModel.mutateAsync({
        publicModelId: modelId.trim(),
        label: modelLabel.trim() || undefined,
      });
      setIsModelOpen(false);
      setModelId("");
      setModelLabel("");
    } catch (err: unknown) {
      setModelError(err instanceof Error ? err.message : "Failed to add model");
    }
  };

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--color-border)]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Embedding</h1>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Manage embedding providers and route vector requests through this gateway
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

      {/* ── View 1: Provider catalog ── */}
      {!selectedProvider ? (
        <div className="space-y-8">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 font-mono">
                Embedding Providers
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {providers.map((p) =>
                p.locked ? (
                  <div
                    key={p.id}
                    title="Not available yet"
                    aria-disabled="true"
                    className="bg-[#11131a]/60 border border-[#1e2230] rounded-xl p-4 flex items-center gap-3.5 opacity-60 hover:opacity-90 transition-opacity"
                  >
                    <div className="w-10 h-10 rounded-xl bg-black/30 border border-white/5 flex items-center justify-center shrink-0">
                      <Bot className="w-5 h-5 text-neutral-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-neutral-300 truncate flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        <Lock className="w-3 h-3 shrink-0 text-neutral-500" />
                      </div>
                      <div className="text-xs text-neutral-500 font-mono mt-0.5">Coming soon</div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    className="bg-[#11131a] hover:bg-[#161922] border border-[#242838] hover:border-[#38bdf8]/50 rounded-xl p-4 cursor-pointer transition-all duration-150 flex items-center gap-3.5 group relative"
                  >
                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center shrink-0">
                      <Brackets className="w-5 h-5 text-[#38bdf8] group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate group-hover:text-[#38bdf8] transition-colors">
                        {p.name}
                      </div>
                      <div className="text-xs text-neutral-400 font-mono mt-0.5">
                        {p.connectionCount > 0
                          ? `${p.connectionCount} connection${p.connectionCount !== 1 ? "s" : ""}`
                          : "No connections"}
                      </div>
                    </div>
                    {p.connectionCount > 0 && (
                      <span className="w-2 h-2 rounded-full bg-[#10b981] absolute top-3.5 right-3.5" />
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      ) : !provider ? (
        <div className="text-center py-20 text-sm text-neutral-400 font-mono">
          {isLoading ? "Loading provider…" : "Provider not found."}
        </div>
      ) : (
        /* ── View 2: Provider detail ── */
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Provider Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-[#11131a] border border-[#242838] rounded-2xl">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center text-[#38bdf8]">
                <Brackets className="w-7 h-7" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-white tracking-tight">{provider.name}</h2>
                  {provider.apiKeyUrl && (
                    <a
                      href={provider.apiKeyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#f97316] hover:underline font-medium ml-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Get API Key
                    </a>
                  )}
                </div>
                <p className="text-xs text-neutral-400 font-mono mt-0.5">
                  {connections.length} connection{connections.length !== 1 ? "s" : ""} ·{" "}
                  {models.length} embedding model{models.length !== 1 ? "s" : ""} ·{" "}
                  {activeConnectionCount} active
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={openCreate}
                className="bg-[#f97316] hover:bg-[#ea580c] text-white border-0 font-medium text-xs px-3.5 py-2 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Connection
              </Button>
            </div>
          </div>

          {/* Provider notice */}
          {provider.notice && (
            <div className="flex items-center justify-between p-3 px-4 rounded-xl bg-blue-950/30 border border-blue-900/40 text-xs text-blue-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-blue-400 shrink-0" />
                <span>{provider.notice}</span>
              </div>
              {provider.apiKeyUrl && (
                <a
                  href={provider.apiKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-medium shrink-0 ml-3 transition-colors"
                >
                  Get API Key →
                </a>
              )}
            </div>
          )}

          {/* Model test feedback */}
          {modelTestResult && (
            <InlineAlert
              type={modelTestResult.success ? "success" : "error"}
              title={
                modelTestResult.success
                  ? `Live Test: ${modelTestResult.modelId} (Success in ${modelTestResult.latencyMs}ms via ${modelTestResult.connectionName})`
                  : `Live Test: ${modelTestResult.modelId} (Failed in ${modelTestResult.latencyMs}ms)`
              }
            >
              <div className="mt-1 space-y-1">
                {modelTestResult.success && (
                  <p className="text-xs font-mono bg-black/40 p-2.5 rounded-lg border border-white/10 text-white break-all">
                    {modelTestResult.dimensions} dimensions ·{" "}
                    {modelTestResult.usage?.prompt_tokens ?? 0} tokens
                    {modelTestResult.usage?.cost != null
                      ? ` · $${modelTestResult.usage.cost.toFixed(8)}`
                      : ""}
                    <br />
                    <span className="text-neutral-400">
                      [{(modelTestResult.preview ?? []).map((n) => n.toFixed(6)).join(", ")}, …]
                    </span>
                  </p>
                )}
                {modelTestResult.error && (
                  <p className="text-xs font-mono text-red-300">{modelTestResult.error}</p>
                )}
              </div>
            </InlineAlert>
          )}

          {/* ── Section: Connections ── */}
          <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300 font-mono">
                Connections
              </h3>
              <label className="flex items-center gap-2 text-xs text-neutral-400 font-mono cursor-pointer">
                <span title="Rotate requests across connections instead of always using the first">
                  Round Robin
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={data?.config.roundRobin ?? false}
                  aria-label="Round Robin"
                  onClick={() =>
                    updateConfig.mutate({ roundRobin: !(data?.config.roundRobin ?? false) })
                  }
                  className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
                    data?.config.roundRobin ? "bg-[#10b981]" : "bg-neutral-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      data?.config.roundRobin ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </label>
            </div>

            {connections.length ? (
              <div className="divide-y divide-[#1e2230] border border-[#1e2230] rounded-xl overflow-hidden bg-[#0c0d12]">
                {connections.map((conn) => (
                  <div
                    key={conn.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[#f97316]">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white flex items-center gap-2">
                          <span>{conn.name}</span>
                          <Badge
                            variant={conn.enabled && conn.state === "ACTIVE" ? "success" : "danger"}
                          >
                            {conn.enabled ? conn.state : "DISABLED"}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-neutral-500 font-mono mt-0.5">
                          ID: {conn.id.slice(0, 8)}... · Priority: {conn.position}
                          {conn.lastSuccessAt &&
                            ` · Success: ${new Date(conn.lastSuccessAt).toLocaleTimeString()}`}
                        </div>
                        {conn.state === "INVALID" && conn.lastErrorCode && (
                          <div
                            className="text-[11px] text-red-400 font-mono mt-1 truncate max-w-md"
                            title={conn.lastErrorCode}
                          >
                            {conn.lastErrorCode}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={testConnection.isPending && testConnection.variables?.connectionId === conn.id}
                        onClick={async () => {
                          const res = await testConnection.mutateAsync({ connectionId: conn.id });
                          setModelTestResult({
                            success: res.success,
                            modelId: res.model ?? conn.name,
                            latencyMs: res.latencyMs,
                            connectionName: conn.name,
                            dimensions: res.dimensions,
                            error: res.error,
                          });
                        }}
                        title="Test upstream connection"
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openEdit(conn)}
                        title="Edit connection"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant={conn.enabled ? "secondary" : "primary"}
                        loading={
                          updateConnection.isPending && updateConnection.variables?.id === conn.id
                        }
                        onClick={() =>
                          updateConnection.mutate({ id: conn.id, enabled: !conn.enabled })
                        }
                        title={conn.enabled ? "Disable" : "Enable"}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={
                          deleteConnection.isPending && deleteConnection.variables === conn.id
                        }
                        onClick={() => {
                          if (window.confirm(`Remove connection '${conn.name}'?`)) {
                            deleteConnection.mutate(conn.id);
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
                <p className="text-sm">No {provider.name} connections yet.</p>
                <Button
                  size="sm"
                  onClick={openCreate}
                  className="bg-[#f97316] hover:bg-[#ea580c] text-white border-0 text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add First Connection
                </Button>
              </div>
            ) : null}
          </div>

          {/* ── Section: Models ── */}
          <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300 font-mono">
                  Embedding Models ({filteredModels.length})
                </h3>
                <p className="text-xs text-neutral-400 font-mono mt-0.5">
                  Curated catalog — {provider.name} does not list embedding models via its API
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
                <Button size="sm" variant="secondary" onClick={() => setIsModelOpen(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Model
                </Button>
              </div>
            </div>

            {filteredModels.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredModels.map((m) => {
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
                            <div
                              className="text-xs font-semibold text-white font-mono truncate"
                              title={m.publicModelId}
                            >
                              {m.publicModelId}
                            </div>
                            <div className="text-[10px] text-neutral-500 font-mono truncate">
                              Target: {m.upstreamModelId}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center shrink-0">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(m.publicModelId)}
                            className="p-1 rounded text-neutral-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                            title="Copy model ID"
                          >
                            {isCopied ? (
                              <Check className="w-3.5 h-3.5 text-[#10b981]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Remove model '${m.publicModelId}'?`)) {
                                deleteModel.mutate(m.id);
                              }
                            }}
                            className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
                            title="Remove from catalog"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px]">
                        <span className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {m.enabled ? "Available" : "Disabled"}
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
                {searchFilter
                  ? "No models match your search."
                  : 'No embedding models in the catalog. Click "Add Model" to add one.'}
              </div>
            )}
          </div>

          {/* ── Section: Test Console ── */}
          <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300 font-mono">
                Test Console
              </h3>
              <p className="text-xs text-neutral-400 font-mono mt-0.5">
                Send a custom input through the connection pool — the same path{" "}
                <code className="text-[#38bdf8]">/v1/embeddings</code> takes
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">Model</label>
                <select
                  value={consoleModelId || filteredModels[0]?.id || ""}
                  onChange={(e) => setConsoleModelId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0c0d12] border border-[#242838] rounded-lg text-xs text-white font-mono focus:outline-none focus:border-[#38bdf8]"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.publicModelId}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                  Dimensions
                </label>
                <input
                  type="number"
                  value={consoleDimensions}
                  onChange={(e) => setConsoleDimensions(e.target.value)}
                  placeholder="optional"
                  className="w-full px-3 py-2 bg-[#0c0d12] border border-[#242838] rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#38bdf8]"
                />
              </div>
              <div className="flex items-end">
                <Button
                  loading={testModel.isPending}
                  disabled={models.length === 0}
                  onClick={() => {
                    const id = consoleModelId || filteredModels[0]?.id;
                    if (!id) return;
                    const dim = parseInt(consoleDimensions, 10);
                    handleInstantModelTest(
                      id,
                      consoleInput,
                      Number.isFinite(dim) && dim > 0 ? dim : undefined,
                    );
                  }}
                  className="w-full bg-[#f97316] hover:bg-[#ea580c] text-white border-0"
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Run Test
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">Input</label>
              <textarea
                value={consoleInput}
                onChange={(e) => setConsoleInput(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-[#0c0d12] border border-[#242838] rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#38bdf8] resize-y"
              />
            </div>

            <div className="text-[11px] text-neutral-500 font-mono border-t border-[#1e2230] pt-3">
              Gateway endpoint:{" "}
              <span className="text-[#38bdf8]">{window.location.origin}/v1/embeddings</span> ·
              authenticate with an <span className="text-white">sk-proxy-…</span> key from the API
              Keys page
            </div>
          </div>
        </div>
      )}

      {/* ── Connection modal ── */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title={editing ? "Edit Connection" : `Add ${provider?.name ?? "Provider"} Connection`}
        description={
          editing
            ? "Leave the API key blank to keep the existing one."
            : "Store an API key for routing embedding requests."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveConnection}
              loading={createConnection.isPending || updateConnection.isPending}
              disabled={!formName.trim() || (!editing && !formApiKey.trim())}
              className="bg-[#f97316] hover:bg-[#ea580c] text-white border-0"
            >
              {editing ? "Save Changes" : "Save Connection"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <InlineAlert type="error" title="Could not save">
              {formError}
            </InlineAlert>
          )}
          <Input
            label="Connection Name"
            value={formName}
            onChange={setFormName}
            placeholder="e.g. openrouter-01"
            required
          />
          <Input
            label={editing ? "New API Key (optional)" : "API Key"}
            value={formApiKey}
            onChange={setFormApiKey}
            type="password"
            placeholder="sk-or-v1-..."
            required={!editing}
          />

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={testConnection.isPending}
              disabled={!formApiKey.trim() && !editing}
              onClick={handlePreTestKey}
            >
              <Play className="w-3.5 h-3.5 mr-1" />
              Test Key
            </Button>
            {preTestResult && (
              <span
                className={`text-xs font-mono ${
                  preTestResult.success ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {preTestResult.msg}
              </span>
            )}
          </div>
        </div>
      </Modal>

      {/* ── Add model modal ── */}
      <Modal
        isOpen={isModelOpen}
        onClose={() => setIsModelOpen(false)}
        title="Add Embedding Model"
        description="The upstream id is derived by stripping the provider prefix."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModelOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddModel}
              loading={createModel.isPending}
              disabled={!modelId.trim()}
              className="bg-[#f97316] hover:bg-[#ea580c] text-white border-0"
            >
              Add Model
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modelError && (
            <InlineAlert type="error" title="Could not add model">
              {modelError}
            </InlineAlert>
          )}
          <Input
            label="Model ID"
            value={modelId}
            onChange={setModelId}
            placeholder="openrouter/perplexity/pplx-embed-v1-4b"
            description="Clients send this id. Everything after the provider prefix goes upstream."
            required
          />
          <Input
            label="Display Label"
            value={modelLabel}
            onChange={setModelLabel}
            placeholder="Perplexity Embed V1 4B"
          />
        </div>
      </Modal>
    </div>
  );
}
