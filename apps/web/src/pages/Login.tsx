import { useState } from "react";
import { setStoredAdminSecret, apiFetch } from "../api/client.js";
import { Lock, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";

export function LoginPage({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Please enter your admin password");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await apiFetch<{ success: boolean }>("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ secret: password.trim() }),
      });

      setStoredAdminSecret(password.trim());
      onLoginSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Password admin salah");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#090a0f] p-4 text-[var(--color-text-primary)]">
      <div className="w-full max-w-md bg-[#11131a] border border-[#242838] rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">Ollama Proxy Admin</h1>
          <p className="text-xs text-neutral-400 font-mono">
            Masukkan Admin Secret / Password untuk masuk ke dashboard
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-neutral-300">Admin Password / Secret</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Default: ollama"
              className="w-full px-3.5 py-2.5 bg-[#0c0d12] border border-[#242838] rounded-xl text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-[var(--color-accent)] font-mono"
              autoFocus
            />
            <p className="text-[11px] text-neutral-500 font-mono">
              Default password: <code className="text-[var(--color-accent)]">ollama</code> (atau sesuai OLLAMA_PROXY_ADMIN_SECRET di .env)
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-black font-semibold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="pt-2 border-t border-[#1e2230] text-center text-[11px] text-neutral-500 font-mono flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Secured with AES-256 and Bearer Tokens</span>
        </div>
      </div>
    </div>
  );
}
