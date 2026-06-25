# Brief: scope-docs-and-final-guardrails

## Task

Finish the `model-type-completions` slice by documenting the newly supported narrow completion scope and ensuring the final guardrails protect against scope creep. The README should no longer say completion is wholly unsupported, but it must be precise: slice 1 supports configured PSL model field type completions only.

## Scope

**In:**

- Update `packages/1-framework/3-tooling/language-server/README.md` to describe the supported completion surface.
- Document that completion is available only for configured PSL inputs and only at model field type positions.
- Document candidate sources accurately: configured scalar types plus visible model/composite/scalar/type-alias candidates from the current project symbol table, including namespace-qualified and contract-space-qualified type-position syntax when candidates are visible in current artifacts.
- Explicitly document exclusions: generic block entry/parameter completions, ordinary PSL `@` / `@@` attribute completions, attribute argument completions, relation-aware completions, and new external contract-space candidate discovery are not part of slice 1.
- Add or verify final server-level guardrail coverage for ordinary attribute contexts returning `[]`; if Dispatch 3 already added sufficient coverage, keep it and only add a narrowly useful missing assertion.
- Preserve existing diagnostics, formatting, and completion route behavior.

**Out:**

- Implementing generic block entry/parameter completions.
- Implementing ordinary PSL `@` / `@@` attribute completions or attribute argument completions.
- Implementing relation-aware completions.
- Adding or changing candidate extraction semantics beyond fixing a discovered guardrail gap.
- Creating a new external contract-space symbol index.
- Parser behavior changes, parser public exports, or completion-marker reparsing.
- Broad documentation rewrites unrelated to the language-server completion scope.

## Completed when

- [ ] The language-server README accurately describes configured PSL model field type completion support.
- [ ] The README explicitly excludes generic block completions, ordinary attribute completions, attribute argument completions, relation-aware completions, and external contract-space candidate discovery unless future slices add them.
- [ ] Server-level guardrail coverage proves ordinary attribute contexts return `[]` through the LSP route, either by existing Dispatch 3 coverage or a focused D4 test addition.
- [ ] No implementation scope is broadened while editing docs/guardrails.
- [ ] Validation gates pass or any blocker is surfaced with concrete evidence.

## Standing instruction

Stay focused on slice close-out. Do not use this dispatch to improve or reshape the provider, classifier, parser, symbol table, or LSP route unless a concrete guardrail failure proves a tiny fix is required.

## References

**Slice-loop dispatch:**

- Slice spec: `projects/lsp-autocomplete/slices/model-type-completions/spec.md`
- Slice plan entry: `projects/lsp-autocomplete/slices/model-type-completions/plan.md` § Dispatch 4: scope-docs-and-final-guardrails
- Dispatch 1 hand-off: `packages/1-framework/3-tooling/language-server/src/completion-context.ts`
- Dispatch 2 hand-off: `packages/1-framework/3-tooling/language-server/src/completion-provider.ts`
- Dispatch 3 hand-off: `packages/1-framework/3-tooling/language-server/src/server.ts` and `packages/1-framework/3-tooling/language-server/test/server.test.ts`
- Project spec / plan: `projects/lsp-autocomplete/spec.md`, `projects/lsp-autocomplete/plan.md`
- Code review log: `projects/lsp-autocomplete/reviews/code-review.md`
- Relevant docs/tests:
  - `packages/1-framework/3-tooling/language-server/README.md`
  - `packages/1-framework/3-tooling/language-server/test/server.test.ts`

## Operational metadata

- **Dispatch ID:** `8c39fcaa-7306-425f-982b-fd5b4f7cdc5c`
- **Round ID:** `dc7ce623-26b7-41fb-9b78-34b6962a7269`
- **Model tier:** `implementer/fast` — focused documentation and final guardrail work; reuse the existing implementer session.
- **Time-box:** 45 minutes wall clock. Overrun means halt and surface current state rather than broadening scope.
- **Halt conditions:**
  - Documentation accuracy requires changing product scope or resolving a new design question.
  - Guardrail coverage requires implementing generic block completions, ordinary attribute completions, attribute argument completions, relation-aware completions, external contract-space indexes, parser changes, or marker reparsing.
  - Validation gates fail for reasons that look unrelated to this dispatch.

## Validation gates

- `pnpm --filter @prisma-next/language-server test`
- `pnpm --filter @prisma-next/language-server typecheck`
- `pnpm --filter @prisma-next/language-server lint`
