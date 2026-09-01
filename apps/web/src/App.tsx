import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./components/layout/AppShell.js";
import { OverviewPage } from "./pages/Overview.js";
import { AccountsPage } from "./pages/Accounts.js";
import { ApiKeysPage } from "./pages/ApiKeys.js";
import { RequestsPage } from "./pages/Requests.js";
import { QuotaPage } from "./pages/Quota.js";
import { RoutingPage } from "./pages/Routing.js";
import { SettingsPage } from "./pages/Settings.js";
import { StatusPage } from "./pages/Status.js";
import { LoginPage } from "./pages/Login.js";
import { getStoredAdminSecret, setStoredAdminSecret, apiFetch } from "./api/client.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
    },
  },
});

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const checkAuth = async () => {
    try {
      const secret = getStoredAdminSecret();
      const res = await apiFetch<{ success: boolean }>("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ secret }),
      });
      setIsAuthenticated(res.success);
    } catch {
      setIsAuthenticated(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleLogout = () => {
    setStoredAdminSecret("");
    setIsAuthenticated(false);
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-[#090a0f] flex items-center justify-center text-neutral-400 font-mono text-xs">
        <span className="w-4 h-4 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mr-2" />
        Checking authentication...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppShell onLogout={handleLogout} />}>
            <Route index element={<OverviewPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="models" element={<Navigate to="/accounts" replace />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="quota" element={<QuotaPage />} />
            <Route path="routing" element={<RoutingPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="status" element={<StatusPage />} />
            {/* Alias /admin to / */}
            <Route path="admin/*" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
