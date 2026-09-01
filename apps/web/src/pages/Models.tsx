import { useState } from "react";
import { PageHeader, Button, Badge, CodeValue, InlineAlert, EmptyState } from "../components/ui/index.js";
import { useModels, useToggleModel, useDeleteModel, useTestModel, type ModelItem } from "../api/hooks.js";
import { Power, Trash2, Play, CheckCircle, AlertCircle } from "lucide-react";

export function ModelsPage() {
  const { data: models, isLoading } = useModels();
  const toggleModel = useToggleModel();
  const deleteModel = useDeleteModel();
  const testModel = useTestModel();

  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [inlineResult, setInlineResult] = useState<{
    modelId: string;
    success: boolean;
    latencyMs: number;
    response?: string;
    accountName?: string;
    error?: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  } | null>(null);

  const handleInstantTest = async (model: ModelItem) => {
    setTestingModelId(model.id);
    setInlineResult(null);
    try {
      const res = await testModel.mutateAsync({
        id: model.id,
        prompt: "Say hello and confirm operational in 1 sentence.",
      });
      setInlineResult({
        modelId: model.id,
        ...res,
      });
    } catch (err: unknown) {
      setInlineResult({
        modelId: model.id,
        success: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Test request failed",
      });
    } finally {
      setTestingModelId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Model Catalog"
        description="Public AI models exposed to proxy clients. 1-click test inference directly into logs or toggle model routing availability."
      />

      {inlineResult && (
        <InlineAlert
          type={inlineResult.success ? "success" : "error"}
          title={
            inlineResult.success
              ? `Model Test: ${inlineResult.modelId} (Success in ${inlineResult.latencyMs}ms via ${inlineResult.accountName || "upstream"})`
              : `Model Test: ${inlineResult.modelId} (Failed in ${inlineResult.latencyMs}ms)`
          }
        >
          <div className="space-y-1.5 mt-1">
            {inlineResult.response && (
              <p className="text-xs font-mono bg-black/30 p-2.5 rounded-lg border border-white/10 text-white">
                {inlineResult.response}
              </p>
            )}
            {inlineResult.error && (
              <p className="text-xs text-red-300 font-mono">{inlineResult.error}</p>
            )}
            {inlineResult.usage && (
              <p className="text-[11px] text-[var(--color-text-muted)] font-mono">
                Tokens: In {inlineResult.usage.prompt_tokens} · Out {inlineResult.usage.completion_tokens} · Total {inlineResult.usage.total_tokens}
              </p>
            )}
          </div>
        </InlineAlert>
      )}

      {models?.length ? (
        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[620px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-canvas)] text-xs text-[var(--color-text-muted)]">
                <th className="py-3.5 px-4 font-medium">Public Model ID</th>
                <th className="py-3.5 px-4 font-medium">Upstream Target</th>
                <th className="py-3.5 px-4 font-medium">Status</th>
                <th className="py-3.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {models.map((m) => (
                <tr key={m.id} className="hover:bg-white/2 transition-colors">
                  <td className="py-4 px-4 font-medium">
                    <CodeValue value={m.publicModelId} />
                  </td>
                  <td className="py-4 px-4 text-xs font-mono text-[var(--color-text-secondary)]">
                    {m.upstreamModelId}
                  </td>
                  <td className="py-4 px-4">
                    <Badge variant={m.enabled ? "success" : "neutral"}>
                      {m.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={testingModelId === m.id}
                        onClick={() => handleInstantTest(m)}
                        title="1-Click Instant Model Test"
                      >
                        <Play className="w-3.5 h-3.5 mr-1" />
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant={m.enabled ? "secondary" : "primary"}
                        loading={toggleModel.isPending && toggleModel.variables?.id === m.id}
                        onClick={() => toggleModel.mutate({ id: m.id, enabled: !m.enabled })}
                      >
                        <Power className="w-3.5 h-3.5 mr-1" />
                        {m.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={deleteModel.isPending && deleteModel.variables === m.id}
                        onClick={async () => {
                          if (window.confirm(`Delete model '${m.publicModelId}' from catalog?`)) {
                            try {
                              await deleteModel.mutateAsync(m.id);
                            } catch (err: unknown) {
                              alert(err instanceof Error ? err.message : "Failed to delete model");
                            }
                          }
                        }}
                        title="Delete model"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !isLoading ? (
        <EmptyState
          title="No Models Registered"
          description="Go to the Accounts tab and click 'Refresh Models' on an active account to sync available upstream models."
        />
      ) : null}
    </div>
  );
}
