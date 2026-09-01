# SaaS Demand Radar - DeepSeek V4 Flash Vision implementation

This repository is the DeepSeek V4 Flash Vision implementation from a controlled model
comparison. It is published as a standalone source artifact. It does not include model
transcripts, credentials, local databases, recordings, build output, or operator workspace
paths.

Discover which SaaS products people currently want from public X and Reddit
conversations. The system ingests public source records, detects explicit buying
intent, tool requests, workarounds, price complaints and operational pain,
groups the evidence into ranked SaaS needs, and lets a team review and learn
from that evidence.

This is a monorepo of three npm workspaces:

- `web` — React + TypeScript single-page app (Vite), served on `http://127.0.0.1:4173`.
- `server` — Node + TypeScript API (Express), served on `http://127.0.0.1:4174`.
- `e2e` — Playwright end-to-end browser tests for the main flows.

Data is persisted in SQLite (with migrations) so it survives restarts.

## Quick start

```bash
npm install          # install all workspaces (allowed build scripts are pre-approved)
npm run db:migrate   # create the schema and seed the deterministic demo users
npm run build        # build the web bundle
npm start            # migrate + build + run API (4174) and web (4173) together
```

Or run the two halves separately in two terminals:

```bash
npm run api          # API only, on http://127.0.0.1:4174
npm run web:dev      # Vite dev server, on http://127.0.0.1:4173 (proxies /api to 4174)
```

`npm run setup` is a single command that installs deps, migrates, and builds.

Sign in with one of the seeded accounts:

| Email            | Password          | Role   | Workspace |
| ---------------- | ----------------- | ------ | --------- |
| `admin@acme.test`  | `AcmeAdmin!2026`  | Admin  | Acme      |
| `member@acme.test` | `AcmeMember!2026` | Member | Acme      |
| `admin@beta.test`  | `BetaAdmin!2026`  | Admin  | Beta      |

The first two accounts share the `Acme` workspace. The third belongs to `Beta`,
which is isolated from `Acme` — no workspace can read or mutate another
workspace's data.

## Architecture

```
┌─────────────┐        ┌──────────────────────────┐        ┌───────────────┐
│ React SPA   │ ─/api─▶│ Express API                │ ─────▶│ SQLite (WAL) │
│ web:4173    │        │ server:4174                │        │ + migrations │
└─────────────┘        │  auth (HTTP-only cookie)   │        └───────────────┘
                       │  ingest adapters           │
                       │  detection + need grouping │
                       │  scoring/ranking + versions│
                       │  feedback learning         │
                       │  settings + audit          │
                       └──────────────────────────────┘
```

- **Web**: React Router with an `AuthProvider`. Every page is guarded by
  `RequireAuth` and renders inside an `AppShell` with primary navigation.
- **API**: Express with cookie-based sessions. Requests are authenticated via a
  DB-backed, HTTP-only session cookie (`sdr_session`). Tenant isolation is
  enforced by scoping every query to the caller's `workspace_id`.
- **Ingestion**: The `snapshot` adapter ingests a deterministic JSON payload
  without external credentials. The `x` and `reddit` adapters are
  replaceable/movement points where live credentials can be wired in later.
- **Detection**: Rule-based phrase matching classifies signals, then topic
  keyword clustering groups records into needs. Ingestion is idempotent.
- **Ranking**: A weighted score (frequency, recency, intent, engagement,
  cross-source diversity) ranks needs. A versioned model tracks the weights and
  what feedback caused each change.

### Web routes

The acceptance contract expects these fixed web routes and stable
`data-testid` hooks (all present in the app):

- `/login` → `login-form`
- `/` → `dashboard` (and the shell has `app-shell`)
- `/needs` → `needs-list`
- `/needs/:id` → `need-detail`
- `/sources` → `source-runs`
- `/feedback` → `feedback-learning`
- `/settings` → `team-settings`
- `/audit` → `audit-trail`

### API routes

The following routes are the fixed interoperability contract:

- `GET /api/health` → `{ "status": "ok" }`
- `POST /api/auth/login` (`{ email, password }`) → creates the HTTP-only session cookie
- `POST /api/auth/logout` → ends the session
- `GET /api/auth/me` → the signed-in user and workspace
- `POST /api/sources/ingest` (`{ adapter, records }`) → source-run summary
- `GET /api/source-runs` → visible ingestion history
- `GET /api/needs` (query: `window`, `search`, `platform`, `status`, `sort`, `page`, `pageSize`)
- `GET /api/needs/:id` → need, evidence, score explanation, trend, feedback history
- `POST /api/needs/:id/feedback` (`{ relevant, willingnessToPay, contacted, note }`)
- `POST /api/ranking/rescore` → new ranking-model version + changed ranks/scores
- `GET /api/ranking/versions` → version history and feedback provenance
- `GET/PUT /api/settings/schedule` → read / update the ingestion schedule
- `GET /api/audit` → workspace-scoped audit events

## Data model

Defined in `server/src/db/index.ts` migrations:

- `workspaces` — tenant root.
- `users` — members with a hashed password and an `admin`/`member` role, scoped to a workspace.
- `sessions` — session tokens (hashed) with an expiry.
- `source_runs` — each ingestion attempt: adapter, status, counts, error, trigger.
- `source_records` — one public record (platform, external id, url, author, published_at, text, engagement counters). Unique per `(workspace, platform, external_id)`.
- `phrases` — detected signal labels/phrases with a learned weight.
- `demand_signals` — which recorded phrase fired for which source record.
- `needs` — grouped demand signals with a title, summary and status (`open`, `in_progress`, `won`, `ignored`).
- `need_evidence` — which source records support a need.
- `feedback` — reviewer marks (`relevant`, `willingness_to_pay`, `contacted`, `note`) at the need or evidence level.
- `ranking_model_versions` — versioned model weights, creator, note and triggering feedback.
- `ranking_active` — the currently effective model weights.
- `ranking_changes` — per-need score/rank deltas for each version.
- `workspace_settings` — scheduled-ingestion config per workspace.
- `audit_logs` — workspace-scoped audit trail of actions.

## Environment variables

| Variable          | Default                  | Purpose                                                      |
| ----------------- | ------------------------ | ------------------------------------------------------------ |
| `PORT`            | `4174`                   | API listen port.                                             |
| `DATABASE_PATH`   | `server/data/demand-radar.db` | SQLite file location. Use `:memory:` for tests.         |
| `SESSION_TTL_MS`  | 7 days                   | Lifetime of the session cookie.                              |
| `REFERENCE_TIME`  | unset                    | Anchors the "now" used for windowing/recency so historical snapshots produce stable windows (used by e2e/tests). When unset the newest source record in the workspace anchors the clock. |
| `NODE_ENV` / `IS_TEST` | unset               | Marks the API as running in a test context.                  |

Secrets are never sent to the browser. The session cookie is HTTP-only,
`SameSite=Lax`, and marked `Secure` when `NODE_ENV=production`.

## Source adapter limits

- **snapshot** — deterministic, no credentials. Accepts a JSON array of records
  (`platform`, `externalId`, `url`, `author`, `publishedAt`, `text`,
  `engagement`). This is what the deterministic tests and the sample data use.
- **x** — live adapter. Requires Twitter/X API credentials and rate-limit-aware
  fetching. Not enabled without credentials.
- **reddit** — live adapter. Requires a Reddit API client id/secret. Not enabled
  without credentials.

Live adapters are intentionally replaceable so real credentials can be added
without changing the ingestion contract or the core detection/ranking pipeline.
The supplied `source-snapshot.json` keeps all deterministic behavior testable
without a paid service.

## Learning behavior

1. A reviewer opens a need detail page and marks evidence (or a whole need) as
   **relevant / irrelevant**, optionally flagging **willingness to pay** or a
   **contacted lead**.
2. Feedback is persisted per workspace and shown in the need's feedback history.
3. `POST /api/ranking/rescore` reads the accumulated feedback and re-derives the
   phrase/platform weights, creates a new `ranking_model_versions` row, and
   records the per-need score/rank changes (`ranking_changes`).
4. The actives weights change, so future rankings reflect the reviewer's
   judgments when the evidence supports it.
5. `GET /api/ranking/versions` exposes version history, when it changed, who/what
   triggered it, and the feedback provenance.

## Scheduled ingestion, settings and audit

- `GET/PUT /api/settings/schedule` reads and updates the ingestion schedule
  (enabled flag, cron expression, timezone). Only admins may update it.
- `GET /api/source-runs` shows run history plus last success, error details and
  retry behavior.
- `GET /api/audit` returns the workspace-scoped audit trail (sign-in, ingestion,
  rescore, feedback, settings changes).

## Responsive and accessibility behavior

- The interface is responsive for **390 × 844** (mobile) and **1440 × 900**
  (desktop). On mobile the navigation wraps, the tables scroll internally, and
  touch targets are at least **44px** high. There is no horizontal overflow on
  the primary surfaces.
- Accessibility: keyboard-operable controls, visible `:focus-visible` outlines,
  associated `<label>`s, landmarks (`<main>`, `<nav>`), useful `document.title`
  per route, and sufficient contrast.

## Testing

Run everything:

```bash
npm test             # API tests + e2e browser tests
```

Individual suites:

```bash
npm run test:api     # server unit/integration tests (Vitest + supertest, in-memory DB)
npm run test:e2e     # Playwright browser tests (starts API + web automatically)
npm run build        # type-check + build the web bundle
```

### API tests (`server/test`)

Deterministic, in-memory SQLite. They cover auth/session, tenant isolation,
idempotent ingestion, need listing/filtering/detail, feedback + rescore,
settings/roles, audit and rate limiting.

### e2e tests (`e2e/tests`)

Playwright boots the API on a throw-away database (reference time fixed for
determinism) plus the web app, seeds the deterministic snapshot in
`global-setup`, and then runs the UI. Coverage includes:

- sign in and the overview dashboard
- the required `data-testid` hooks across all routes
- the needs list (platform filter, search), and the need detail page
- source snapshot ingestion from the UI
- evidence feedback + re-score + ranking-model version
- page titles, landmarks, labels and keyboard focus
- 390 × 844 mobile: no horizontal overflow and ≥44px touch targets

The e2e suite runs serially with a single worker so mutations (ingestion,
feedback, rescore) stay deterministic. Each run starts from a fresh database.

## Lint / format

```bash
npm run lint
```
