import { useState } from "react";
import { setStoredAdminSecret, apiFetch } from "../api/client.js";
import { Lock, ArrowRight, AlertCircle } from "lucide-react";

export function LoginPage({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Enter your password.");
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
      setError(err instanceof Error ? err.message : "Incorrect password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#090a0f] p-4 text-[var(--color-text-primary)]">
      <div className="w-full max-w-md bg-[#11131a] border border-[#242838] rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">Ollama Proxy Admin</h1>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-neutral-300" htmlFor="admin-password">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#0c0d12] border border-[#242838] rounded-xl text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-[var(--color-accent)] font-mono"
              autoFocus
            />
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
                <span>Sign In</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
