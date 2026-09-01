import { useState, type FormEvent } from "react";
import { useAsync } from "../hooks";
import { resources, type RunInfo } from "../resources";
import { PageTitle, LoadingState, ErrorState, EmptyState, Badge } from "../components/ui";

const SAMPLE = JSON.stringify(
  [
    {
      platform: "reddit",
      externalId: "sample-1",
      url: "https://www.reddit.com/r/SaaS/comments/sample1",
      author: "sample-user",
      publishedAt: new Date().toISOString(),
      text: "Does anyone have a tool to find prospects on Reddit? I want that work automated.",
      engagement: { upvotes: 2, comments: 3 },
    },
  ],
  null,
  2
);

export function SourcesPage() {
  const runs = useAsync(() => resources.sourceRuns(), []);
  const [payload, setPayload] = useState(SAMPLE);
  const [adapter, setAdapter] = useState("snapshot");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    let records: unknown;
    try {
      records = JSON.parse(payload);
      if (!Array.isArray(records)) throw new Error("Payload must be a JSON array");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    setBusy(true);
    try {
      const res = await resources.ingest(adapter, records as unknown[]);
      setResult(
        `Run #${res.runId}: ${res.newRecords} new records, ${res.demandSignals} signals, ${res.needs} needs.`
      );
      runs.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageTitle>Source runs</PageTitle>
      <div data-testid="source-runs">
        <section className="card" aria-label="Ingest sources">
          <div className="card-head">
            <h2>Ingest a source snapshot</h2>
          </div>
          <form className="stack" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="adapter">Adapter</label>
              <select id="adapter" value={adapter} onChange={(e) => setAdapter(e.target.value)}>
                <option value="snapshot">snapshot (deterministic, no credentials)</option>
                <option value="x">x (live, requires credentials)</option>
                <option value="reddit">reddit (live, requires credentials)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="payload">Records JSON</label>
              <textarea
                id="payload"
                rows={12}
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                spellCheck={false}
              />
            </div>
            {error && (
              <div className="state state-error" role="alert">
                <p>{error}</p>
              </div>
            )}
            {result && (
              <div className="state state-success" role="status">
                <p>{result}</p>
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Ingesting…" : "Run ingestion"}
            </button>
          </form>
        </section>

        <section className="card" aria-label="Run history">
          <div className="card-head">
            <h2>Run history</h2>
          </div>
          {runs.loading ? (
            <LoadingState />
          ) : runs.error ? (
            <ErrorState message={runs.error} onRetry={runs.reload} />
          ) : (runs.data?.runs.length ?? 0) === 0 ? (
            <EmptyState title="No runs yet" message="Run an ingestion to see history here." />
          ) : (
            <RunList runs={runs.data!.runs} />
          )}
        </section>
      </div>
    </div>
  );
}

function RunList({ runs }: { runs: RunInfo[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Adapter</th>
          <th>Status</th>
          <th>New</th>
          <th>Total</th>
          <th>Started</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td>#{r.id}</td>
            <td>{r.adapter}</td>
            <td>
              <Badge tone={r.status === "success" ? "positive" : r.status === "failed" ? "negative" : "info"}>
                {r.status}
              </Badge>
            </td>
            <td>{r.new_records}</td>
            <td>{r.records_total}</td>
            <td className="muted">{r.started_at}</td>
            <td className="muted">{r.error ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
