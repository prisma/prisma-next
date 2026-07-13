# Brief: D6 R3 (resumed) — F3 + typecheck-count confirmation

- **F3 (low / process):** in `test/integration/test/` better-auth `harness.helpers.ts`: (a) teardown comment cites TML-2995 — correct it to TML-3017 (the @prisma/dev close-hang ticket); (b) top docblock claims `runMigrations` "re-runs `db init`" — it's an intentional no-op; make the comment say what the code does. One comment-only commit.
- **Verify:** reviewer flagged workspace `pnpm typecheck` reporting 143 tasks this round vs 145 at D4/D5 — confirm whether 143 was a typo/filtered run or the true current task count (run it once and report the number; investigate only if it isn't explainable by turbo task graph changes).

Gates: integration package lint (comment edit), the one typecheck run.
