import { useEffect, type ReactNode } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NeedsPage } from "./pages/NeedsPage";
import { NeedDetailPage } from "./pages/NeedDetailPage";
import { SourcesPage } from "./pages/SourcesPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuditPage } from "./pages/AuditPage";

function TitleUpdater({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="state state-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>Checking session…</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <AppShell>{children}</AppShell>;
}

function ShellRoute({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <TitleUpdater title={`${title} · SaaS Demand Radar`} />
      <RequireAuth>{children}</RequireAuth>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TitleUpdater title="SaaS Demand Radar" />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ShellRoute title="Dashboard"><DashboardPage /></ShellRoute>} />
          <Route path="/needs" element={<ShellRoute title="Needs"><NeedsPage /></ShellRoute>} />
          <Route path="/needs/:id" element={<ShellRoute title="Need detail"><NeedDetailPage /></ShellRoute>} />
          <Route path="/sources" element={<ShellRoute title="Source runs"><SourcesPage /></ShellRoute>} />
          <Route path="/feedback" element={<ShellRoute title="Feedback learning"><FeedbackPage /></ShellRoute>} />
          <Route path="/settings" element={<ShellRoute title="Team settings"><SettingsPage /></ShellRoute>} />
          <Route path="/audit" element={<ShellRoute title="Audit trail"><AuditPage /></ShellRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
