# Dispatch D4 — Round 2 re-brief (resume)

Resume of D4. Your prior commits (`fb9ec5ecf`, `df9a664ac`) are accepted; workspace typecheck is green post-build. One low/process finding to fix.

## Finding to address

**F2 (low / process) — transient slice reference in a code comment.**

`packages/2-sql/9-family/src/core/schema-verify/verifier-disposition.ts:50` — the comment marking the RLS classifications provisional cites the transient orchestration handle "slice 4". Source comments must not reference transient project planning artefacts (the `no-transient-project-ids-in-code` rule's principle; the regex didn't flag it because it's prose, not an `M2`/`CKPT-2` token, but it's the same class of leak).

**Resolution required:** reword the comment to keep the *intent* — that these classifications are provisional and should be confirmed when the verifier actually emits these kinds — without naming a slice/phase. E.g. "Provisional categories; confirm once the verifier emits these RLS issue kinds." No code change, just the comment.

## Validation gates (run once at end)

- `pnpm typecheck` (the touched package at minimum; workspace already proven green post-build).
- `pnpm lint:deps`.

Re-run the transient-ID scan on your new `+` diff to confirm the leak is gone and no new one was introduced.

## Constraints

Explicit-staging commit, `tml-2868:` prefix, no amend (new commit), no push. Read-only on review/spec/plan. Heartbeat to `wip/heartbeats/implementer.txt`. Return: the reworded comment + commit SHA.
