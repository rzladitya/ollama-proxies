import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Key,
  ListOrdered,
  GitFork,
  Settings,
  Activity,
  ShieldAlert,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { useSystemHealth } from "../../api/hooks.js";
import { getStoredAdminSecret, setStoredAdminSecret } from "../../api/client.js";
import { Modal, Input, Button } from "../ui/index.js";

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/accounts", label: "Providers", icon: Server },
  { to: "/api-keys", label: "API Keys", icon: Key },
  { to: "/requests", label: "Console Log", icon: ListOrdered },
  { to: "/quota", label: "Quota Tracker", icon: Activity },
  { to: "/routing", label: "Routing", icon: GitFork },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/status", label: "System Status", icon: ShieldAlert },
];

export function AppShell({ onLogout }: { onLogout?: () => void }) {
  const { data: health } = useSystemHealth();
  const [isSecretModalOpen, setIsSecretModalOpen] = useState(false);
  const [secretInput, setSecretInput] = useState(getStoredAdminSecret());
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const handleSaveSecret = () => {
    setStoredAdminSecret(secretInput);
    setIsSecretModalOpen(false);
    window.location.reload();
  };

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      setStoredAdminSecret("");
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
      {/* ── Mobile Top Header (hidden on md+) ── */}
      <header className="md:hidden h-14 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[var(--color-accent)] flex items-center justify-center font-bold text-black text-xs">
            OP
          </div>
          <span className="font-semibold text-sm">Ollama Proxy</span>
        </div>
        <button
          type="button"
          onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
          className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:outline-none"
          aria-label="Toggle navigation"
        >
          {isMobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* ── Backdrop for Mobile ── */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      {/* ── Sidebar (Fixed on md+, Drawer on mobile) ── */}
      <aside
        className={`w-[230px] border-r border-[var(--color-border)] flex flex-col justify-between fixed inset-y-0 left-0 bg-[var(--color-bg-surface)] z-40 transition-transform duration-200 ease-in-out md:translate-x-0 ${
          isMobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div>
          {/* Logo / Brand */}
          <div className="h-16 flex items-center justify-between px-6 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-[var(--color-accent)] flex items-center justify-center font-bold text-black text-xs">
                OP
              </div>
              <span className="font-semibold text-sm tracking-tight">Ollama Proxy</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-[var(--color-text-muted)] border border-neutral-700">
                v1.0
              </span>
            </div>
            {/* Close button inside drawer for mobile */}
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(false)}
              className="md:hidden p-1 text-[var(--color-text-muted)] hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setIsMobileNavOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)] font-semibold"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5"
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Footer Area */}
        <div className="p-3 border-t border-[var(--color-border)] space-y-2">
          {/* Admin Secret Config Button & Logout */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSecretInput(getStoredAdminSecret());
                setIsSecretModalOpen(true);
              }}
              className="flex-1 flex items-center justify-between px-3 py-2 rounded-lg text-xs text-[var(--color-text-secondary)] hover:bg-white/5 transition-colors border border-[var(--color-border)] cursor-pointer"
            >
              <div className="flex items-center gap-1.5 truncate">
                <ShieldAlert className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                <span className="truncate">Key Config</span>
              </div>
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                {getStoredAdminSecret() ? "SET" : "NONE"}
              </span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="p-2 rounded-lg border border-[var(--color-border)] text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Live indicator */}
          <div className="flex items-center justify-between px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  health?.ready
                    ? "bg-[var(--color-success)] animate-pulse"
                    : "bg-[var(--color-danger)]"
                }`}
              />
              <span>{health?.ready ? "System Ready" : "Connecting..."}</span>
            </div>
            <span className="font-mono text-[10px]">11435</span>
          </div>
        </div>
      </aside>

      {/* ── Main Content Area (Offset by 230px on md+, centered max width) ── */}
      <main className="flex-1 md:ml-[230px] p-4 sm:p-6 md:p-8 w-full min-h-screen flex justify-center">
        <div className="w-full max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* ── Admin Secret Modal ── */}
      <Modal
        isOpen={isSecretModalOpen}
        onClose={() => setIsSecretModalOpen(false)}
        title="Admin Authentication Secret"
        description="Set the OLLAMA_PROXY_ADMIN_SECRET header used for all administrative management requests."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsSecretModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSecret}>Save Key</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Admin Secret Token"
            type="password"
            value={secretInput}
            onChange={setSecretInput}
            placeholder="Enter matching OLLAMA_PROXY_ADMIN_SECRET"
            description="Stored in your browser localStorage. Leave blank if server runs without secret."
          />
        </div>
      </Modal>
    </div>
  );
}
