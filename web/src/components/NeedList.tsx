import { Link } from "react-router-dom";
import type { NeedSummary } from "../resources";
import { Badge, ScoreBar } from "./ui";

const STATUS_TONE: Record<string, "neutral" | "positive" | "negative" | "info"> = {
  open: "info",
  in_progress: "info",
  won: "positive",
  ignored: "negative",
};

export function statusLabel(status: string): string {
  return status.replace("_", " ");
}

export function NeedRow({ need }: { need: NeedSummary }) {
  const tone = STATUS_TONE[need.status] ?? "neutral";
  return (
    <li className="need-row">
      <div className="need-rank" aria-label={`Rank ${need.rank ?? "n/a"}`}>
        {need.rank ? `#${need.rank}` : "—"}
      </div>
      <div className="need-body">
        <div className="need-head">
          <Link to={`/needs/${need.id}`} className="need-title-link">
            {need.title}
          </Link>
          <Badge tone={tone}>{statusLabel(need.status)}</Badge>
        </div>
        <p className="need-summary">{need.summary}</p>
        <div className="need-meta">
          <span>{need.evidenceCount} evidence</span>
          <span>
            {need.platforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" + ") || "No platform"}
          </span>
        </div>
      </div>
      <div className="need-score">
        <span className="score-value">{need.score.toFixed(2)}</span>
        <ScoreBar total={need.score} />
      </div>
    </li>
  );
}

export function NeedList({ needs }: { needs: NeedSummary[] }) {
  if (needs.length === 0) {
    return <p className="muted">No needs to show.</p>;
  }
  return (
    <ul className="need-list" data-testid="needs-list">
      {needs.map((n) => (
        <NeedRow key={n.id} need={n} />
      ))}
    </ul>
  );
}
