# Retros — cli-telemetry

## 2026-05-20 — Mandatory-final retro: project close

**Trigger:** Mandatory project-close retro per invariant I10 (`drive-close-project` refuses to close the project without it). Scope is the project as a whole — backend scaffolding through milestone close-out — not a single triggering event.

### What happened

`cli-telemetry` shipped Phase 1 of CLI usage telemetry for Prisma Next: a Bun backend at `apps/telemetry-backend/`, a client at `packages/1-framework/3-tooling/cli-telemetry/`, the CLI integration that hooks it to `preAction`, the `init` consent prompt, the gating layer over three opt-out signals, agent detection, and the user-facing trust disclosure at `docs/Telemetry.md`. All 13 acceptance criteria landed PASS; ADRs 216 and 217 promoted from Proposed to Accepted; the AC13 PII-zero audit was signed off with zero findings.

The path through this was non-trivial: a multi-week first-epic saga (40 commits, 100+ review comments, branch `telemetry` deleted post-merge) absorbed the client + backend lift; the m3 close-out arc was decomposed into four small dispatches (m3.0 testing-gap closures, m3.1 user-facing doc, m3.2 audit, m3.3 ADR promotion + cross-reference retarget) and produced this retro at the end.

### What went well

- **Contract-first client/backend split scaled.** The wire-shape `TelemetryEvent` is the contract; client and backend pin it independently via arktype schemas that mirror each other (`packages/1-framework/3-tooling/cli-telemetry/src/payload.ts` ↔ `apps/telemetry-backend/src/schema.ts`). The backend's `'+': 'delete'` forward-compat policy plus the client's typed-object-literal construction site made the audit's wire-shape claim ("exactly 13 fields, no more") trivially verifiable.
- **"Fork at command start" (ADR 217) earned its cost.** The detached subprocess pattern made the strict isolation contract (no exit-time coupling, no stderr leakage, survives parent crash) impossible to violate by construction. The m3.0 e2e test that crashes the parent and asserts the row still lands is the existence proof; AC5's wall-clock-no-regression assertion never needed to be written because the design eliminated the risk.
- **TDD discipline held across the saga.** Pure-function unit tests (`gating.test.ts`, `sanitize.test.ts`, `detect-agent.test.ts`, `enrich.test.ts`, `payload.test.ts`, `endpoint.test.ts`, `user-config.test.ts`) pinned each component independently; the integration suite asserted the wire-shape end-to-end against the real Bun backend; the m3.0 e2e suite added the CLI-process spawn coverage. The test pyramid is in the right shape and the suite ran in ~5s consistently.
- **Spawn-fresh m3 subagents was the right call.** The saga's post-merge state diverged enough from m1/m2 subagent context (the `void`-not-`await` preAction wiring, arktype IPC validation, rate-limiter input guards, x-forwarded-for hardening) that resuming the prior IDs would have produced confused first-action context. The m3 implementer and reviewer pair worked cleanly across all four dispatches with zero must-fix findings.

### What surprised us

- **`projects/**/reviews/` gitignore blocked the audit artefact.** Hit in m3.2: the dispatch wanted the AC13 audit checklist in PR history, but the workspace `.gitignore` excluded the whole reviews directory and a naive `!` re-include underneath didn't work because git stops descending into ignored directories. The implementer changed the parent rule to `projects/**/reviews/*` (note trailing `*`) and added the named re-include. This is the lesson worth landing — every project that ships an audit-class deliverable will hit the same wall.
- **Spec FR4's prescribed consent string drifted from shipped source.** The spec dictated an exact wording for the `init` consent prompt; the actual `TELEMETRY_CONSENT_MESSAGE` constant in `cli/src/commands/init/inputs.ts` is slightly different (the saga reviewers replaced the GitHub-URL framing with "open source and fully transparent"). The new `docs/Telemetry.md` quotes the shipped wording verbatim; the spec is deleted at close-out so the divergence evaporates. Logged under `wip/unattended-decisions.md § 5` as a follow-up if anyone wants to align them.
- **1Password SSH agent dropped offline mid-m3 and stayed flaky.** Four consecutive unsigned commits on the `cli-telemetry-m3` bookmark (`a5a58e6c`, `0b8a1ec8`, `0efad1f3`, `a3630a66`) — the implementer attempted signing each time and fell back to `--config signing.behavior=drop` per dispatch authorisation. Branch protection may require rebase-resign at PR-prep time; tracked under `wip/unattended-decisions.md § 3, § 4`.
- **The `'close'` event on `ChildProcess` never fires for IPC-disconnect-driven idle exits.** Discovered during m3.0's stderr-emptiness work: when the sender exits via natural event-loop drain after a parent `disconnect()`, `'exit'` fires but `'close'` never does. The stderr-capture helper in `integration.test.ts` resolves on `exit` + both stdio `'end'` events to work around this. A reusable Node-IPC observation, but narrow enough that it didn't earn a separate landing surface.
- **A hidden CLI command was the cleanest way to test the crash-survives-fork invariant.** The `__telemetry-crash-test` command in `cli.ts` sleeps 200ms then throws; the dispatch explicitly authorised it, and the deterministic timing eliminated the race between "fork happens" and "action body crashes". A first-time-shipped pattern but narrow; not landed as a generic technique.

### What lessons land where

| Lesson | Severity / generality | Landing surface | Rationale |
|---|---|---|---|
| Audit-class deliverables under `projects/**/reviews/` need the trailing-`*` + `!` re-include pattern | High generality (every close-out audit) | **`drive/project/README.md` § Audit-class deliverables under `projects/**/reviews/`** (new subsection, this round) | Concrete, generalises, prevents recurrence. Strongest landing candidate. |
| "Resolved-by-design-change" as a finding-disposition class | Medium generality (any project with reviewer findings) | **Deferred to canonical update via `drive-update-skills`** — not landed in this round | Best home is `drive-build-workflow/SKILL.md § Findings discipline`; canonical updates go through a separate PR to `prisma/ignite` and are out of scope for an unattended-mode close-out. Tracked here so the next operator pass picks it up. |
| Spec-prescribes-exact-string is fragile under review-cycle refinement | Low generality (only specs that prescribe exact strings); single occurrence so far | **No landing** — single-incident pattern, mentioned here only | Would be premature catalogue addition. If a second project hits it, file as a `drive/spec/README.md` hygiene note. |
| Hidden test-only CLI command pattern (e.g. `__telemetry-crash-test`) | Low generality (test-only; specific to CLI projects); single use so far | **No landing** — narrow pattern, documented in the source comment alongside the command | Reusable but small enough that the source-side doc is sufficient. |
| `ChildProcess.close` doesn't fire for IPC-disconnect idle-exit; resolve on `exit` + stdio `'end'` instead | Low generality (specific to fork-based tests with IPC disconnect) | **No landing** — documented in the helper-site comment in `integration.test.ts` | Future tests that need the pattern will find it via grep when they hit the same hang. |

### Deferred work surfaced

The `wip/unattended-decisions.md` log accumulated six entries during m3. The disposition for each at close-out:

1. **Spawn-fresh m3 subagents.** No follow-up — explained in the swap note in `reviews/code-review.md`.
2. **Hidden `__telemetry-crash-test` command for all e2e cases.** No follow-up — documented in source.
3, 4. **Unsigned commits a5a58e6c / 0b8a1ec8 / 0efad1f3 / a3630a66.** Follow-up: if branch protection requires signed commits at PR-prep time, rebase + re-sign. Implementer mechanics, no protocol change needed.
5. **Spec/source consent-prompt wording divergence.** Surface-of-record (`docs/Telemetry.md`) matches shipped reality. No follow-up unless the team decides to align the consent string with the spec's original URL framing.
6. **`.gitignore` loosened to allow named audit file.** Landed as a precedent in `drive/project/README.md` this round. No follow-up.

No items belong in Linear; all six are decisions the close-out PR can stand on as-is.

### ADR-worthy decisions

The two project-defining decisions were authored at design time as ADRs 216 (installation-ID is stored random UUID) and 217 (telemetry runs in detached subprocess at command start), both promoted to Accepted in m3.3. No new ADR-worthy decisions surfaced during the project; both ADRs survive close-out as the durable architectural record.

### One-sentence summary for the team channel

`cli-telemetry` shipped Phase 1 with 13/13 ACs PASS, ADRs 216/217 Accepted, and a `drive/project/README.md` precedent for tracking audit-class deliverables under the otherwise-ignored `projects/**/reviews/` directory.

---

**Landing surface(s):**

- _Project-context: `drive/project/README.md` § Audit-class deliverables under `projects/**/reviews/` — new subsection documenting the `projects/**/reviews/*` + `!projects/<project>/reviews/<file>` re-include pattern; cites the cli-telemetry precedent at `projects/cli-telemetry/reviews/ac13-audit.md`._
- _Deferred (logged for next canonical pass, not landed this round): canonical addition to `drive-build-workflow/SKILL.md § Findings discipline` documenting "resolved-by-design-change" as a finding-disposition class. The cli-telemetry m2 R2 → m3 entry handled F2 this way (`fix(cli): fire telemetry preAction hook as void, do not await it` at `86f143164f9e` eliminated the AC5 wall-clock-regression risk, closing F2 without an added test). Future projects need a sanctioned vocabulary for this disposition; the canonical-update PR to `prisma/ignite` is out of scope for an unattended close-out pass._
