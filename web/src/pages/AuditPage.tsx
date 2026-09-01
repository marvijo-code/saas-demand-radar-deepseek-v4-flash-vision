import { useAsync } from "../hooks";
import { resources } from "../resources";
import { PageTitle, LoadingState, ErrorState, EmptyState, Badge } from "../components/ui";

export function AuditPage() {
  const audit = useAsync(() => resources.audit(), []);

  return (
    <div className="page">
      <PageTitle>Audit trail</PageTitle>
      <div data-testid="audit-trail">
        <section className="card" aria-label="Audit events">
          {audit.loading ? (
            <LoadingState />
          ) : audit.error ? (
            <ErrorState message={audit.error} onRetry={audit.reload} />
          ) : (audit.data?.events.length ?? 0) === 0 ? (
            <EmptyState title="No audit events" message="Actions in this workspace will appear here." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>By</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.data!.events.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{e.created_at}</td>
                    <td>
                      <Badge tone="info">{e.action}</Badge>
                    </td>
                    <td className="muted">
                      {e.entity_type
                        ? `${e.entity_type}${e.entity_id ? ` #${e.entity_id}` : ""}`
                        : "—"}
                    </td>
                    <td className="muted">{e.user_email ?? "system"}</td>
                    <td className="muted">{e.details ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
