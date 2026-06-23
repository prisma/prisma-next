# lsp-diagnostic-extend

## Purpose

Give Prisma Next users live, in-editor validation that matches what the build reports for PSL syntax and symbol resolution — surfacing the duplicate-declaration, invalid-qualified-type, and extension-block errors that the LSP scaffold's temporary parse-only stopgap left invisible until emit time. Editing PSL should fail fast at the cursor, not at the command line.

## At a glance

The TML-2930 scaffold stood up `prisma-next lsp --stdio`, but it diagnoses one tier only: it calls `parse(text).diagnostics` and publishes those. Symbol-table and interpretation diagnostics were ignored — a deliberate **short-term stopgap for the scaffold, not a long-term decision**.

This project lifts the stopgap for the **symbol-table tier** by giving the language server first-class ownership of the PSL pipeline's intermediate stages. The server runs the stages itself, against the live editor buffer:

```text
buffer text
  ─► parse(buffer)            → CST/AST          + parse diagnostics        (tier 1, already published)
  ─► buildSymbolTable(...)    → symbol table     + symbol-table diagnostics (tier 2, NEW)
```

Before — only syntax errors light up. After — a second `model User {}` flags `PSL_DUPLICATE_DECLARATION`, `ns.sub.Type` flags `PSL_INVALID_QUALIFIED_TYPE`, and an unknown extension-block parameter flags `PSL_EXTENSION_UNKNOWN_PARAMETER`, all at the cursor, all matching what `contract emit` would say.

Crucially, we run the **individual stages in the LSP rather than calling the provider's `load()`**. `load()` reads from disk (wrong for an unsaved buffer) and returns a whole `Contract` we don't need. More importantly, the CST/AST and symbol table are the substrate that future LSP features — completion, semantic tokens, go-to-definition — are built on. Owning the stages now means those features consume real artifacts later instead of forcing a re-architecture.

The stages the server can own are target-agnostic and already framework-domain: `parse` and `buildSymbolTable` live in `@prisma-next/psl-parser`; the `scalarTypes` and `pslBlockDescriptors` they need come from `createControlStack(config)` in `@prisma-next/framework-components/control`. No target package is imported, so the server stays target-neutral and `lint:deps` stays clean.

## Non-goals

- **Not calling the contract source provider's `load()`.** The server composes the stages itself against the buffer.
- **No interpretation-tier (PSL → Contract) diagnostics in this project.** These are *reachable* — the server can resolve them the same config-borne way the CLI does (`createControlStack(config)` plus the config's `contract.source` provider; no static target import). They are deferred **by choice**, to keep this project on the parse + symbol-table substrate. Bringing them in cleanly would mean factoring a granular, buffer-friendly interpret seam onto the provider (a `@prisma-next/config` contract-surface change) — its own piece of work (see *Place in the larger world → Future path*).
- **No change to the `ContractSourceProvider` contract** (`@prisma-next/config`). A benefit of not calling `load()` is that we touch no contract surface.
- **No new LSP capabilities** — no completion, semantic tokens, hover, go-to-definition, rename. The stages are *structured to enable* them; none ship here.
- **No editor extension / VS Code client packaging.**
- **No multi-root / multi-project workspaces; no TypeScript contract source.** Same boundaries the scaffold set.
- **No cross-file symbol resolution.** Diagnosis stays per-open-document, as today.

## Place in the larger world

- **Parent effort:** Linear project *Language Tools Support Prisma Next PSL* — vision: "open a Prisma Next project in VS Code; validation works, go-to-source works, autocomplete works." This project advances the "validation works" leg and lays the substrate for the others.
- **Builds directly on:**
  - TML-2930 (`lsp-scaffold`) — the `prisma-next lsp` subcommand, `@prisma-next/language-server`, config-driven schema identification, parse-tier diagnostics. Its ADR records the "version-matched CLI subcommand, one server per project" decision; this project's ADR extends that line.
  - TML-2929 — the CST parser + `buildSymbolTable` resolution layer this project consumes.
- **Stage sources (all target-agnostic, all already importable by Framework/tooling):**
  - `@prisma-next/psl-parser` — `parse` (CST/AST) and `buildSymbolTable` (symbol table + tier-2 diagnostics).
  - `@prisma-next/framework-components/control` — `createControlStack(config)`, which yields `authoringContributions.pslBlockDescriptors` and `scalarTypeDescriptors` from a loaded config without any target import.
- **Parity reference (not a dependency):** the contract-psl providers (`packages/2-sql/2-authoring/contract-psl`, `packages/2-mongo-family/2-authoring/contract-psl`) compose exactly `parse → buildSymbolTable → interpret`. Tier-1/tier-2 diagnostics the server publishes must match what these providers emit for the same source.
- **Sandbox app:** `apps/lsp-playground` (browser CodeMirror editor → WebSocket bridge → `prisma-next lsp --stdio`). It is the manual-QA surface; its `default-config.ts` already anticipates this change ("the full postgres pipeline is wired for fidelity but not exercised for diagnostics").
- **Future path (interpretation tier, out of scope here):** research established that the interpreter is reached, in every CLI command, through exactly one config-borne seam — `config.contract.source.load(sourceContext)`, with `sourceContext` built from `createControlStack(config)` — and that only `contract emit` invokes it (everything else reads the emitted `contract.json`). The interpreters are captured solely inside the `prismaContract` / `mongoContract` closures; the target descriptor exposes no interpret hook. A consumer therefore reaches interpretation **without a static target import**, exactly as the CLI does. The two frictions that keep it out of this project: `load` reads from disk (the LSP needs the live buffer), and `load` is monolithic (it re-runs parse + symbol table, duplicating the stages this project has the LSP own). The follow-on should factor a granular, config-borne `interpret(symbolTable, context)` seam that `load` and the LSP both compose.
- **Contract-impact:** none. No change to `ContractSourceProvider` or any contract surface. (The deferred interpretation tier *will* require a buffer-aware provider entry-point when it lands — see *Future path* above — but that is a later project.)
- **Adapter-impact:** none. Target-agnostic by construction; no `packages/3-targets/**` changes. The relevant constraint is the inverse: the server must acquire no target-domain dependency.

## Cross-cutting requirements

- **No static target dependency.** `@prisma-next/language-server` depends only on `@prisma-next/psl-parser` (parse + `buildSymbolTable`) and `@prisma-next/framework-components/control` (`createControlStack`) for the pipeline; never a static import of `@prisma-next/sql-contract-psl`, `@prisma-next/mongo-contract-psl`, or any target domain. Target-specific data (`scalarTypes`, `pslBlockDescriptors`) is reached only through the config-derived control stack, not an import. `pnpm lint:deps` clean throughout.
- **Buffer, not disk.** Every stage runs against the in-memory document buffer, never `readFile`. This is the reason `load()` is not called.
- **Stages are addressable artifacts, not locals.** The CST/AST and symbol table are exposed through a typed seam a future slice can consume, not buried inside the diagnostics function. "Could a completion feature reuse this without re-architecting?" is the design test.
- **Build parity.** For any source, the tier-1 + tier-2 diagnostics the server publishes match the codes, messages, and ranges the contract-psl providers produce for that source.
- **Control-stack lifecycle.** The control stack is built once per config and cached, reusing the scaffold's existing config-resolution + config-watch lifecycle; it is not rebuilt per keystroke, and it invalidates when the config changes.
- **Fault tolerance preserved.** A malformed or half-typed buffer never crashes the server. `buildSymbolTable` is documented never to throw on malformed input; that guarantee must hold end-to-end.

## Transitional-shape constraints

- Every merged slice keeps CI green on the working branch, with `origin/main` synced before the final validation + push.
- `apps/lsp-playground` works end-to-end after every slice — opening a schema and editing it shows live diagnostics. It is the manual-QA gate, so it cannot be left broken between slices.
- No regression to the existing parse-tier diagnostics at any point; tier-2 is additive.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md) — build, typecheck, per-package lint, tests, `fixtures:check`, doc maintenance, Linear close-out, manual-QA roll-up, ADR audit).
- [ ] Opening or editing a configured PSL input publishes parse **and** symbol-table diagnostics live: a duplicate declaration, an invalid qualified type, and an unknown extension-block parameter each surface at the cursor; fixing each clears its marker; a clean document publishes an empty set.
- [ ] The published symbol-table diagnostics match the codes, messages, and ranges the contract-psl provider produces for the same source (parity asserted by test).
- [ ] The CST/AST and symbol table are exposed through a typed, documented seam intended for reuse by future LSP features — not inlined into the diagnostics path.
- [ ] `@prisma-next/language-server` has acquired no target-domain dependency; `pnpm lint:deps` is clean and the absence is asserted (architecture config / dep test).
- [ ] `apps/lsp-playground` runs end-to-end against its default-postgres config with the new diagnostics (`drive-qa-plan` script + ≥1 `drive-qa-run` report).
- [ ] An ADR records the "language server owns the PSL pipeline stages; target-agnostic; one server per project" decision, extending the TML-2930 ADR line.

## Resolved Decisions

_All confirmed by the operator; settled, carried into planning._

1. **Control-stack build cost.** `createControlStack(config)` runs once per config, cached and invalidated on the existing config watch — acceptable for the playground's default-postgres config. No warm-up needed unless first-diagnose latency proves otherwise.
2. **Multi-input schemas.** Diagnose per open document, building the symbol table from that document alone (matching the scaffold's per-document model). Cross-file symbol resolution is deferred.
3. **Linear tracking.** A new issue under *Language Tools Support Prisma Next PSL*, on the existing `lsp-diagnostic-extend` branch.

## References

- Linear Project: [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c)
- Predecessor issues: [TML-2930](https://linear.app/prisma-company/issue/TML-2930) (lsp-scaffold + ADR), [TML-2929](https://linear.app/prisma-company/issue/TML-2929) (CST parser + symbol table)
- Stage sources: `packages/1-framework/2-authoring/psl-parser` (`parse`, `buildSymbolTable`), `packages/1-framework/1-core/framework-components/src/control/control-stack.ts` (`createControlStack`)
- Current server: `packages/1-framework/3-tooling/language-server` (`document-diagnostics.ts`, `server.ts`, `config-resolution.ts`)
- Parity reference: `packages/2-sql/2-authoring/contract-psl/src/provider.ts`, `packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts`
- Sandbox: `apps/lsp-playground`
- ADRs: TML-2930 close-out ADR (version-matched subcommand, one server per project) — to be extended by this project's ADR.
