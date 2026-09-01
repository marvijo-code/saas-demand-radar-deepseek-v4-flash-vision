import { useState } from "react";
import { useAsync } from "../hooks";
import { resources } from "../resources";
import { PageTitle, LoadingState, ErrorState, EmptyState, Badge } from "../components/ui";

export function FeedbackPage() {
  const feedback = useAsync(() => resources.feedback(), []);
  const versions = useAsync(() => resources.rankingVersions(), []);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rescore() {
    setMessage(null);
    setBusy(true);
    try {
      const r = await resources.rescore("Re-scored from feedback learning");
      setMessage(
        `Saved ranking model v${r.version}. ${r.changedCount} need${r.changedCount === 1 ? "" : "s"} changed.`
      );
      versions.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Re-score failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageTitle>Feedback learning</PageTitle>
      <div data-testid="feedback-learning">
        {message && (
          <div className={`state ${message.startsWith("Saved") ? "state-success" : "state-error"}`} role="status">
            <p>{message}</p>
          </div>
        )}

        <section className="card" aria-label="Learning controls">
          <div className="card-head">
            <h2>Feedback-driven ranking</h2>
            <button type="button" className="btn btn-primary" onClick={rescore} disabled={busy}>
              {busy ? "Re-scoring…" : "Re-score model"}
            </button>
          </div>
          <p className="muted">
            When reviewers mark signals irrelevant or record willingness to pay /
            contacted leads, the ranking model re-weights those phrases and sources.
            Re-score to publish a new versioned model.
          </p>
        </section>

        <section className="card" aria-label="Feedback records">
          <div className="card-head">
            <h2>Recent feedback</h2>
          </div>
          {feedback.loading ? (
            <LoadingState />
          ) : feedback.error ? (
            <ErrorState message={feedback.error} onRetry={feedback.reload} />
          ) : (feedback.data?.feedback.length ?? 0) === 0 ? (
            <EmptyState title="No feedback yet" message="Mark evidence as relevant or irrelevant from a need detail page." />
          ) : (
            <ul className="feedback-list">
              {feedback.data!.feedback.map((f) => (
                <li key={f.id} className="feedback-row">
                  <span className="badge badge-info">{f.target_type}</span>
                  {f.need_title && <strong>{f.need_title}</strong>}
                  <span>
                    {f.relevant === null ? "No relevance" : f.relevant ? "Relevant" : "Irrelevant"}
                  </span>
                  {!!f.willingness_to_pay && <Badge tone="positive">Willing to pay</Badge>}
                  {!!f.contacted && <Badge tone="info">Contacted lead</Badge>}
                  {f.note && <p className="muted">{f.note}</p>}
                  <span className="muted">
                    {f.created_by_email ?? "unknown"} · {f.created_at}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-label="Ranking model versions">
          <div className="card-head">
            <h2>Ranking model versions</h2>
          </div>
          {versions.loading ? (
            <LoadingState />
          ) : versions.error ? (
            <ErrorState message={versions.error} onRetry={versions.reload} />
          ) : (versions.data?.versions.length ?? 0) === 0 ? (
            <EmptyState title="No versioned models yet" message="Re-score to create the first versioned model." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Created</th>
                  <th>Changed</th>
                  <th>Triggered by</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {versions.data!.versions.map((v) => (
                  <tr key={v.id}>
                    <td>{v.label}</td>
                    <td className="muted">{v.created_at}</td>
                    <td>{v.change_count}</td>
                    <td className="muted">
                      {v.created_by_email ?? "system"}
                      {v.triggered_by_feedback_id ? ` (feedback #${v.triggered_by_feedback_id})` : ""}
                    </td>
                    <td className="muted">{v.note ?? "—"}</td>
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
