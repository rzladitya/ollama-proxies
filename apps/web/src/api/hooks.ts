import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client.js";

// ── Types ──

export interface UpstreamAccount {
  id: string;
  name: string;
  tier: "free" | "pro" | "max" | "team";
  maxConcurrency?: number | null;
  enabled: boolean;
  state: "ACTIVE" | "DEGRADED" | "COOLDOWN" | "INVALID" | "DISABLED";
  priority: number;
  weight: number;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountPool {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelItem {
  id: string;
  publicModelId: string;
  upstreamModelId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  enabled: boolean;
  poolId: string;
  rpmLimit: number | null;
  concurrencyLimit: number | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface RequestLog {
  requestId: string;
  timestamp: string;
  proxyApiKeyId: string | null;
  publicModelId: string | null;
  routingKeyHash: string | null;
  leaseHit: boolean | null;
  initialAccountId: string | null;
  finalAccountId: string | null;
  attemptCount: number;
  failoverCount: number;
  stream: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  ttfbMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCategory: string | null;
  errorCode: string | null;
}

export interface RoutingConfig {
  stickyEnabled: boolean;
  leaseTtlSeconds: number;
  extendLeaseOnSuccess: boolean;
  maxAttempts: number;
  rateLimitCooldownSeconds: number;
  transientFailureCooldownSeconds: number;
  transientFailureThreshold: number;
  selection: string;
}

// ── Tasks 089: Accounts hooks ──

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<UpstreamAccount[]>("/api/admin/accounts"),
    refetchInterval: 10_000,
  });
}

export function useAccount(id?: string) {
  return useQuery({
    queryKey: ["account", id],
    queryFn: () => apiFetch<UpstreamAccount>(`/api/admin/accounts/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; apiKey: string; tier?: "free" | "pro" | "max" | "team"; maxConcurrency?: number; priority?: number; weight?: number; poolId?: string }) =>
      apiFetch<UpstreamAccount>("/api/admin/accounts", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useUpdateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<{ name: string; apiKey: string; priority: number; weight: number }>) =>
      apiFetch<UpstreamAccount>(`/api/admin/accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["account", id] });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/admin/accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useTestApiKey() {
  return useMutation({
    mutationFn: (apiKey: string) =>
      apiFetch<{ success: boolean; modelCount?: number; models?: string[]; latencyMs: number; error?: string }>(
        "/api/admin/accounts/test-key",
        {
          method: "POST",
          body: JSON.stringify({ apiKey }),
        },
      ),
  });
}

export function useTestAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean; modelCount?: number; latencyMs: number; error?: string }>(
        `/api/admin/accounts/${id}/test`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useToggleAccountState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      apiFetch<{ success: boolean }>(`/api/admin/accounts/${id}/${enable ? "enable" : "disable"}`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

// ── Tasks 090: Models hooks ──

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => apiFetch<ModelItem[]>("/api/admin/models"),
  });
}

export function useRefreshModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch<{ success: boolean; totalModels: number; newModels: number }>(
        `/api/admin/accounts/${accountId}/refresh-models`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useToggleModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch<ModelItem>(`/api/admin/models/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["models"] }),
  });
}

export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/admin/models/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["models"] }),
  });
}

export function useTestModel() {
  return useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt?: string }) =>
      apiFetch<{
        success: boolean;
        latencyMs: number;
        response?: string;
        accountName?: string;
        error?: string;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      }>(`/api/admin/models/${id}/test`, {
        method: "POST",
        body: JSON.stringify({ prompt }),
      }),
  });
}

// ── Tasks 091: API Keys hooks ──

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: () => apiFetch<ProxyApiKey[]>("/api/admin/api-keys"),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; poolId?: string; rpmLimit?: number; concurrencyLimit?: number; allowedModels?: string[] }) =>
      apiFetch<{ id: string; name: string; keyPrefix: string; secret: string; poolId: string }>(
        "/api/admin/api-keys",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/admin/api-keys/${id}/revoke`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/admin/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

// ── Tasks 092: Requests hooks ──

export function useRequests(params?: { limit?: number; offset?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.offset) query.set("offset", String(params.offset));
  const qs = query.toString();

  return useQuery({
    queryKey: ["requests", params],
    queryFn: () => apiFetch<RequestLog[]>(`/api/admin/requests${qs ? `?${qs}` : ""}`),
    refetchInterval: 5_000,
  });
}

export function useRequestDetail(id?: string) {
  return useQuery({
    queryKey: ["request", id],
    queryFn: () => apiFetch<RequestLog>(`/api/admin/requests/${id}`),
    enabled: Boolean(id),
  });
}

export function useClearRequests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>("/api/admin/requests", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });
}

export interface AccountQuotaModel {
  modelId: string;
  name: string;
  used: number;
  limit: number;
  remaining: number;
  remainingPercent: number;
  status: "healthy" | "warning" | "exhausted";
}

export interface QuotaPeriod {
  used: number;
  limit: number;
  remaining: number;
  remainingPercent: number;
  resetText: string;
}

export interface AccountQuotaItem {
  accountId: string;
  accountName: string;
  email: string;
  enabled: boolean;
  state: "ACTIVE" | "DEGRADED" | "COOLDOWN" | "INVALID" | "DISABLED";
  tier: "free" | "pro";
  session: QuotaPeriod;
  weekly: QuotaPeriod;
  models: AccountQuotaModel[];
}

export function useQuotaTracker() {
  return useQuery({
    queryKey: ["quota-tracker"],
    queryFn: () =>
      apiFetch<{
        accounts: AccountQuotaItem[];
      }>("/api/admin/quota"),
    refetchInterval: 10_000,
  });
}

export interface ModelUsageGroup {
  model: string;
  provider: string;
  requests: number;
  lastUsed: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  inputCost: number;
  cachedCost: number;
  outputCost: number;
  totalCost: number;
}

export interface AnalyticsData {
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCost: string;
  isStreamingActive?: boolean;
  modelUsageList?: ModelUsageGroup[];
  recentRequests: Array<{
    requestId: string;
    timestamp: string;
    publicModelId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    statusCode: number | null;
  }>;
  timeline: Array<{ time: string; tokens: number }>;
}

export function useAnalytics(range: "today" | "24h" | "7d" | "30d" | "60d" = "today") {
  return useQuery({
    queryKey: ["analytics", range],
    queryFn: () => apiFetch<AnalyticsData>(`/api/admin/analytics?range=${range}`),
    refetchInterval: 1_000,
  });
}

// ── Tasks 093: Routing hooks ──

export function useRoutingConfig() {
  return useQuery({
    queryKey: ["routing-config"],
    queryFn: () => apiFetch<RoutingConfig>("/api/admin/routing"),
  });
}

export function useUpdateRoutingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<RoutingConfig>) =>
      apiFetch<RoutingConfig>("/api/admin/routing", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routing-config"] }),
  });
}

// ── Tasks 094: Settings & Pools & Status hooks ──

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Record<string, unknown>>("/api/admin/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<{ success: boolean }>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}

export function usePools() {
  return useQuery({
    queryKey: ["pools"],
    queryFn: () => apiFetch<AccountPool[]>("/api/admin/pools"),
  });
}

export function useCreatePool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiFetch<AccountPool>("/api/admin/pools", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pools"] }),
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"],
    queryFn: async () => {
      try {
        const live = await fetch("/health/live").then((r) => r.json());
        const ready = await fetch("/health/ready").then((r) => r.json());
        return { live: live.status === "ok", ready: ready.status === "ok" };
      } catch {
        return { live: false, ready: false };
      }
    },
    refetchInterval: 10_000,
  });
}
