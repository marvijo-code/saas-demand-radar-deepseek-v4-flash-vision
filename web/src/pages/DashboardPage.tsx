import { Link } from "react-router-dom";
import { useAsync } from "../hooks";
import { resources, type NeedSummary, type RunInfo } from "../resources";
import { PageTitle, LoadingState, ErrorState, EmptyState } from "../components/ui";
import { NeedList } from "../components/NeedList";

export function DashboardPage() {
  const needs = useAsync(() => resources.listNeeds({ window: "30d", pageSize: 6 }), []);
  const runs = useAsync(() => resources.sourceRuns(), []);

  if (needs.loading) return <LoadingState />;
  if (needs.error) return <ErrorState message={needs.error} onRetry={needs.reload} />;

  const topNeeds: NeedSummary[] = needs.data?.needs ?? [];
  const allRuns: RunInfo[] = runs.data?.runs ?? [];
  const totalEvidence = topNeeds.reduce((a, n) => a + n.evidenceCount, 0);
  const openNeeds = topNeeds.filter((n) => n.status === "open").length;

  return (
    <div className="page">
      <PageTitle>Dashboard</PageTitle>
      <div data-testid="dashboard">
        <div className="stat-grid">
          <Stat label="Active needs" value={String(topNeeds.length)} />
          <Stat label="Open needs" value={String(openNeeds)} />
          <Stat label="Source records" value={String(totalEvidence)} />
          <Stat label="Ingest runs" value={String(allRuns.length)} />
        </div>

        <section className="card" aria-label="Top needs">
          <div className="card-head">
            <h2>Top needs</h2>
            <Link to="/needs" className="btn btn-ghost">
              View all
            </Link>
          </div>
          {topNeeds.length === 0 ? (
            <EmptyState
              title="No demand signals yet"
              message="Ingest a source snapshot or connect an adapter to start finding needs."
            >
              <Link to="/sources" className="btn btn-primary">
                Ingest sources
              </Link>
            </EmptyState>
          ) : (
            <NeedList needs={topNeeds} />
          )}
        </section>

        <section className="card" aria-label="Recent ingestion runs">
          <div className="card-head">
            <h2>Recent runs</h2>
            <Link to="/sources" className="btn btn-ghost">
              Source runs
            </Link>
          </div>
          {allRuns.length === 0 ? (
            <p className="muted">No ingestion runs yet.</p>
          ) : (
            <ul className="run-list">
              {allRuns.slice(0, 5).map((r) => (
                <li key={r.id} className="run-row">
                  <span className="badge badge-info">{r.adapter}</span>
                  <span className={`badge ${r.status === "success" ? "badge-positive" : r.status === "failed" ? "badge-negative" : "badge-neutral"}`}>
                    {r.status}
                  </span>
                  <span className="muted">
                    {r.new_records} new of {r.records_total}
                  </span>
                  <span className="muted run-time">{r.started_at}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
