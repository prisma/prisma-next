# lsp-scaffold — Plan

**Spec:** `projects/lsp-scaffold/spec.md`
**Linear Project:** [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c) (team Terminal)
**Linear Issue:** [TML-2930](https://linear.app/prisma-company/issue/TML-2930/lsp-scaffold-prisma-next-lsp-subcommand-psl-diagnostics) — the whole scaffold is tracked as one issue per operator direction; the three slices below are delivered as stacked dispatches under it.

## At a glance

**Consolidated to one slice = one PR** (operator direction, 2026-06-18; calibration precedent TML-2502). The three units below are layers of one coherent reviewable change, delivered as **three stacked dispatches** on a single branch / PR (TML-2930), not three PRs. Fully serial — each dispatch consumes the previous one's hand-off.

_Original framing retained below as the dispatch breakdown; "Slice N" now reads "Dispatch N."_

## Composition

### Stack (deliver in order)

1. **Slice `shared-config-resolution`** — Linear: TML-2930 (dispatch 1)
   - **Outcome:** "Load `prisma-next.config.ts` → resolved PSL schema inputs" is a capability reachable from a package the new server can depend on, rather than living CLI-package-private. Today both the config load (`cli/src/config-loader.ts`, via `c12`) and the input resolution (`cli/src/config-path-validation.ts` `finalizeConfig` / `finalizeContractSource`) sit inside `@prisma-next/cli`; the server package cannot import them without a layering inversion.
   - **Builds on:** None.
   - **Hands to:** A shared entrypoint (working name `loadResolvedConfig`) returning the validated config with `contract.source.inputs` resolved to absolute paths and `sourceFormat` exposed — importable by both `@prisma-next/cli` (which keeps its current `loadConfig` behaviour) and `@prisma-next/language-server`. The CLI's existing call sites (`contract-emit`, `db-sign`, `db-verify`, `format`, …) continue to behave identically.
   - **Focus:** Relocating / re-exposing config load + input resolution and re-pointing the CLI's own consumers. NOT the server, NOT diagnostics.
   - **Design (orchestrator-settled before dispatch):** Add a `c12`-backed loader to **`@prisma-next/config`** as a new export (`./load`), exposing `loadResolvedConfig(configPath?) => Promise<PrismaNextConfig>` that runs `c12` + `validateConfig` + the relocated `finalizeConfig`/`finalizeContractSource` (input-path resolution). `@prisma-next/config` gains a `c12` dependency; this is acceptable — it becomes the one place config is loaded. **CLI-specific structured errors stay in the CLI:** `@prisma-next/config`'s loader throws plain typed errors (`ConfigValidationError`, a `ConfigFileNotFoundError`); `cli/src/config-loader.ts` becomes a thin wrapper that calls `loadResolvedConfig` and maps those to `@prisma-next/errors/control` structured errors, preserving today's CLI error behaviour exactly. The ~10 CLI consumers keep importing `loadConfig` from `../config-loader` unchanged (signature + behaviour identical). The grounding: 10 consumers found (`contract-emit`, `db-sign`, `db-verify`, `inspect-live-schema`, `migrate`, `migration-check`, `migration-graph`, `migration-list`, `migration-show`, `migration-plan`); `finalizeConfig` lives in `cli/src/config-path-validation.ts` and couples to `@prisma-next/emitter` (`getEmittedArtifactPaths`) — that dependency moves with it into `@prisma-next/config`, which already sits below tooling so the layering holds.

2. **Slice `server-package-and-diagnostics`** — Linear: TML-2930 (dispatch 2)
   - **Outcome:** `prisma-next lsp --stdio` launches a working language server: it completes the `initialize`/`initialized` lifecycle, resolves the project's PSL inputs from config, and publishes `@prisma-next/psl-parser` `parse()` diagnostics for open schema inputs (`didOpen`/`didChange`/`didClose`), clearing them when a document parses clean. Non-schema documents and `sourceFormat !== 'psl'` inputs get nothing.
   - **Builds on:** Slice 1's `loadResolvedConfig` hand-off.
   - **Hands to:** A registered, functional `@prisma-next/language-server` package (with its `architecture.config.json` layering entry) that `@prisma-next/cli` depends on and invokes via a thin `createLspCommand`; a `ParseDiagnostic → LSP Diagnostic` mapping; and the document-sync + capabilities surface that slice 3 extends.
   - **Focus:** New package scaffold, `vscode-languageserver` wiring, lifecycle, open-document sync, config-driven schema identification, the diagnostic mapping, and CLI subcommand registration. The mapping layer stays free of `vscode-languageserver` imports where practical (kept reusable). NOT config-change reactivity — config is resolved once at `initialize` in this slice.

3. **Slice `live-config-watching`** — Linear: TML-2930 (dispatch 3)
   - **Outcome:** Editing `prisma-next.config.ts` (including an on-disk change while it is not open in the editor) re-resolves the input set without a server restart: a newly-added input begins receiving diagnostics; a removed input (or one that falls under a non-`psl` `sourceFormat`) has its diagnostics cleared.
   - **Builds on:** Slice 2's server + config-resolution-at-`initialize`.
   - **Hands to:** Live config behaviour for one known config path, which dispatch 4 generalizes to multiple config-keyed projects.
   - **Focus:** `workspace/didChangeWatchedFiles` watcher registration on the config path (dynamic `client/registerCapability` or static in `InitializeResult`), re-resolution on change, and diagnostic add/clear fan-out. NOT watching schema files (explicit non-goal); ONLY the config path is watched.

4. **Slice `multi-project-lsp-registry`** — Linear: TML-2930 (dispatch 4)
   - **Outcome:** The language server maintains an in-memory project registry keyed by `prisma-next.config.ts` path. When a document opens, the server finds the nearest config covering that file, creates a project if one does not exist yet, resolves that project's schema inputs, and diagnoses the document only if it is a configured PSL input for that project. Existing config-change fan-out operates on the project identified by the changed config path.
   - **Builds on:** Dispatch 3's live config resolution and the config-loader nearest-config helper.
   - **Hands to:** Project-complete multi-project scaffold: one LSP server process can handle files from multiple Prisma Next projects in a workspace without assuming `initialize.rootUri` is the only project root.
   - **Focus:** Project registry/state model, didOpen project creation, per-config input membership, tests for two configs in one workspace and for newly-opened files under an unseen config. NOT using file extension as schema membership, NOT watching schema files, NOT adding hover/completion/navigation.

## Dependencies (external)

- [x] **Linear tracking** — project: Language Tools Support Prisma Next PSL (Terminal); issue: TML-2930. Per operator direction the scaffold is one issue, not one-per-slice; the three slices run as stacked dispatches under TML-2930.
- [ ] **`vscode-languageserver` + `vscode-languageserver-textdocument` dependency** — new third-party deps, landing in slice 2's new package. Operator-approved in spec (Resolved decisions); no blocker, flagged for the layering/CI gate.

## Sequencing rationale

Strictly serial because the dependency graph is strictly serial — there is no parallelisable group to surface:

- Slice 2 cannot identify schema documents without slice 1's shared config resolution (the whole reason slice 1 exists is the layering wall: the server package can't reach the CLI-private `loadConfig`).
- Slice 3 extends slice 2's already-running server and its config-resolution path; it has nothing to build against until slice 2 lands.
- Slice 4 extends slice 3's single-known-config live behavior into a registry keyed by config path; it depends on the existing diagnostic fan-out so the change stays about project ownership rather than parser or protocol mechanics.

Slices 2 and 3 were deliberately *not* merged: slice 2 is "config read once at `initialize`" — a complete, reviewable, demoable server on its own — and slice 3 is a clean additive increment (the watcher + re-resolution fan-out). Bundling them would put a substrate-shaped server scaffold and a distinct reactivity outcome in one review. Slice 1 was deliberately *not* folded into slice 2: lifting config resolution out of the CLI re-points several existing CLI consumers (`contract-emit`, `db-sign`, `db-verify`, `format`), a blast radius a reviewer should hold separately from the new server surface.

## Open items

_Architecture pivot recorded 2026-06-19: multi-project handling is now in scope. Dispatch 4 is ready for `drive-build-workflow`._
