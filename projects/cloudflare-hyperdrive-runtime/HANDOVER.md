# Handover — TML-2369: Per-request facade for serverless runtimes

## TL;DR

The serverless facade is shipped, tested, reviewed, documented, and on a live PR. **Three of four milestones are complete.** What's left is one **Cloudflare-account-gated** real-world smoke test plus the project-directory close-out — no remaining design questions, no remaining code-shape questions.

- **PR:** [#421 — feat(postgres): per-request facade for serverless runtimes](https://github.com/prisma/prisma-next/pull/421)
- **Branch:** `tml-2369-ppg-add-a-hyperdrive-driver` (latest tip: `4bbb919cb`)
- **Plan:** [`plan.md`](./plan.md) — status banner at top, M4 Stream B has a step-by-step.
- **Spec + AC scoreboard:** [`spec.md`](./spec.md) (19/20 PASS), evidence in [`assets/ac-verification.md`](./assets/ac-verification.md).

## What landed

Numbers are gzipped where applicable; sources are in the plan and the AC verification doc.

- **`@prisma-next/postgres/serverless`** — new entrypoint, no driver-layer changes. Construction mirrors the Node `postgres()` factory; runtime surface intentionally narrows to `sql`/`context`/`stack`/`contract`/`connect`. `connect({ url })` returns a fresh `Runtime & AsyncDisposable` per call (no closure cache); `await using` closes the underlying `pg.Client`. 15 unit tests + 7 type tests.
- **`examples/prisma-next-cloudflare-worker/`** — deployable Worker mirroring the Node demo, less pgvector (Docker Postgres origin doesn't ship it). Runs on Docker Postgres locally via `pnpm db:up`. 8/8 integration tests via `vitest-pool-workers`. Bundle: 254 KiB gzip (1 MiB budget). Cold-start ~35 ms / warm ~13 ms (200 ms budget) — both against local Docker; production re-measure pending.
- **CI** — Worker integration tests wired into `.github/workflows/ci.yml` with a `pnpm db:up` step + the `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` env. Vitest config soft-fails when env is missing so the example doesn't break unrelated runs.
- **Docs** — [`docs/Serverless Deployment Guide.md`](../../docs/Serverless%20Deployment%20Guide.md) (linked from `docs/README.md`) + [`ADR 207 — Per-environment facade asymmetry`](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Per-environment%20facade%20asymmetry.md) (indexed under § Adapters & Targets).

## What remains — M4 Stream B

The plan's M4 section has the concrete steps; here's the high-level:

1. **`wrangler deploy` smoke (plan task 4.2)** — needs a Cloudflare account with Hyperdrive entitlement and a Postgres origin reachable from the edge (PPg, Neon, RDS, Supabase, anything that speaks Postgres). Steps:
   - Apply the example's schema to the chosen origin.
   - `pnpm exec wrangler hyperdrive create my-hyperdrive --connection-string=…`, paste the binding ID into [`examples/prisma-next-cloudflare-worker/wrangler.jsonc`](../../examples/prisma-next-cloudflare-worker/wrangler.jsonc) (currently `00000000-…`).
   - `pnpm deploy`, then `curl` each route (`/health`, `/sql/users`, `/orm/users`, `/orm/posts`, `/tx/commit`, `/tx/rollback`, `/cursor/large`).
   - Re-measure cold-start for `/orm/users?limit=10` after a 5-minute idle. Production cold-start over real Hyperdrive **will be slower** than the local 35 ms — re-evaluate against AC-20's 200 ms ceiling and document.
   - Record findings in [`assets/ac-verification.md`](./assets/ac-verification.md) under AC-12 (and AC-20 if re-measured).

2. **Close-out (plan tasks 4.5/4.6/4.7).** Once the smoke is green:
   - The deployment guide + ADR 207 already live in `docs/`; the M1 audit doc is recommended to be **dropped** rather than migrated (most evergreen content is already absorbed elsewhere — see plan task 4.5 for details).
   - `rg 'projects/cloudflare-hyperdrive-runtime' -- ':!projects/cloudflare-hyperdrive-runtime'` — replace any links with `docs/` equivalents or remove.
   - Delete `projects/cloudflare-hyperdrive-runtime/` in the final commit. PR #421's title and description already reference `TML-2369`, so Linear's GitHub integration will auto-complete the issue when this PR merges.

## Important context

- **The known-broken local case is `prisma dev` (PGlite TCP shim), not real Hyperdrive.** During M3 we found that `pg-cloudflare`'s socket layer hangs under workerd's local Hyperdrive emulator when the local origin is `prisma dev`. M1's audit empirically confirmed the path works against a real Postgres origin — that's why M3 switched to Docker Postgres and why the smoke test against real deployed Hyperdrive is expected to work. Tracking issue: [`cloudflare/workers-sdk#12984`](https://github.com/cloudflare/workers-sdk/issues/12984). The example README has a "why not `prisma dev`" callout.
- **ORM Class-Table-Inheritance is broken for `@@base + @@map` discriminator schemas.** Pre-existing bug, surfaced during M3 when implementing variant queries on `Task`. Filed separately as [TML-2377](https://linear.app/prisma-company/issue/TML-2377). Out of scope for this project; the example schema preserves the discriminator hierarchy but the Worker doesn't exercise variant-query routes.
- **Bundle workarounds** for [`cloudflare/workers-sdk#12984`](https://github.com/cloudflare/workers-sdk/issues/12984) live in [`examples/prisma-next-cloudflare-worker/vitest.config.ts`](../../examples/prisma-next-cloudflare-worker/vitest.config.ts). When that upstream issue is resolved, the `test.deps.optimizer.ssr.{include,rolldownOptions.external}` block can be deleted.
- **Open follow-up tickets** worth filing if the team agrees (none are blockers): backporting `[Symbol.asyncDispose]` to the Node `postgres()` facade; revisiting the Node facade's hardcoded `cursor: { disabled: true }`; exporting `PostgresCursorOptions` from `@prisma-next/driver-postgres/runtime` to remove the structural workaround in `postgres-serverless.ts`. Listed under "Open Items" in the plan.
- **Review state.** All review artifacts under `projects/cloudflare-hyperdrive-runtime/reviews/` are **gitignored** (project policy — review state is local working scratch). M2, M3, and M4 R1 Stream A all came back SATISFIED from the reviewer subagent; the scoreboard in `assets/ac-verification.md` reflects the m4 R1 measurements.

## Suggested first move

Read the plan's "Status (m4 R1)" banner and the M4 Stream B task list. They're written to be picked up cold without re-reading the spec or this handover.
