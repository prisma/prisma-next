---
from: "0.16"
to: "0.17"
changes:
  - id: migration-contract-snapshots-moved-to-content-addressed-store
    summary: |
      Committed migration contract snapshots move from per-package sibling files
      (`start-contract.json` / `start-contract.d.ts` / `end-contract.json` /
      `end-contract.d.ts`) into a single content-addressed store per migrations
      root, at `migrations/snapshots/<hex>/contract.json` + `contract.d.ts`,
      where `<hex>` is the contract's storage hash with the `sha256:` prefix
      stripped. Every distinct contract is stored once, however many migrations
      reference it. An extension source repo keeps the shallow layout — migration
      packages sit directly under `migrations/` (no `app/` segment), so its store
      is `migrations/snapshots/` at the same depth, and every emitted
      `migration.ts` imports its bookend contracts one level up:
      `../snapshots/<hex>/contract.json` / `../snapshots/<hex>/contract.d.ts`
      (a consuming project's `app/`-nested migrations import two levels up,
      `../../snapshots/...` — do not copy that depth into an extension repo).
      This is a clean break: there is no fallback reader for the old sibling-file
      layout, so a committed migrations tree that has not been converted fails to
      load once you upgrade your extension's tooling — `migration plan` /
      `migration new` / `migration check` all read contract snapshots through the
      store only, and a missing store entry fails with
      `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the expected hash and path.
      `migration.json` / `ops.json` / `migrationHash` are unaffected — the
      contract snapshot was never part of migration identity, so converting the
      layout changes no migration's hash, and no extension-authoring SPI changes.
      To convert an existing extension repo, run the migrator once from a
      checkout of the `prisma/prisma-next` repository at (or above) the version
      you're upgrading to, pointed at your extension's migrations root:
      `node scripts/migrate-migrations-layout.mjs <path-to-your-migrations-dir>`.
      Per migration package, it reads `migration.json`, write-if-absents the
      destination contract (and the source contract, when present) into the
      store under the matching hash, rewrites the committed `migration.ts`
      import specifiers, and deletes the four sibling files. It asserts every
      contract's inner `storage.storageHash` against the hash it's filed under
      before writing anything (mismatch aborts the whole run, nothing is
      deleted), and re-verifies every `migrationHash` is unchanged after
      conversion. Run it, review the diff, then typecheck your extension package
      to confirm every rewritten `migration.ts` import resolves.
    detection:
      glob: "**/migration.ts"
      contains:
        - "./start-contract.json"
        - "./end-contract.json"
        - "./start-contract'"
        - "./end-contract'"
      anyMatch: true
  - id: ref-paired-snapshots-moved-to-content-addressed-store
    summary: |
      Ref-paired contract snapshot files (`refs/<name>.contract.json` /
      `refs/<name>.contract.d.ts`) are no longer written or read. A ref is now
      only its pointer file, `refs/<name>.json` (`{ hash, invariants }`); the
      contract it names resolves through the same content-addressed store as
      every migration graph node, `migrations/snapshots/<hex>/contract.json` +
      `contract.d.ts`, by that hash. Your extension repo's `migrations/refs/`
      normally carries only the system `head.json` pointer, which was never
      ref-paired — this only matters if your repo also carries named refs
      (e.g. from testing `ref set` against the extension's own migrations
      root). A pointer whose store entry is missing now fails with
      `MIGRATION.CONTRACT_SNAPSHOT_MISSING` naming the expected hash and path,
      rather than silently falling back to the migration graph. The same
      one-shot migrator that folds per-package sibling snapshots (see the
      entry above) also folds any existing `refs/<name>.contract.json` /
      `refs/<name>.contract.d.ts` pairs: it write-if-absents the pair into the
      store under the sibling pointer's `hash`, then deletes the pair — the
      pointer file itself is read but never written, so it stays
      byte-identical. A `.contract.json` with no sibling pointer, or whose
      inner `storage.storageHash` disagrees with the pointer's `hash`, aborts
      the whole run before anything is written or deleted. Run `node
      scripts/migrate-migrations-layout.mjs <path-to-your-migrations-dir>`
      (same invocation as above; one run folds both migration-package and
      ref-paired snapshots), then review the diff.
    detection:
      glob: "**/refs/*.contract.json"
      anyMatch: true
  - id: adopt-sql-json-projection-ast-foundations
    summary: Migrate relational AST construction and traversal to explicit JSON projection wrappers, expanded scalar-expression variants, grouped function-source aliases, and codec-preserving forwarded projections.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "JsonObjectExpr"
        - "JsonArrayAggExpr"
        - "ExprVisitor"
        - "AnyExpression"
        - "FunctionSource.of"
        - "ProjectionItem.of"
      anyMatch: true
---

## `adopt-sql-json-projection-ast-foundations`

Relational JSON container AST construction now requires an explicit value-projection variant. Import `NativeJsonValueProjection` from `@prisma-next/sql-relational-core/ast` and wrap every expression that 0.16 code passed directly to `JsonObjectExpr.entry(key, expression)` or `JsonArrayAggExpr.of(expression, ...)`: use `JsonObjectExpr.entry(key, new NativeJsonValueProjection(expression))` and `JsonArrayAggExpr.of(new NativeJsonValueProjection(expression), ...)`. `NativeJsonValueProjection` preserves the pre-0.17 target-native JSON conversion. Use `CodecJsonValueProjection` only when the extension deliberately supplies a `CodecRef` for codec-owned JSON conversion, and use `JsonDocumentProjection` only when the wrapped expression already produces a JSON document.

`ExprVisitor<R>` and the `AnyExpression` union now include `FunctionCallExpr` (`kind: 'function-call'`), `CastExpr` (`kind: 'cast'`), and `CaseExpr` (`kind: 'case'`). Add `functionCall`, `cast`, and `case` methods to every visitor object, and add all three discriminants to exhaustive `expr.kind` switches. Binding or rewriting visitors should route these nodes through their normal recursive expression path; restricted visitors such as grouped `HAVING` validators should reject them explicitly when the context does not support them.

`FunctionSource.of(fn, args, alias)` now groups alias state so returned-column aliases cannot exist without a table alias. Replace a string third argument such as `FunctionSource.of(fn, args, 'rows')` with `FunctionSource.of(fn, args, { alias: 'rows' })`; when returned-column names are required, pass `{ alias: 'rows', columnAliases: ['value', 'ordinality'] }`. Calls that omit the alias remain unchanged.

When an extension forwards an existing `ProjectionItem` through a derived-table or row-number wrapper, preserve its known codec in the reconstructed projection: use `ProjectionItem.of(item.alias, ColumnRef.of(wrapperAlias, item.alias), item.codec)`. Leave the codec undefined only for computed or otherwise unknown projected results. After applying the applicable edits, run the extension's typecheck and tests; update AST-shape fixtures to assert the explicit wrapper nodes and preserved codec metadata.
