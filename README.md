# Deploy Doctor

Deploy Doctor reproduces repository failures in a constrained runner, records append-only evidence, and produces an auditable diagnosis. It never writes to `main`; its GitHub adapter creates a review branch and draft pull request only after explicit approval.

Production control plane: https://ruozhu-deploy-doctor.lambdfefoazis.chatgpt.site

The deployed control plane provides ChatGPT authentication and account-isolated D1 persistence for creating and cancelling diagnosis requests. Jobs remain visibly `waiting_for_runner` until the separate Docker isolation worker is deployed and connected; the site does not claim that queued work has executed.

## Current vertical slice

- Detects Next.js, Node.js, Python, and Docker repositories.
- Includes a standalone Go 1.23 log normalizer/diagnoser with race-tested CI and JSON CLI output.
- Runs only allow-listed diagnostic commands without a shell.
- Persists jobs, accounts, sessions, fixes, and append-only events in PostgreSQL; SQLite WAL remains the zero-configuration local test mode.
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

Open `http://localhost:3000`, enter a repository label and the absolute path of a local checkout, then run the diagnosis.

## Security boundaries

The runner clones only validated GitHub `owner/repo` identifiers into server-owned temporary directories. Production refuses to execute without Docker isolation; the sandbox disables network, uses a read-only root and repository mount, drops capabilities, and limits CPU, memory, PIDs and time. GitHub OAuth and an external job queue remain required before public production use.

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
