import { useEffect, useState, type FormEvent } from "react";
import { useAsync } from "../hooks";
import { resources, type WindowKey } from "../resources";
import { PageTitle, LoadingState, ErrorState, EmptyState } from "../components/ui";
import { NeedList } from "../components/NeedList";

const WINDOWS: Array<{ key: WindowKey; label: string }> = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

export function NeedsPage() {
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("score");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const needs = useAsync(
    () =>
      resources.listNeeds({
        window: windowKey,
        search: search || undefined,
        platform: platform || undefined,
        status: status || undefined,
        sort,
        page,
        pageSize,
      }),
    [windowKey, search, platform, status, sort, page, pageSize]
  );

  useEffect(() => {
    setPage(1);
  }, [search, platform, status, windowKey, sort]);

  const totalPages = Math.max(1, Math.ceil((needs.data?.total ?? 0) / pageSize));
  const hasFilters = search || platform || status;

  return (
    <div className="page">
      <div className="page-head">
        <PageTitle>Needs</PageTitle>
      </div>

      <div className="toolbar" aria-label="Needs filters">
        <div className="segmented" role="tablist" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              role="tab"
              aria-selected={windowKey === w.key}
              className={`segmented-btn${windowKey === w.key ? " segmented-btn-active" : ""}`}
              onClick={() => setWindowKey(w.key)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="field field-inline">
          <label htmlFor="needs-search">Search</label>
          <input
            id="needs-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search needs"
          />
        </div>
        <div className="field field-inline">
          <label htmlFor="needs-platform">Platform</label>
          <select
            id="needs-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="">All</option>
            <option value="x">X</option>
            <option value="reddit">Reddit</option>
          </select>
        </div>
        <div className="field field-inline">
          <label htmlFor="needs-status">Status</label>
          <select
            id="needs-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="won">Won</option>
            <option value="ignored">Ignored</option>
          </select>
        </div>
        <div className="field field-inline">
          <label htmlFor="needs-sort">Sort</label>
          <select id="needs-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="score">Score</option>
            <option value="newest">Newest</option>
            <option value="title">Title</option>
          </select>
        </div>
      </div>

      <div className="results-meta" aria-live="polite">
        {needs.loading ? (
          <span>Loading…</span>
        ) : (
          <span>
            {needs.data?.total ?? 0} need{(needs.data?.total ?? 0) === 1 ? "" : "s"}
            {windowKey === "24h" ? " in last 24 hours" : windowKey === "7d" ? " in last 7 days" : " in last 30 days"}
          </span>
        )}
      </div>

      <div data-testid="needs-list">
        {needs.loading ? (
          <LoadingState />
        ) : needs.error ? (
          <ErrorState message={needs.error} onRetry={needs.reload} />
        ) : (needs.data?.needs.length ?? 0) === 0 ? (
          <EmptyState
            title={hasFilters ? "No needs match your filters" : "No needs yet"}
            message={
              hasFilters
                ? "Try clearing a filter or widening the time window."
                : "Ingest a source snapshot to surface demand signals."
            }
          />
        ) : (
          <NeedList needs={needs.data!.needs} />
        )}
      </div>

      {totalPages > 1 && (
        <nav className="pagination" aria-label="Pagination">
          <button
            type="button"
            className="btn"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
