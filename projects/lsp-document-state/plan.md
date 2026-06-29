# lsp-document-state — Plan

**Spec:** `projects/lsp-document-state/spec.md`
**Linear Project:** pending (Terminal team) — create before the slice opens its PR.

## At a glance

Single-slice project. The whole settled design — invalidate-on-change, lazy synchronous `ensureCurrent` materialize-on-read, one per-project cache feeding every read, and pull diagnostics with a push fallback — lands as one reviewable PR. It is one slice because the pieces are coupled: dropping eager compute on change is only safe once diagnostics are served by pull, so lifecycle and transport must move together.

## Composition

### Stack (deliver in order)

1. **Slice `lazy-state-and-pull-diagnostics`** — Linear: pending
   - **Outcome:** The language server invalidates on change and materializes derived state lazily and synchronously via `ensureCurrent` (version-keyed off `TextDocument.version`), every read feature consumes one per-project cache, `currentDocumentArtifact` and the per-request reparse are gone, and diagnostics are served by `textDocument/diagnostic` (capability-gated, push retained only as the non-pull fallback). `TextDocuments` is kept.
   - **Builds on:** The existing language-server package (`server.ts`, `project-artifacts.ts`, `document-diagnostics.ts`), the `Project`/artifact abstraction, and `vscode-languageserver@10`'s pull-diagnostics API.
   - **Hands to:** Project close-out — the document-state lifecycle is correct-by-construction and the diagnostics transport is aligned with it; the project-scoped seam is in place for the future multi-input table.
   - **Focus:** Add `ensureCurrent`; re-point completion / semantic tokens / folding at it; delete `currentDocumentArtifact`; make `didChange` invalidate-only; advertise `diagnosticProvider` + register the pull handler; capability-gate pull vs push; drop eager `publish` on the pull path; issue `workspace/diagnostic/refresh` on config/watched-file change; keep `TextDocuments`; advertise `interFileDependencies: false` / `workspaceDiagnostics: false` with the scope comment; tests; playground pull-markers QA.

### Parallel groups

None — single slice.

## Dependencies (external)

- [ ] Linear Project (Terminal team) — create before PR open.
- [x] `vscode-languageserver@10` pull-diagnostics API available (confirmed in `pnpm-workspace.yaml` catalog).
- [x] Playground client supports pull diagnostics (`monaco-languageclient@10` / `vscode-languageclient@9` / `@codingame/monaco-vscode-api@25`).

## Sequencing rationale

The lifecycle change (lazy `ensureCurrent`) and the diagnostics-transport change (pull) are not independently shippable as a clean end state: a "lifecycle-only" step that kept push would still compute diagnostics eagerly on change, so the lazy invalidate-only model wouldn't actually hold. They therefore land together as one slice. Internal dispatch ordering (lifecycle seam first, transport second) is the slice plan's job, not the project plan's.

## Sanity check

- One slice; passes slice-INVEST (one coherent PR a reviewer holds in a sitting: one package, one architectural idea — invalidate + lazy + pull).
- Every project-DoD condition is reachable from this slice.
