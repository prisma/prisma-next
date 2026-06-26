# Brief: review-feedback-and-classifier-navigation

## Task

Address the open PR review feedback on PR #871 and refactor the PSL completion classifier so it uses the parser's existing red-tree / AST navigation primitives instead of repeatedly rediscovering context by traversing the whole tree. Preserve the already-delivered autocomplete semantics: model field type completions, namespace qualifier/member completions, generic block parameter completions, and declaration keyword completions with snippet/plain variants.

## Scope

**In:** `packages/1-framework/3-tooling/language-server/src/completion-context.ts`, its focused tests, and any parser syntax exports/helpers needed to use already-present navigation APIs cleanly; `packages/1-framework/3-tooling/language-server/src/server.ts` and tests if stale cached artifacts are still a real completion-path bug; `apps/lsp-playground/src/cli.ts` for the malformed `Host` / URL parsing review comment; small README/test updates only if necessary to keep docs truthful.

**Out:** Changing completion product semantics, adding ordinary `@` / `@@` attribute completions, changing PSL parser grammar, changing SQL interpreter namespace semantics, replying to or resolving GitHub review threads, broad parser rewrites, and unrelated playground/server cleanup.

## Completed when

- [ ] Each unresolved review comment fetched from PR #871 is implemented or explicitly reported as not applicable in the dispatch wrap-up; do not post replies to GitHub.
- [ ] `completion-context.ts` uses existing red-tree / AST navigation methods for token/node context instead of avoidable repeated whole-tree scans, and removes unused / over-complicated helper state called out in review.
- [ ] Tests cover any behavior changed to refresh completion artifacts from the current buffer and preserve classifier behavior after the navigation refactor.
- [ ] Language-server and playground validation gates listed in the slice plan pass, or any failure is reported with the failing command and relevant error.

## Standing instruction

Stay focused on review feedback and classifier navigation quality. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you into completion semantics redesign, namespace resolution policy, or parser grammar changes halts and surfaces.

## References

**Slice-loop dispatch:**

- Slice spec: `projects/lsp-autocomplete/slices/top-level-keyword-completions/spec.md` — chosen design + coherence rationale + slice-DoD.
- Slice plan entry: `projects/lsp-autocomplete/slices/top-level-keyword-completions/plan.md` § Dispatch 2 — outcome / builds-on / hands-to / focus.
- Prior dispatch artifacts in this slice: `projects/lsp-autocomplete/slices/top-level-keyword-completions/dispatches/01-declaration-keyword-completions.md`.
- Project spec: `projects/lsp-autocomplete/spec.md` — especially the no completion-marker reparsing constraint and the requirement to use cached parser artifacts / red-tree cursor utilities.
- PR: https://github.com/prisma/prisma-next/pull/871.

**Open review comments fetched before dispatch:**

- `packages/1-framework/3-tooling/language-server/src/server.ts` line 299, CodeRabbit: refresh artifacts from current `document.getText()` before classifying completions if the cached artifact can be stale.
- `apps/lsp-playground/src/cli.ts` line 199, CodeRabbit: stop using incoming `Host` header as the URL parsing base; parse against a fixed local base or return 400 on parse failure.
- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` line 27, SevInf: question whether that type/member is needed.
- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` line 85, SevInf: property is not used anywhere.
- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` line 100, SevInf: use `SyntaxNode` sibling navigation methods rather than reinventing sibling lookup.
- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` line 638, SevInf: use binary search if `SyntaxNode` allows indexed children access.
- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` line 643, SevInf: condition seems to only need “offset directly at end of current token”.
- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` line 661, SevInf: simplify object construction; explicit `undefined` property values are acceptable.
- `packages/1-framework/3-tooling/language-server/src/completion-context.ts` line 677, SevInf: check whether parser module already has a helper for this.

## Operational metadata

- **Model tier:** mid — this is a focused code-quality refactor with tests across two packages, not a broad architecture redesign.
- **Time-box:** 90 minutes wall-clock. Overrun → halt and report exact remaining work.
- **Halt conditions:** Halt if the desired refactor requires changing parser grammar, if the completion semantic contract becomes ambiguous, if more than one parser package API must be redesigned, if validation exposes unrelated failures, or if you need to reply to GitHub comments.
