import { NavLink, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/needs", label: "Needs" },
  { to: "/sources", label: "Sources" },
  { to: "/feedback", label: "Feedback" },
  { to: "/settings", label: "Settings" },
  { to: "/audit", label: "Audit" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initials =
    user?.name
      ?.split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("") ?? "?";

  return (
    <div data-testid="app-shell" className="app-shell">
      <header className="app-header">
        <div className="brand" aria-label="SaaS Demand Radar">
          <span className="brand-mark" aria-hidden="true">◈</span>
          <span className="brand-name">SaaS Demand Radar</span>
        </div>
        <nav aria-label="Primary" className="app-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-link${isActive ? " nav-link-active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-user">
          {user && (
            <span className="user-chip" title={user.email}>
              <span className="user-avatar" aria-hidden="true">{initials}</span>
              <span className="user-name">
                {user.name}
                <span className="user-role"> · {user.role}</span>
              </span>
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main" aria-label="Main content">
        {children}
      </main>
    </div>
  );
}
