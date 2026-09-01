import { useState, type FormEvent } from "react";
import { useAsync } from "../hooks";
import { resources } from "../resources";
import { PageTitle, LoadingState, ErrorState, Badge } from "../components/ui";

export function SettingsPage() {
  const team = useAsync(() => resources.team(), []);
  const schedule = useAsync(() => resources.getSchedule(), []);

  return (
    <div className="page">
      <PageTitle>Team settings</PageTitle>
      <div data-testid="team-settings">
        <section className="card" aria-label="Team members">
          <div className="card-head">
            <h2>Team members</h2>
          </div>
          {team.loading ? (
            <LoadingState />
          ) : team.error ? (
            <ErrorState message={team.error} onRetry={team.reload} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {team.data!.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="muted">{m.email}</td>
                    <td>
                      <Badge tone={m.role === "admin" ? "info" : "neutral"}>{m.role}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <ScheduleCard schedule={schedule} />
      </div>
    </div>
  );
}

function ScheduleCard({
  schedule,
}: {
  schedule: ReturnType<typeof useAsync<{ enabled: boolean; cron: string | null; timezone: string }>>;
}) {
  const [enabled, setEnabled] = useState(false);
  const [cron, setCron] = useState("0 6 * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (schedule.loading) return null;
  if (schedule.error) return null;
  const data = schedule.data!;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await resources.putSchedule({ enabled, cron: enabled ? cron : undefined, timezone });
      setMessage("Schedule updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Ingestion schedule">
      <div className="card-head">
        <h2>Ingestion schedule</h2>
      </div>
      <form className="stack" onSubmit={onSave}>
        <label className="check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable scheduled ingestion
        </label>
        {enabled && (
          <>
            <div className="field">
              <label htmlFor="cron">Cron expression</label>
              <input
                id="cron"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 6 * * *"
              />
            </div>
            <div className="field">
              <label htmlFor="tz">Timezone</label>
              <input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
          </>
        )}
        {!enabled && (
          <p className="muted">
            Current setting: {data.enabled ? `enabled (${data.cron})` : "disabled"}
          </p>
        )}
        {error && (
          <div className="state state-error" role="alert">
            <p>{error}</p>
          </div>
        )}
        {message && (
          <div className="state state-success" role="status">
            <p>{message}</p>
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save schedule"}
        </button>
      </form>
    </section>
  );
}
