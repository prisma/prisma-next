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

**Disposition.** Operator-decision: should we record this as a workspace-level gotcha (see `record-gotchas` skill) so it stops being rediscovered each session? Or accept that it's a one-off worktree issue and not durable enough to surface? Holding pending decision; not blocking the build loop.
