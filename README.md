# Deploy Doctor

Deploy Doctor reproduces repository failures in a constrained runner, records append-only evidence, and produces an auditable diagnosis. It never writes to `main`; its GitHub adapter creates a review branch and draft pull request only after explicit approval.

Production control plane: https://ruozhu-deploy-doctor.lambdfefoazis.chatgpt.site

The repository now includes a deployable PostgreSQL-backed control plane and a separate durable worker. The hosted URL may lag the repository release; use `/api/health` and the event stream to verify whether a specific deployment has an active worker before relying on it.

## Current vertical slice

- Detects Next.js, Node.js, Python, and Docker repositories.
- Includes a standalone Go 1.23 log normalizer/diagnoser with race-tested CI and JSON CLI output.
- Runs only allow-listed diagnostic commands without a shell.
- Persists jobs, accounts, sessions, fixes, and append-only events in PostgreSQL; SQLite WAL remains the zero-configuration local test mode.
- Atomically claims queued jobs with PostgreSQL `FOR UPDATE SKIP LOCKED`, leases crashed work for recovery, and keeps the Docker socket out of the web container.
- Records real logs, exit codes, failed steps, cancellation, and timeouts.
- Redacts common tokens, credentials, authorization headers, and database passwords before persistence.
- Exposes environment-variable names and configured/missing state, never values.
- Lists authorized GitHub repositories with only review-safe metadata.
- Provides HTTP APIs and a usable review dashboard.
- Enforces owner-scoped job reads.
- Stores proposed fixes separately and requires an explicit approval API call before publishing a non-`main` review branch and draft PR.
- Applies every proposed unified diff to an isolated checkout copy and reruns detected checks before it can enter the approval queue.

## Run

Requires Node.js 22.5+ (for built-in SQLite).

```bash
npm test
npm start
```

For the useful multi-process stack, set a non-default `POSTGRES_PASSWORD` and run `docker compose up --build`. Open `http://localhost:3000`, register an account, and submit a public GitHub `owner/repo`. The web process persists the request; the worker clones it and records every step in the event stream.

## Security boundaries

The runner clones only validated GitHub `owner/repo` identifiers into a disposable workspace volume. Production refuses to execute without Docker isolation; the sandbox disables network, uses a read-only container root, drops capabilities, and limits CPU, memory, PIDs and time. The repository workspace is writable because real tests and builds create artifacts, but it is disposable and never mounted into the web process. Mounting the Docker socket gives the worker host-level authority: deploy it only on a dedicated runner host, never beside unrelated workloads. Per-user GitHub OAuth is still required before public multi-tenant use; the current token integration is appropriate only for a single trusted operator.

For lockfile-based Node.js repositories, dependency installation runs once with `npm ci --ignore-scripts` and outbound network access, then all project-owned test/lint/build scripts run with networking disabled. This prevents lifecycle scripts during installation but does not make untrusted dependencies risk-free; the dedicated runner boundary remains mandatory.

## API

- `POST /api/jobs` — queue a diagnosis.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` — account session lifecycle.
- `GET /api/jobs` — list the current user's jobs.
- `GET /api/jobs/:id` — inspect a job.
- `GET /api/jobs/:id/events` — inspect its audit trail.
- `POST /api/jobs/:id/cancel` — cancel queued/running work.
- `POST /api/jobs/:id` with `action=propose-fix` — persist a reviewable patch.
- `POST /api/fixes/:id/approve` — after explicit approval, create a review branch and draft PR.
- `GET /api/health` — service and integration status.
- `GET /api/repositories` — list repositories visible to the configured GitHub authorization.

No sample customers, revenue, success rates, or fabricated production claims are included.

`fixtures/failing-node` is an explicitly labeled deterministic failure repository. The end-to-end suite executes it as a real process and verifies the diagnosis points to the exact emitted log line.
