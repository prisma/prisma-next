# CLI Telemetry — Project Plan

## Summary

Phase 1 ships CLI usage telemetry for Prisma Next: a Bun backend on Prisma Compute that accepts anonymous events into a Prisma Next-authored Postgres schema, and a CLI client that forks a detached subprocess at command start to deliver those events without affecting CLI UX. Phase 2 (error/crash reporting) is in scope of the spec but out of scope of this plan and ships as a separate project.

**Spec:** [`projects/cli-telemetry/spec.md`](./spec.md)

## Collaborators

| Role | Person/Team | Context |
| --- | --- | --- |
| Maker | Alexey Orlenko | Drives execution end-to-end |
| Reviewer | TBD (senior peer) | Architectural review across the client/backend split and the ADRs (216, 217) |
| Legal | TBD | Reviews the "no DPIA required" conclusion before EA launch (spec OQ2) |
| Compute Ops | TBD | Owns the Prisma Compute deploy lane and the `*.prisma.build` URL assignment |

## Shipping Strategy

Every milestone is backward-compatible and safe to deploy in isolation. The system is designed so that the presence or absence of any half does not affect the other half's user-visible behaviour.

- **M1 alone (backend deployed, no client yet)** — the backend is an idle endpoint accepting events from nobody. No user-visible effect.
- **M2 alone (client deployed, no backend yet)** — the client tries to send events, the requests fail (DNS or 5xx), the child process swallows the error and exits. The CLI's exit time and exit code are unaffected (per the strict isolation contract, spec NFR1/NFR5). No user-visible effect.
- **Realistic order: M1 → M2 → M3.** M1 ships first so M2 can integration-test against a real backend; M3 ships last to wrap docs, AC verification, and project workspace deletion.
- **Implicit gate.** There is no feature flag. Three things gate behaviour naturally:
  - **Default-off until explicit consent via the `init` prompt** gates collection. The CLI never emits telemetry without `enableTelemetry: true` having been written to the user-level config file by an affirmative answer to the init consent prompt (or a manual edit of the file). Env-var opt-outs (`PRISMA_NEXT_DISABLE_TELEMETRY`, `DO_NOT_TRACK`) override the stored preference at runtime.
  - The strict isolation contract gates backend-availability impact: telemetry failures are by construction invisible to the user.
  - The backend's wire-format backward compatibility (FR13) gates client-version skew: older clients work against newer backends and vice versa.
- **Phase 2 is a separate future project.** Error/crash reporting has different isolation needs (synchronous flush before exit) and a different sensitive-data surface; it does not land as a milestone of this plan.

## Test Design

Test cases derived from spec acceptance criteria and from non-AC sections (Security) that need verification. Each TC is assigned to the milestone whose delivery satisfies it.

Unless a TC specifically tests an opt-out path, the test fixture seeds `$XDG_CONFIG_HOME/prisma-next/config.json` with `enableTelemetry: true` (and a deterministic test `installationId`) so the telemetry path emits. Tests that exercise opt-out paths start from a fresh tempdir without the file.

| AC | TC | Test Case | Type | Milestone | Expected Outcome |
| --- | --- | --- | --- | --- | --- |
| AC1 | TC-1 | Fresh machine (clean tempdir as `XDG_CONFIG_HOME`): (a) `prisma-next --help` emits no event and writes no `config.json`; (b) `prisma-next init` interactively + answer yes creates `config.json` with `enableTelemetry: true` + `installationId`, and emits one event; (c) follow-up CLI run reuses the same `installationId` | Integration | M2 | After (a): no `config.json`, backend row count = 0. After (b): `config.json` present with both fields, `installationId` valid v4, backend row count = 1. After (c): backend row count = 2; both rows share `installationId` |
| AC2 | TC-2 | `PRISMA_NEXT_DISABLE_TELEMETRY=1` set; on a fresh machine (i) run a non-init CLI command, and (ii) run `init` interactively — the telemetry prompt must be suppressed under the env-var override | Integration | M2 | (i) no `config.json` written, backend row count = 0; (ii) prompt is not shown, `init` completes without persisting `enableTelemetry`, backend row count = 0 |
| AC2 | TC-3 | `DO_NOT_TRACK=1` set; same scenarios as TC-2 | Integration | M2 | Same as TC-2 |
| AC2 | TC-4 | Pre-existing `config.json` with `enableTelemetry: false` (and no `installationId`); CLI invoked; no event sent; file unchanged | Integration | M2 | `config.json` byte-identical before and after; backend row count = 0 |
| AC2 | TC-5 | Pre-existing `config.json` with `enableTelemetry: true` + `installationId`; `PRISMA_NEXT_DISABLE_TELEMETRY=1` set; CLI invoked; file is not rewritten or deleted; no event sent | Integration | M2 | `config.json` byte-identical before and after; backend row count = 0 |
| AC3 | TC-6 | Mocked CI env vars for GitHub Actions, Buildkite, Jenkins each in turn (verified via `ci-info` returning `isCI = true`); CLI invoked; no event sent for any of them; `init` (run under mocked CI) does not present the telemetry prompt | Integration | M2 | Backend row count = 0 for each CI provider env; `init` flow does not show the prompt under CI |
| AC4 | TC-7 | Fresh machine, `prisma-next init` interactive run: telemetry consent prompt appears as the last question with default Yes; answering yes persists `enableTelemetry: true` + generates `installationId`. Second `init` run on the same machine: prompt is not re-shown (resolved value already set). Separately, `init --yes` on a fresh machine: prompt is suppressed and `enableTelemetry` stays undefined. A non-init command (e.g. `prisma-next --help`) on a fresh machine: produces no banner and no prompt. | Integration | M2 | First `init` shows prompt; `config.json` reflects answer with valid v4 `installationId`. Second `init` skips prompt. `init --yes` writes no `enableTelemetry`. Non-init command produces no telemetry-related stderr output. |
| AC5 | TC-8 | CLI run with telemetry endpoint pointing at a blackhole IP; runtime compared against a run with `PRISMA_NEXT_DISABLE_TELEMETRY=1`; no perceptible regression | Integration / perf | M2 | Wall-clock delta is within measurement noise (e.g. ≤ 50ms p95 over 50 runs) |
| AC6 | TC-9 | CLI invoked with a command that crashes mid-execution (e.g. throws inside the command body after a 200ms sleep); event still appears in backend | Integration | M2 | Backend row count = 1; event corresponds to the crashed command |
| AC7 | TC-10 | CLI invoked with sensitive flag values (`--connection-string="postgres://u:p@h/d"`, `--name="customer-acme"`, `--config=/Users/alice/secrets/x.toml`); event recorded in backend | Integration | M2 | `flags` array contains `["connection-string", "name", "config"]`; *no* value strings, paths, or positional arguments appear anywhere in the event |
| AC8 | TC-11 | CLI invoked across all failure modes (no network, DNS timeout, backend 5xx, malformed response); stdout and stderr inspected | Integration | M2 | No telemetry-originating output on stdout or stderr in normal mode; debug output only when `PRISMA_NEXT_DEBUG=1` |
| AC9 | TC-12 | Single `isCI()` helper used in both telemetry skip-decision and the existing colour-output check at `cli/src/utils/global-flags.ts:74`; codebase search confirms no parallel CI-detection logic | Unit + manual audit | M2 | Helper has one definition; both call sites use it; `grep` finds no other `process.env.CI` reads in tree |
| AC10 | TC-13 | CLI invoked with multiple extensions declared in `prisma-next.config.ts`'s `extensionPacks` (e.g. `pgvector` plus a user-authored `myorg-ext`); event inspected | Integration | M2 | `extensions` array equals (set-wise) the configured pack `.id` values; no extra extension fields exist on the event |
| AC11 | TC-14 | Each known agent env var (e.g. `CLAUDECODE=1`, `CURSOR_AGENT=1`, …) set in turn; event's `agent` field reflects the corresponding tool; with no marker set, `agent` is `null` | Unit + integration | M2 | Field matches per marker; null on no match |
| AC12 | TC-15 | Backend accepts an event with superset fields (forward compat) and an event with subset fields (backward compat); both stored without 4xx/5xx | Integration | M1 | Both events round-trip cleanly; missing-field rows have nulls in those columns |
| AC13 | TC-16 | Manual code-review pass over the client confirms no field derived from MAC address, machine ID, hostname, username, IP, or any system identifier reaches the wire | Manual review | M3 | Reviewer signs off; audit checklist artefact committed to project workspace then migrated to repo |
| Security | TC-17 | Backend rate-limit kicks in at the configured threshold; over-limit requests receive a documented response without affecting stored events from compliant clients | Integration | M1 | Rate limiter is exercised; observed behaviour matches the configured policy |

## Milestones

### Milestone 1: Telemetry backend

**Deliverable.** A Bun service deployed to Prisma Compute that accepts CLI telemetry events over HTTPS, validates them with arktype, and inserts them into Postgres via Prisma Next using the schema pinned in spec FR16. Schema lives outside the framework-domain boundary in `architecture.config.json`. The service is reachable at a stable `*.prisma.build` URL and is rate-limited.

**Demonstrable as.** Manual `curl -X POST` of a valid event payload yields a row in Postgres; a malformed payload is rejected cleanly; a request burst hits the rate limit. AC12 and the Security TC pass.

**Tasks:**

- [ ] Decide on backend package location in the repo and workspace layout. The spec proposes `apps/telemetry-backend/` as a top-level directory outside the framework domain, but no `apps/*` glob exists in `pnpm-workspace.yaml` today; choose between adding the glob, placing the backend under `packages/` with a new domain in `architecture.config.json`, or another location consistent with how the team plans to organise internal services. The deliverable is the chosen path plus the `pnpm-workspace.yaml` / `architecture.config.json` updates that make `pnpm install` and `pnpm lint:deps` happy. (unblocks: TC-15, TC-17)
- [ ] Scaffold the backend package: `package.json` with Bun runtime, `prisma-next.config.ts` pointing at a Postgres target, contract source authoring the `TelemetryEvent` model from spec FR16, dev/test scripts. Run `pnpm fixtures:check` to confirm contract emission round-trips. (satisfies: TC-15)
- [ ] Implement the HTTPS POST endpoint: a single route accepting JSON event payloads, arktype validation matching the wire-format shape, INSERT via Prisma Next, 2xx on accept. Backward-compatibility shape per spec FR13: unknown fields ignored, missing non-critical fields tolerated. (satisfies: TC-15)
- [ ] Add rate limiting (per the spec's Security section). The mechanism (in-process token bucket, fronting reverse proxy, Prisma Compute primitive) is plan-task-internal; the deliverable is "above the configured threshold, over-limit requests are rejected without affecting valid traffic". (satisfies: TC-17)
- [ ] Deploy to Prisma Compute; capture the assigned `*.prisma.build` URL. The URL becomes a build-time constant in the M2 client. (operational; unblocks: TC-1 through TC-14)
- [ ] Integration tests for forward/backward compatibility (TC-15) and rate limiting (TC-17), runnable from the package's own test suite against the deployed backend (or a locally-spun test instance). Capture the URL via an env var so the same suite works against local and deployed targets. (satisfies: TC-15, TC-17)

**Validation gate:**

- `pnpm typecheck`
- `pnpm --filter @prisma-next/telemetry-backend test` (or equivalent, depending on the chosen package name)
- `pnpm lint`
- `pnpm lint:deps`
- `pnpm build`

### Milestone 2: Telemetry client

**Deliverable.** A telemetry client package under `packages/1-framework/3-tooling/` (exact subpackage decided at scaffold time) that wires into the CLI entry point, forks a detached subprocess at command start via `child_process.fork()`, and ships events to the M1 backend. Includes the consolidated `isCI()` helper, the user-level `config.json` read/write lifecycle (both `enableTelemetry` and `installationId` live in this file), the `init` consent prompt wiring, the gating resolution over the two env-var signals + the stored `enableTelemetry` (with default-off semantics when undefined), the command/flag sanitization rule, the agent detector, and the test-harness short-circuit. End-to-end happy path is verifiable against the M1 backend.

**Demonstrable as.** On a fresh machine: run `prisma-next init` interactively and answer yes → see `config.json` created with both fields and the init-run telemetry event in the backend; subsequent CLI commands emit events sharing the same `installationId`. Run with each opt-out surface (either env var, file with `enableTelemetry: false`, or fresh-machine-with-no-file default-off), observe no event. Run under simulated CI, observe no event and no init prompt. All TC-1 through TC-14 pass.

**Tasks:**

- [ ] Add `ci-info` dependency to the CLI package. Implement a single `isCI()` helper (proposed location `packages/1-framework/3-tooling/cli/src/utils/is-ci.ts`). Replace the existing inline `process.env.CI` read at `cli/src/utils/global-flags.ts:74` with a call to the new helper. Confirm by `grep` that no other `process.env.CI` reads remain in tree. (satisfies: TC-6, TC-12)
- [ ] Scaffold the telemetry client subpackage inside `packages/1-framework/3-tooling/` (suggested name: `cli-telemetry`). Set `architecture.config.json` entry for `framework / tooling / shared`. Wire as a dependency of the CLI package. (unblocks: TC-1 through TC-14)
- [ ] Implement user-level config file read/write at `$XDG_CONFIG_HOME/prisma-next/config.json` (Unix, defaulting `$XDG_CONFIG_HOME` to `$HOME/.config` per XDG spec) or platform-equivalent under `%APPDATA%` on Windows. API: `readUserConfig()` returns `{ enableTelemetry?: boolean; installationId?: string; ...unknown }` (file-missing tolerated, unknown fields preserved for forward compat); `writeUserConfig(partial)` merges into the existing file and writes atomically. When persisting `enableTelemetry: true` and `installationId` is unset, generate a v4 UUID and write both fields together. Never delete or rotate the file in response to env-var-driven opt-out. Use a single cross-platform helper (e.g. `env-paths`) for path resolution. (satisfies: TC-1, TC-4, TC-5)
- [ ] Implement telemetry-gating resolution as a pure function over (env, `readUserConfig()` result). Rule: if `PRISMA_NEXT_DISABLE_TELEMETRY` (any truthy value) or `DO_NOT_TRACK=1` is set ⇒ disabled; else if `enableTelemetry === true` ⇒ enabled; else (false, undefined, or file missing) ⇒ disabled. Unit-testable. (satisfies: TC-2, TC-3, TC-4, TC-5)
- [ ] Wire the telemetry consent prompt into `prisma-next init`'s interactive flow. Add it to `packages/1-framework/3-tooling/cli/src/commands/init/inputs.ts` as a new `clack.confirm` after the existing prompts (target, authoring, schema path, write-env, remove-previous-facade). Gate the prompt on: `canPrompt === true` **and** `!autoAcceptPrompts` **and** `readUserConfig().enableTelemetry === undefined`. Use `initialValue: true` (default Yes), `output: process.stderr`, and the proposed wording from spec FR4 (revisit at implementation time). On a non-cancelled response, persist via `writeUserConfig({ enableTelemetry: <answer> })`; on `answer === true`, generate and store `installationId` in the same write. Surface the chosen value in `ResolvedInitInputs` for any downstream output the team wants. Document the prompt's behaviour in the existing `inputs.ts` doc-comment style. (satisfies: TC-7)
- [ ] Implement command/flag sanitization from commander's parsed-result shape (not raw argv). The output is the command name + the array of flag names that were parsed. Pure function; unit-testable. (satisfies: TC-10)
- [ ] Implement the agent detector as a clean port of Prisma ORM's `detectAiAgent`, with fixes: normalise comparison shape (all entries are env-var-presence-or-equals), fix the macOS-only `CODEX_SANDBOX === 'seatbelt'` check (it's macOS-only on Codex CLI; replace with a cross-platform marker if one exists or note the limitation explicitly), and add a `TODO: a ci-info-for-agents would be nice` comment. Place the detector in the sender script (runs in the child). (satisfies: TC-14)
- [ ] Implement the sender script (the file forked into a child). Reads the parent's payload via IPC, enriches with system probes (`process.arch`, `process.platform`, runtime + version, package manager parsed from `npm_config_user_agent`), reads project `package.json` for `tsVersion` (null on any failure), runs the agent detector, POSTs to the M1 backend URL with a hard 1–2s timeout, swallows all errors, exits. Output gated behind `PRISMA_NEXT_DEBUG=1`. (satisfies: TC-9, TC-11, TC-13, TC-14)
- [ ] Implement the parent-side spawn at command start: `fork()` with `detached: true, stdio: ['pipe', 'ignore', 'ignore', 'ipc']`, `send(payload)`, `disconnect()`, `unref()`. Wire into the CLI entry at `packages/1-framework/3-tooling/cli/src/cli.ts` immediately after argument parsing and before main command execution. Skip the spawn when opted out or when `isCI()` reports true. (satisfies: TC-1, TC-5, TC-8, TC-9, TC-10, TC-13)
- [ ] Hook the test harness to set `PRISMA_NEXT_DISABLE_TELEMETRY=1` once at setup (spec NFR7). Confirm test runs do not spawn the sender via a probe (e.g. inspecting child-process spawn calls in a dedicated test). (satisfies: NFR7 verification; supports clean test runs of TC-1 through TC-14)
- [ ] Integration test suite covering TC-1, TC-2, TC-3, TC-4, TC-5, TC-6, TC-7, TC-8, TC-9, TC-10, TC-11, TC-13, TC-14. Tests run against M1's backend (or a local instance with the same wire shape). Use isolated tempdirs for `XDG_CONFIG_HOME` so test runs don't pollute the developer's real install. (satisfies: the listed TCs)

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm lint`
- `pnpm lint:deps`
- `pnpm build`

### Milestone 3: Documentation, AC verification, and close-out

**Deliverable.** User-facing documentation describing the telemetry surface, a manual code-review audit (TC-16) confirming no PII leakage, and the project close-out: ADRs verified in their durable home, transient project workspace deleted, all repo-wide references to `projects/cli-telemetry/**` replaced with canonical `docs/` links or removed.

**Demonstrable as.** Documentation merged and reviewable in `docs/`; audit checklist artefact present in the close-out PR; `projects/cli-telemetry/` no longer exists on `main`; `grep -r "projects/cli-telemetry" /Users/aqrln/prisma/prisma-next/docs /Users/aqrln/prisma/prisma-next/README.md` returns no hits.

**Tasks:**

- [ ] Write the user-facing telemetry documentation (per spec FR11): what fields are collected (link to the canonical event-shape doc); the user-level `config.json` file (location, structure, how to edit `enableTelemetry` to flip the choice, how to fully reset by deleting the file); the two env-var opt-out signals (`PRISMA_NEXT_DISABLE_TELEMETRY`, `DO_NOT_TRACK`); the `init` consent prompt (final wording, default-Yes, when it appears, why it isn't re-shown); the default-off behaviour when `enableTelemetry` is undefined; the rationale for telemetry being a per-user choice rather than per-project; and the best-effort nature of agent detection. Target location: under `docs/` (subpath chosen during the task — likely `docs/onboarding/Telemetry.md` or a new `docs/oss/Telemetry.md`). Link from `docs/README.md` and `CLAUDE.md` *Common Tasks* / *OSS* sections if relevant. (satisfies: spec FR11)
- [ ] Conduct the AC13 manual code-review pass: grep the client for any system-identifier reads (MAC, machine-id, hostname, username, IP, env-vars carrying PII); review the payload-construction code path end-to-end against the spec's NFR4 list; produce a written audit checklist signed off by the reviewer. Commit the checklist into the project workspace (it gets deleted at close-out, but the sign-off is visible in PR history). (satisfies: TC-16)
- [ ] Verify ADRs 216 and 217 are present in `docs/architecture docs/adrs/`, indexed in `docs/architecture docs/ADR-INDEX.md`, and promoted from `Status: Proposed` to `Status: Accepted` (with the relevant PR link). (close-out step per project workflow)
- [ ] Run a complete acceptance-criteria verification pass: each AC1–AC13 mapped to a passing test (TC-1 through TC-16) or the manual checklist; record the mapping artefact in the close-out PR description. (close-out verification step)
- [ ] Delete `projects/cli-telemetry/`. Run `grep -r "projects/cli-telemetry" .` from repo root; if any hits remain in `docs/**`, README.md, or scripts, either replace them with canonical `docs/` links or remove. (close-out per the project skill instructions)
- [ ] Open the close-out PR with all of the above. PR title and/or body must reference the Linear issue identifier so the GitHub-Linear integration auto-transitions the issue on merge. (close-out)

**Validation gate:**

- `pnpm typecheck`
- `pnpm test:all`
- `pnpm lint`
- `pnpm lint:deps`
- `pnpm build`
- `grep -r "projects/cli-telemetry" /Users/aqrln/prisma/prisma-next/docs /Users/aqrln/prisma/prisma-next/README.md /Users/aqrln/prisma/prisma-next/CLAUDE.md` (must return no hits before merge)

## Open Items

Carried forward from spec open questions; tracked here so they don't fall off the radar during execution.

- **OI1 (spec OQ1).** Production telemetry endpoint vanity URL on Prisma Compute. EA milestone is fine with the default `*.prisma.build` URL; revisit post-EA if a stable vanity URL is wanted. Owner: Compute Ops + project Maker.
- **OI2 (spec OQ2).** Legal review of the "no DPIA required" conclusion before EA launch. Operational gate, not a design question. Owner: Legal + project Maker. Trigger: schedule for the M3 timeframe at the latest.
- **OI3 (M1 internal).** Choice of backend package location and workspace-layout strategy (top-level `apps/*` glob vs. a new domain inside `packages/`). **Resolved in M1 R1**: backend lives at `apps/telemetry-backend/` (package `@prisma-next/telemetry-backend`); `apps/*` added to `pnpm-workspace.yaml`; no `architecture.config.json` change required because both the layering config and `dependency-cruiser` scope to `packages/`.
- **OI4 (cross-milestone).** The Prisma Compute deploy URL becomes a build-time constant in the M2 client. If the URL changes between M1 deploy and M2 release, the M2 client must be rebuilt — small operational concern, mention in the M1 close-out so M2 picks up the final URL. **Resolved**: the M1 deploy assigned `https://cmpbfbsdp09hr3jf7pojjs5qs.ewr.prisma.build`; M2 hardcodes this URL as a build-time constant. The user will re-deploy after M1 R2 lands the spec-amendment wire-format tightening; if the URL changes on re-deploy, update the M2 client constant before M2 R1 starts.
- **OI5 (M1 → M3).** Root `package.json` `fixtures:emit` script's hardcoded `--filter` list does not include `@prisma-next/telemetry-backend`, so `pnpm fixtures:check` does not gate contract drift for the backend's contract artefacts (`apps/telemetry-backend/src/prisma/contract.json` / `contract.d.ts`). Package-local `pnpm --filter @prisma-next/telemetry-backend emit:check` covers the case (passes today). **Resolved (chosen path: a)**: add the backend to the root `fixtures:emit` filter so workspace-wide drift detection covers it. To be implemented in M1 R2 alongside the spec-amendment wire-format work.
- **OI6 (M1 design → wire format).** The backend's arktype schema originally defaulted `runtimeName`, `runtimeVersion`, `os`, and `arch` to the literal string `'unknown'` when a client omitted them — a sentinel approach forced by the original FR13 backward-compat tolerance clause combined with FR16's NOT NULL pinning of those columns. The team flagged the consequence (downstream adoption-rate / version-distribution queries would have to filter `'unknown'` out of real values) before the trade-off hardened. **Resolved**: the spec was amended (FR13 + AC12) to make the four fields part of the wire-format required-set; backend rejects with `400 Bad Request` when any is missing. To be implemented in M1 R2.

## Round notes (orchestrator-tracked)

- **M1 R1** — SATISFIED on first round. Backend scaffold, contract authoring, endpoint + arktype validation + INSERT, rate limiter, integration tests, README, all green against the M1 validation gate. Deploy task excluded per orchestrator note; user deployed separately after M1 R1 landed.
- **M1 R2** — in progress at time of writing. Spec amendment to FR13 + AC12 (see OI6) and OI5 fix (add backend to root `fixtures:emit` filter). Re-deploy required after M1 R2 lands so the production backend matches the tightened wire format.
