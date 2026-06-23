# Manual QA — symbol-table-diagnostics (AC-7)

Verifies that the language server, as consumed by the playground, surfaces the new symbol-table diagnostics live in the browser editor. The automated equivalent (driving the real `prisma-next lsp --stdio` subprocess as an LSP client) is recorded in [`qa-run-report.md`](./qa-run-report.md); this script is the human-in-browser walkthrough.

**Consumer audiences:** (1) Prisma Next users authoring PSL in an editor wired to the language server; (2) `apps/lsp-playground` as the dev harness that exercises it.

## Prerequisites

1. Build the CLI (the playground bridge spawns its `dist/cli.js`):
   ```bash
   pnpm --filter @prisma-next/cli build
   ```

## Launch

2. Start the playground with a blank scratch schema:
   ```bash
   pnpm --filter @prisma-next/lsp-playground start
   ```
   (or `psl-playground`). Open the printed `http://localhost:5273/` URL.

## Steps & expected results

| # | Action | Expected |
| - | ------ | -------- |
| 1 | In the empty editor, type a clean schema: `model User {\n  id Int @id\n}` | No diagnostics (no gutter markers). |
| 2 | Append a second `model User { id Int @id }` (duplicate top-level name) | A `PSL_DUPLICATE_DECLARATION` marker ("Duplicate declaration of \"User\"") appears on the second declaration, live, without saving. |
| 3 | Rename the second model to `model Post` | The duplicate marker clears live. |
| 4 | Add a field with an over-qualified type, e.g. `owner a.b.c` | A `PSL_INVALID_QUALIFIED_TYPE` marker appears on that field. |
| 5 | Fix the type to a single qualifier (e.g. `owner String`) | The marker clears. |
| 6 | Introduce a pure syntax error (e.g. delete a closing `}`) | A parse-tier marker appears; the server does not crash and continues diagnosing after the next edit. |

## Pass criteria

- Symbol-table markers (steps 2, 4) render live alongside parse-tier markers, at the correct ranges, and clear on fix.
- The server never crashes on malformed/half-typed input (step 6).
- A clean schema shows no markers (steps 1, 3, 5).

## Recorded run

See [`qa-run-report.md`](./qa-run-report.md) — automated AC-7 run against the real `prisma-next lsp --stdio` subprocess (the exact binary the bridge spawns), default-postgres config: all three checks passed (`PSL_DUPLICATE_DECLARATION`, clear-on-fix → `[]`, `PSL_INVALID_QUALIFIED_TYPE`).
