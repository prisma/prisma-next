# Learnings — `ppg-serverless`

> Working ledger of patterns surfaced during this run. Reviewed at project close-out per `drive-close-project`; cross-cutting lessons migrate to durable docs (skills, calibration, ADRs), project-local lessons drop with this folder.

## Slice 1 / D1 / R1 — brief embedded a transient-ID rule violation

**What happened.** Dispatch brief for Slice 1's only dispatch authored the runtime placeholder's error string literally as `'driver-ppg-serverless: runtime not implemented; landing in Slice 2'`, and the README scaffold instructions used the same `"<!-- TODO: Slice 2 -->"` shape. Implementer followed the brief faithfully. Reviewer caught all six occurrences as violations of `.agents/rules/no-transient-project-ids-in-code.mdc` (`alwaysApply: true`) and filed F1 (must-fix). One iteration cost.

**Root cause.** Orchestrator authored the brief while in a slice/project-doc headspace ("Slice 2 will fill this in") and copied the same prose into the user-visible string that the brief was specifying. Slice-relative anchors are correct *in* the slice spec / plan / brief — those are themselves transient artifacts. They are wrong in any string that ships in source, dist, or README.

**Generalisable lesson.** When a brief specifies *literal strings* that will land in source (error messages, log lines, README paragraphs, JSDoc), those strings inherit the same rule-set as the source they land in — including the always-apply rules. The brief's prose ABOUT the change is in transient-doc voice; the strings the brief PRESCRIBES are in source-code voice.

**Disposition.** Captured here. The reviewer surfaced three remediation options:

- (a) Pre-dispatch lint step running the transient-ID regex over the brief's `+` diff (`projects/<project>/slices/<slice>/dispatches/<NN>-*.md`) at brief-write time.
- (b) Note in `drive-build-workflow` that brief text prescribing source strings is bound by the same always-apply rules as code.
- (c) Accept the iteration cost.

Not actioning systemically in this run — single-iteration cost is cheap and the lesson is well-named. If a second occurrence shows up later in this project (or in another project), upgrade to (a) or (b). Revisit at project close-out.

## Slice 1 / D1 / R1 — NixOS env / biome dynamic-linker incompatibility

**What happened.** This worktree runs on NixOS aarch64 sandbox. The pnpm-installed `@biomejs/cli-linux-arm64@2.4.15` binary is a generic-linux dynamic executable that NixOS's stub linker cannot launch. Result:

- `pnpm lint` fails workspace-wide (reproducible on the unchanged `driver-postgres` reference).
- Pre-commit `biome check` hook fails, forcing `--no-verify` on any code commit.

Not specific to this project; affects every package in the worktree.

**Generalisable lesson.** Workspace-wide biome linting is environmental in this worktree. CI on a non-NixOS runner is the authoritative `lint` signal until the env is fixed (Nix wrapper for the biome binary, container the agent in a non-NixOS env, or switch worktree base).

**Disposition.** Resolved without code change — the env was misdiagnosed. `nix-ld` was already configured at the OS level (`NIX_LD=/run/current-system/sw/share/nix-ld/lib/ld.so`, `NIX_LD_LIBRARY_PATH=/run/current-system/sw/share/nix-ld/lib`). Biome runs cleanly through `pnpm lint` and through the pre-commit hook in the orchestrator's interactive shell. The R1 failure was a sub-agent shell-env propagation issue: the spawned subagent didn't inherit the parent shell's `NIX_LD*` vars, so biome's interpreter couldn't be resolved. Future subagent dispatches should either (a) inherit env explicitly when spawning, or (b) document this as a worktree property so subagents know to source it. Both R1 commits (`89fe0c394`, `b285a2c03`) used `--no-verify` as a result; the post-rebase realignment commit (`54c93545b`) ran the hook cleanly.

A second lesson: the schema-version drift in `biome.jsonc` (2.4.14 vs the now-current 2.4.15) was inherited from copying `driver-postgres`'s file verbatim before the upstream version bump landed on origin/main. Rebasing pulled in the version bump and surfaced the drift; one-line realignment fixed it. Pattern to watch for: scaffolding-by-copy from a reference package can silently inherit pre-bump artifacts of any concurrent maintenance work upstream.

## Slice 2 / D1 / R1 — transient-ID rule violation again (JSDoc surface this time)

**What happened.** The implementer fixed F1 in Slice 1 by rewriting error strings and README copy. Slice 2's R1 then shipped two new `D1` / `D2` transient-ID references in JSDoc + inline comments of `ppg-driver.ts`. F2 (must-fix) caught them; R2 resolved cleanly with two pinned rewrites + two implementer-discretion fixes for adjacent prose-attribution sites ("later slice").

**Two contributing factors:**

1. **Brief's transient-ID regex was narrower than the rule's canonical regex.** The brief's `Completed when` #7 used `\b(Slice|Task|TC|AC|FR|NFR)[ -]?[0-9]+\b`. The rule (`.agents/rules/no-transient-project-ids-in-code.mdc`) defines a broader regex that includes `D[0-9]+|M[0-9]+\.[0-9]+|P[0-9]+ R[0-9]+|M[0-9]+ review`. The implementer dutifully ran the brief's regex and got empty output. The narrower scan missed `D1` and `D2`.
2. **F1 lesson scoped to strings + README; comments slipped through.** The R1 implementer internalized "don't put transient IDs in user-visible strings" but not "don't put them in JSDoc/inline comments either" — even though the brief's Standing Instruction explicitly named JSDoc.

**Generalisable lesson.** The rule's canonical regex (full list of transient-ID token shapes) belongs in the dispatch brief template, not a project-specific subset. The implementer persona's pre-commit checklist should include the canonical regex by default. Prose attributions ("later slice", "per project", "sub-spec") are NOT regex-catchable; they need a manual sweep step in the implementer's wrap-up checklist.

**Disposition.** Applied (b) for this project: R2's brief used the canonical regex + explicit prose-attribution sweep step. The implementer also caught two extra "later slice" sites under the standing-instruction's "trivial-and-related" carve-out, which is the desired behaviour. For future projects, propagate the canonical regex into the dispatch brief template (and the implementer-persona pre-commit checklist) at close-out. Not auto-applying mid-project; the trial period's `drive-build-workflow` skill changes shouldn't churn while a project is in flight.

## Slice 6 / D1 — `@prisma/dev`'s `server.ppg.url` serves Accelerate, not PPG (AC-4 deferred)

**What happened.** D1 attempted to add integration tests for the facade against `@prisma/dev`'s in-process PPG endpoint, per project spec D6 ("`@prisma/dev`'s programmatic server already exposes a PPG-compatible endpoint at `server.ppg.url`"). The implementer halted after an empirical probe revealed all `@prisma/ppg` `transportConfig` variants returning `WebSocketError`, and `POST http://<ppg-host>/v0/statement` returning HTTP 404. Source-level verification of `@prisma/dev@0.24.7` (cloned from `prisma/team-expansion`, a private repo) confirmed the diagnosis unambiguously.

**Root cause.** Two different Prisma products both use `prisma+postgres://` URLs but speak different wire protocols:

| Product | Wire protocol | Auth | Consumed by |
|---|---|---|---|
| Prisma Accelerate / data-proxy | GraphQL over HTTPS, paths `/:version/:hash/graphql` + `/itx/:tx/{commit,rollback,graphql}` | `api_key` (Bearer-like) | `@prisma/client/edge` |
| `@prisma/ppg` (PPG serverless driver) | Raw-SQL over HTTPS at `/v0/statement` + WS at `/v0/session` with subprotocol `prisma-postgres-1.0` | Basic `username:password` | `@prisma/ppg@1.0.1` directly (and `@prisma-next/driver-ppg-serverless`) |

`@prisma/dev`'s HTTP server (`dev/server/src/accelerate.ts` + `dev/server/src/query-plan-executor.ts`) implements the first protocol via Hono routing + `@prisma/query-plan-executor`. Zero references to PPG's wire protocol paths anywhere in the dev-server source (`grep -rn 'v0/statement\|v0/session\|prisma-postgres-1\.0\|@prisma/ppg'` returned 0 hits). The api_key payload on `server.ppg.url` decodes to JSON `{ databaseUrl, shadowDatabaseUrl, name }` carrying the underlying TCP URLs — confirming the endpoint is an Accelerate emulator wrapping the dev-server's PGlite database, not a PPG protocol server.

The project spec's D6 was wishful interpretation of the `ppg.url` label. The label exists; the protocol does not match.

**Generalisable lesson.** *URL-scheme aliasing across protocols is a deeply-misleading API surface.* `prisma+postgres://` is used by Prisma for at least three distinct things (Accelerate, PPG, and the dev-server's labelled-but-protocol-mismatched endpoint). For testing/integration claims, **never trust the label; probe the wire**. The empirical probe (raw `fetch` against `/v0/statement`) caught what reading the spec did not.

**Options surfaced to the operator.**

- **(a) Build a `@prisma/ppg`-protocol shim in `@prisma-next/test-utils`.** Implement `/v0/statement` HTTP + `/v0/session` WS endpoints ourselves, backed by PGlite (which `@prisma/dev` already uses). ~500–800 LoC of protocol implementation, localised to `test-utils`. Unlocks real-wire integration tests for this project AND any future PPG-targeting work in the codebase. Substantive side-quest but bounded.
- **(b) Hosted PPG with CI secret.** Provision a real Prisma Postgres instance; gate integration tests on `PPG_INTEGRATION_URL` env var sourced from a CI secret. Real protocol coverage; conflicts with the project spec's "no env gating" constraint and adds account/secret management overhead.
- **(c) Defer AC-4.** Project ships with mocked-driver coverage from Slices 2/3/5 (134 tests through the real driver code via a fake PPG `Client` at the `Client.newSession` boundary). AC-4 marked as deferred pending upstream `@prisma/dev` PPG support or option (a). Document the limitation in the facade README. File a follow-up Linear ticket.

**Disposition.** Operator chose **(c) defer + draft PR + reconsider shim later**. Slice 6 halts at D1; D2 (READMEs + repo-map) also deferred to follow-up. What ships in the draft PR is Slices 1–5 SATISFIED plus the `ppgUrl` field on `DevDatabase` (forward-compatible scaffolding with the protocol mismatch documented in the field's JSDoc). The slice 6 spec/plan get a STATUS:HALTED banner pointing here. The shim option stays in scope for project-close-out re-evaluation.

**Open follow-ups for project close-out.**

- Decide whether to build option (a) shim before final merge or after.
- Author facade + driver READMEs (Slice 6 D2) — pure docs work; not blocked by the upstream constraint.
- File the Linear follow-up ticket for AC-4.
- Update project spec's D6 wording to reflect ground truth (the assumption was false; either remove the claim or replace it with the chosen resolution).

## Slice 1 close-out — single PR at project close-out (policy override)

**What happened.** After S1/D1 reached SATISFIED, the orchestrator auto-opened PR #634 per `drive-build-workflow § Cross-cutting behavioral rules § auto-push-and-open-the-PR`. The operator closed the PR and instructed: "Don't open transient PRs. Open a single PR once we are done."

**Generalisable lesson.** For this project, the slice loop ends at reviewer SATISFIED, not at PR-open. PR-open is deferred to project DoD. The branch accumulates all slice commits before going up for review.

**Disposition.** Recorded in `code-review.md § Orchestrator notes § Project policy`. Applied for the remainder of this project. Not generalised to canonical `drive-build-workflow` yet — this is project-policy, and the canonical default of "PR per slice" matches most workflows. If a second project sets the same override, consider lifting it into a per-project policy block in `drive/build/README.md`.
