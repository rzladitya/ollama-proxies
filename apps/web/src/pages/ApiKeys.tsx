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
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useDeleteApiKey } from "../api/hooks.js";
import { Plus, Ban, Trash2, Copy, Check, Terminal, ExternalLink, Sparkles, BookOpen } from "lucide-react";

export function ApiKeysPage() {
  const { data: keys, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const deleteKey = useDeleteApiKey();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Dynamic origin or fallback
  const baseUrl = typeof window !== "undefined" ? `${window.location.origin}/v1` : "http://localhost:11435/v1";

  const copyText = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCreate = async () => {
    if (!keyName) return;
    const res = await createKey.mutateAsync({ name: keyName });
    setCreatedSecret(res.secret);
    setKeyName("");
    setIsCreateOpen(false);
  };

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      <PageHeader
        title="Client API Keys & Integration"
        description="OpenAI-compatible endpoints and API keys for connecting Dify, OpenCode, LibreChat, Cline, and OpenAI SDKs."
        actions={
          <Button onClick={() => setIsCreateOpen(true)} className="bg-[#00d2b4] hover:bg-[#00b89e] text-black font-semibold">
            <Plus className="w-4 h-4 mr-1.5" />
            Generate Key
          </Button>
        }
      />

      {/* ── Integration Quickstart Banner (Dify & OpenAI SDK) ── */}
      <div className="bg-[#11131a] border border-[#242838] rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-[#1e2230] pb-3">
          <div className="flex items-center gap-2 text-white font-mono text-sm font-semibold">
            <Sparkles className="w-4 h-4 text-[#00d2b4]" />
            <span>Proxy Endpoint & Quickstart</span>
          </div>
          <span className="text-[11px] font-mono text-neutral-400 bg-black/40 px-2 py-0.5 rounded border border-white/5">
            OpenAI-Compatible V1
          </span>
        </div>

        {/* URL Base Box */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono text-neutral-400">OpenAI Base URL (API Endpoint):</label>
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#0c0d12] border border-[#1e2230] font-mono text-xs text-[#00d2b4]">
            <span className="select-all">{baseUrl}</span>
            <button
              type="button"
              onClick={() => copyText(baseUrl, "base_url")}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-[#161922] hover:bg-[#202533] text-neutral-300 transition-colors cursor-pointer border border-[#282e42]"
            >
              {copiedField === "base_url" ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedField === "base_url" ? "Copied" : "Copy URL"}</span>
            </button>
          </div>
        </div>

        {/* Integration Instructions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Card 1: Dify Integration */}
          <div className="p-4 rounded-xl bg-[#0c0d12] border border-[#1e2230] space-y-2 text-xs font-mono">
            <div className="flex items-center gap-2 text-white font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#00d2b4]" />
              <span>Cara Integrasi ke Dify:</span>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-neutral-400 text-[11.5px] leading-relaxed">
              <li>Buka Dify <strong>Settings &gt; Model Provider</strong>.</li>
              <li>Pilih provider <strong>OpenAI-API-compatible</strong>.</li>
              <li>Isi <strong>Model Name</strong>: <code className="text-[#00d2b4]">gemma4:31b</code> (atau <code className="text-[#00d2b4]">nemotron-3-super</code>).</li>
              <li>Isi <strong>API Base URL</strong>: <code className="text-[#00d2b4]">{baseUrl}</code></li>
              <li>Isi <strong>API Key</strong>: Masukkan secret key (<code className="text-neutral-300">sk-proxy-...</code>).</li>
            </ol>
          </div>

          {/* Card 2: Python / cURL / OpenCode */}
          <div className="p-4 rounded-xl bg-[#0c0d12] border border-[#1e2230] space-y-2 text-xs font-mono">
            <div className="flex items-center gap-2 text-white font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#a78bfa]" />
              <span>Contoh Python (OpenAI SDK):</span>
            </div>
            <div className="p-2.5 rounded-lg bg-black/60 border border-white/5 text-[11px] text-neutral-300 overflow-x-auto leading-relaxed select-all">
              <p className="text-neutral-500">from openai import OpenAI</p>
              <p>client = OpenAI(</p>
              <p className="pl-3">base_url=<span className="text-[#00d2b4]">"{baseUrl}"</span>,</p>
              <p className="pl-3">api_key=<span className="text-[#f59e0b]">"sk-proxy-..."</span></p>
              <p>)</p>
              <p>res = client.chat.completions.create(</p>
              <p className="pl-3">model=<span className="text-[#00d2b4]">"gemma4:31b"</span>,</p>
              <p className="pl-3">messages=[{`{"role": "user", "content": "Halo!"}`}]</p>
              <p>)</p>
            </div>
          </div>
        </div>
      </div>

      {createdSecret && (
        <InlineAlert type="warning" title="Save Your Secret Key Now">
          <p className="mb-2">
            This secret will <strong>never be shown again</strong>. Store it securely:
          </p>
          <div className="bg-[var(--color-bg-canvas)] p-3 rounded-lg border border-[var(--color-border)] font-mono text-sm break-all select-all text-[var(--color-accent)] flex items-center justify-between">
            <span>{createdSecret}</span>
            <button
              type="button"
              onClick={() => copyText(createdSecret, "new_secret")}
              className="ml-2 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs font-mono cursor-pointer"
            >
              {copiedField === "new_secret" ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => setCreatedSecret(null)}>
              Done, I have saved it
            </Button>
          </div>
        </InlineAlert>
      )}

      {keys?.length ? (
        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[650px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-canvas)] text-xs text-[var(--color-text-muted)]">
                <th className="py-3.5 px-4 font-medium">Name</th>
                <th className="py-3.5 px-4 font-medium">Prefix</th>
                <th className="py-3.5 px-4 font-medium">Status</th>
                <th className="py-3.5 px-4 font-medium">Pool</th>
                <th className="py-3.5 px-4 font-medium">Last Used</th>
                <th className="py-3.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-white/2 transition-colors">
                  <td className="py-4 px-4 font-medium text-[var(--color-text-primary)]">
                    {k.name}
                  </td>
                  <td className="py-4 px-4">
                    <CodeValue value={`${k.keyPrefix}...`} />
                  </td>
                  <td className="py-4 px-4">
                    <Badge variant={k.enabled && !k.revokedAt ? "success" : "danger"}>
                      {k.revokedAt ? "Revoked" : k.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="py-4 px-4 font-mono text-xs text-[var(--color-text-secondary)]">
                    {k.poolId}
                  </td>
                  <td className="py-4 px-4 text-xs text-[var(--color-text-muted)]">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!k.revokedAt && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={revokeKey.isPending && revokeKey.variables === k.id}
                          onClick={async () => {
                            if (window.confirm(`Revoke API key '${k.name}'? It will no longer accept requests.`)) {
                              try {
                                await revokeKey.mutateAsync(k.id);
                              } catch (err: unknown) {
                                alert(err instanceof Error ? err.message : "Failed to revoke key");
                              }
                            }
                          }}
                          title="Revoke key"
                        >
                          <Ban className="w-3.5 h-3.5 mr-1" />
                          Revoke
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        loading={deleteKey.isPending && deleteKey.variables === k.id}
                        onClick={async () => {
                          if (window.confirm(`Delete API key '${k.name}' permanently?`)) {
                            try {
                              await deleteKey.mutateAsync(k.id);
                            } catch (err: unknown) {
                              alert(err instanceof Error ? err.message : "Failed to delete key");
                            }
                          }
                        }}
                        title="Delete API key"
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
          title="No Proxy API Keys"
          description="Generate an API key to allow external tools and agents to make chat completion requests."
          action={
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" />
              Generate Key
            </Button>
          }
        />
      ) : null}

      {/* Generate Key Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Generate Proxy API Key"
        description="Creates a high-entropy secret token (`sk-proxy-...`). You will only see the full secret once."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              loading={createKey.isPending}
            >
              Generate
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Key Identifier / App Name"
            placeholder="e.g. Dify Production, OpenCode Dev"
            value={keyName}
            onChange={setKeyName}
            required
          />
        </div>
      </Modal>
    </div>
  );
}
