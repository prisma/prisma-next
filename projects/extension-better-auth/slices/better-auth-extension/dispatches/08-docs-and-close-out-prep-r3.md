# Brief: D8 R3 (resumed) — QA fix-in-PR items

Manual-QA run (`projects/extension-better-auth/qa/qa-run-2026-07-13.md` — read F-1/F-3/F-4 in full for repro detail) produced zero Blockers but three fix-in-PR items:

- **F-1 (⚠️):** the committed better-auth space mirror in `examples/better-auth/migrations/better-auth/` (or wherever the QA report pins it) is stale post-merge — missing the `scalarList` capability stamp — so README step 2 dirties a fresh clone's tree while the CLI reports "No changes detected". Re-emit/re-seed the committed mirrors so a verbatim README run leaves the tree clean; extend the example test's byte-identical assertion to cover the space-mirror files that drifted (it caught the aggregate but not these).
- **F-3 (⚠️):** the example server crashes on a terminated idle pg connection — `examples/better-auth/src/prisma/db.ts` template has no pool `'error'` handler. Add the minimal handler (grep sibling examples/docs for the house pattern; if none, a logged no-op handler with a comment) — the example is a template users copy.
- **F-4 (📝, dispositioned fix-in-PR):** package README drift: `extensionPacks` vs `extensions` naming in one snippet, bare commands missing `pnpm` prefix, one error-message quote drifted from `errors.ts`. Correct against source (F12).

QA F-7 (verbatim journey yields `profile: null` right after the README promises a profile) — dispositioned accepted-as-is by QA, but judge it: if a one-line README correction (or example tweak) makes the promise true, do it under F-4's docs-accuracy umbrella; if it needs design work, leave + note.

Gates: example test (extended assertion) + example lint/typecheck; better-auth pkg lint if README touched; `pnpm fixtures:check`; fresh-clone simulation of README steps 1–3 leaving tree clean (the F-1 "fails iff" proof).
