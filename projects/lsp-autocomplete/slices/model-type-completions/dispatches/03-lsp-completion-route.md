# Brief: lsp-completion-route

## Task

Wire the language-server completion request path for configured PSL inputs. The server should advertise completion support, route `textDocument/completion` requests through Dispatch 1's classifier and Dispatch 2's provider, and return `[]` for unconfigured, missing, artifact-less, or unsupported contexts.

## Scope

**In:**

- `server.ts` completion capability advertisement in the initialize response.
- `connection.onCompletion(...)` request handler for open, configured PSL documents.
- Reuse of existing open-document lookup, configured-input gating, cached `DocumentAst` / `SourceFile`, and current project `SymbolTable` artifacts.
- Calling the existing model field type context classifier and provider dispatcher.
- Empty completion results for unconfigured documents, missing documents, unavailable artifacts, parse/artifact gaps, and unsupported classifier contexts.
- Server test harness helper for completion requests, analogous to the existing diagnostics/formatting helpers.
- Server tests for completion capability advertisement, configured model field type completions, unconfigured documents returning `[]`, and unsupported contexts returning `[]`.
- Preservation of existing diagnostics and formatting behavior.

**Out:**

- Generic block entry/parameter completions.
- Ordinary PSL `@` / `@@` attribute completions or attribute argument completions.
- Relation-aware completions.
- Changes to candidate extraction ordering or filtering beyond integration fixes strictly required by the server route.
- Creating a new external contract-space symbol index.
- Parser behavior changes, parser public exports, or completion-marker reparsing.
- Documentation updates; those are Dispatch 4.

## Completed when

- [ ] Server initialize tests prove `completionProvider` is advertised without regressing existing capabilities.
- [ ] Server completion tests prove a configured PSL document returns expected model field type completion labels at a type position.
- [ ] Server completion tests prove an unconfigured document returns `[]`.
- [ ] Server completion tests prove an unsupported context, including at least one ordinary PSL attribute context if easy to add here, returns `[]`.
- [ ] Existing diagnostics and formatting server tests still pass.
- [ ] Validation gates pass or any blocker is surfaced with concrete evidence.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

**Slice-loop dispatch:**

- Slice spec: `projects/lsp-autocomplete/slices/model-type-completions/spec.md`
- Slice plan entry: `projects/lsp-autocomplete/slices/model-type-completions/plan.md` § Dispatch 3: lsp-completion-route
- Dispatch 1 hand-off: `packages/1-framework/3-tooling/language-server/src/completion-context.ts` and `packages/1-framework/3-tooling/language-server/test/completion-context.test.ts`
- Dispatch 2 hand-off: `packages/1-framework/3-tooling/language-server/src/completion-provider.ts` and `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts`
- Project spec / plan: `projects/lsp-autocomplete/spec.md`, `projects/lsp-autocomplete/plan.md`
- Code review log: `projects/lsp-autocomplete/reviews/code-review.md`
- Relevant code surfaces:
  - `packages/1-framework/3-tooling/language-server/src/server.ts`
  - `packages/1-framework/3-tooling/language-server/src/project-artifacts.ts`
  - `packages/1-framework/3-tooling/language-server/src/pipeline.ts`
  - `packages/1-framework/3-tooling/language-server/test/server.test.ts`

## Operational metadata

- **Dispatch ID:** `0fb30343-7c83-48d5-af0a-c7e9dbfb771b`
- **Round ID:** `c3095776-c25f-4d4c-b780-f50cab74c1a3`
- **Model tier:** `implementer/fast` — routine language-server integration work within a slice; reuse the existing implementer session.
- **Time-box:** 90 minutes wall clock. Overrun means halt and surface current state rather than broadening scope.
- **Halt conditions:**
  - Completion routing requires parser behavior changes, parser public exports, or completion-marker reparsing.
  - Server tests require implementing generic block completions, ordinary attribute completions, attribute argument completions, relation-aware completions, or an external contract-space symbol index.
  - Candidate extraction needs a scope expansion rather than a small integration fix.
  - Validation gates fail for reasons that look unrelated to this dispatch.

## Validation gates

- `pnpm --filter @prisma-next/language-server test`
- `pnpm --filter @prisma-next/language-server typecheck`
- `pnpm --filter @prisma-next/language-server lint`
