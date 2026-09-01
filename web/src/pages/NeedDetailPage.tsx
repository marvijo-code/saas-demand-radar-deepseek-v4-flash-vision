import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAsync } from "../hooks";
import { resources, type WindowKey, type Evidence } from "../resources";
import { PageTitle, LoadingState, ErrorState, Badge } from "../components/ui";
import { statusLabel } from "../components/NeedList";

const WINDOW_LABEL: Record<WindowKey, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export function NeedDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const detail = useAsync(() => resources.getNeed(id!, windowKey), [id, windowKey]);
  const [notice, setNotice] = useState<string | null>(null);

  if (detail.loading) return <LoadingState />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <ErrorState message="No need found." />;

  const d = detail.data;
  const activeIdWindow = windowKey;

  async function saveFeedback(
    evidenceId: number | null,
    body: {
      relevant?: boolean | null;
      willingnessToPay?: boolean;
      contacted?: boolean;
      note?: string;
    }
  ) {
    setNotice(null);
    try {
      await resources.postFeedback(id!, { ...body, evidenceId: evidenceId ?? undefined });
      setNotice("Feedback saved. Run a re-score to update rankings.");
      detail.reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to save feedback");
    }
  }

  return (
    <div className="page" data-testid="need-detail">
      <div className="page-head">
        <Link to="/needs" className="back-link">
          ← Back to needs
        </Link>
        <PageTitle>{d.need.title}</PageTitle>
        <Badge tone={d.need.status === "open" ? "info" : d.need.status === "won" ? "positive" : "negative"}>
          {statusLabel(d.need.status)}
        </Badge>
      </div>

      <p className="need-full-summary">{d.need.summary}</p>

      <div className="toolbar" role="tablist" aria-label="Time window">
        {(["24h", "7d", "30d"] as WindowKey[]).map((w) => (
          <button
            key={w}
            role="tab"
            aria-selected={activeIdWindow === w}
            className={`segmented-btn${activeIdWindow === w ? " segmented-btn-active" : ""}`}
            onClick={() => setWindowKey(w)}
          >
            {WINDOW_LABEL[w]}
          </button>
        ))}
      </div>

      <section className="card" aria-label="Score explanation">
        <div className="card-head">
          <h2>
            Score explanation{" "}
            <span className="score-value score-big">{d.score.total.toFixed(2)}</span>
          </h2>
        </div>
        <p className="muted">
          Weighted across {WINDOW_LABEL[activeIdWindow]} of evidence. Higher is stronger.
        </p>
        <ScoreTable components={d.score.components} />
      </section>

      <section className="card" aria-label="Trend history">
        <div className="card-head">
          <h2>Trend history</h2>
        </div>
        <div className="trend-grid">
          {d.trend.map((t) => (
            <div key={t.window} className="trend-cell">
              <span className="muted">{WINDOW_LABEL[t.window]}</span>
              <span className="trend-value">{t.score.toFixed(2)}</span>
              <span className="muted">{t.evidenceCount} evidence</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card" aria-label="Source evidence">
        <div className="card-head">
          <h2>Source evidence</h2>
        </div>
        <ul className="evidence-list">
          {d.evidence.map((ev) => (
            <EvidenceRow
              key={ev.recordId}
              ev={ev}
              onSave={saveFeedback}
            />
          ))}
        </ul>
      </section>

      <section className="card" aria-label="Feedback history">
        <div className="card-head">
          <h2>Feedback history</h2>
        </div>
        {d.feedback.length === 0 ? (
          <p className="muted">No feedback recorded yet.</p>
        ) : (
          <ul className="feedback-list">
            {d.feedback.map((f) => (
              <li key={f.id} className="feedback-row">
                <span className="badge badge-info">{f.target_type}</span>
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

      {notice && (
        <div className="state state-success toast" role="status">
          <p>{notice}</p>
        </div>
      )}
    </div>
  );
}

function ScoreTable({ components }: { components: Array<{ label: string; normalized: number; weight: number; contribution: number; detail: string }> }) {
  return (
    <table className="score-table">
      <thead>
        <tr>
          <th>Factor</th>
          <th>Weight</th>
          <th>Component</th>
          <th>Contribution</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {components.map((c) => (
          <tr key={c.label}>
            <td>{c.label}</td>
            <td>{c.weight.toFixed(2)}</td>
            <td>{c.normalized.toFixed(2)}</td>
            <td>{c.contribution.toFixed(2)}</td>
            <td className="muted">{c.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EvidenceRow({
  ev,
  onSave,
}: {
  ev: Evidence;
  onSave: (
    evidenceId: number,
    body: {
      relevant?: boolean | null;
      willingnessToPay?: boolean;
      contacted?: boolean;
      note?: string;
    }
  ) => Promise<void>;
}) {
  const [relevant, setRelevant] = useState<boolean | null>(ev.isRelevant);
  const [willing, setWilling] = useState(ev.willingnessToPay);
  const [contacted, setContacted] = useState(ev.contacted);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await onSave(ev.recordId, { relevant, willingnessToPay: willing, contacted });
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="evidence-row">
      <div className="evidence-head">
        <Badge tone={ev.platform === "x" ? "info" : "neutral"}>{ev.platform}</Badge>
        <span className="muted">@{ev.author}</span>
        <a
          href={ev.url}
          target="_blank"
          rel="noopener noreferrer"
          className="evidence-link"
        >
          View source
        </a>
        <span className="muted">{ev.publishedAt}</span>
      </div>
      <blockquote className="evidence-text">{ev.text}</blockquote>
      <div className="evidence-engagement muted">
        {ev.platform === "x"
          ? `${ev.engagement.likes} likes · ${ev.engagement.replies} replies · ${ev.engagement.reposts} reposts`
          : `${ev.engagement.upvotes} upvotes · ${ev.engagement.comments} comments`}
      </div>
      <div className="feedback-controls">
        <div className="segmented" aria-label="Relevance">
          <button
            type="button"
            className={`segmented-btn${relevant === true ? " segmented-btn-active" : ""}`}
            onClick={() => setRelevant(true)}
          >
            Relevant
          </button>
          <button
            type="button"
            className={`segmented-btn${relevant === false ? " segmented-btn-active" : ""}`}
            onClick={() => setRelevant(false)}
          >
            Irrelevant
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={willing} onChange={(e) => setWilling(e.target.checked)} />
          Willing to pay
        </label>
        <label className="check">
          <input type="checkbox" checked={contacted} onChange={(e) => setContacted(e.target.checked)} />
          Contacted lead
        </label>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save feedback"}
        </button>
      </div>
    </li>
  );
}
