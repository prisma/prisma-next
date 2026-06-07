---
from: "0.12"
to: "0.13"
changes: []
---

<!--
TML-2808: substrate change to the SQL/Mongo contract IR — storage
namespaces gained an `entries.<kind>` envelope and domain
cross-references (`base`, `relations.<R>.to`) lifted from bare model
strings to `{ namespace, model }` objects. Extension authors only feel
this if they hand-construct contract IR; the public framework
factories (`createNamespaceTable`, `crossRef`, etc.) and the
contract-builder produce the new shape directly. No codemod required.

TML-2817: internal refactor of @prisma-next/extension-mongo's
defineContract wrapper to eliminate bare casts via a shared bound
contract builder. No extension API or behaviour change; incidental
substrate diff only.

TML-2683: additive @prisma-next/sql-orm-client surface — polymorphic-
target `.include()` support (variant-shaped rows, `.variant()`
narrowing, variant-aware `where`/`first` predicates) plus a depth-2
nested-include decode fix. Existing extension call sites compile
unchanged: non-polymorphic include row types are unaffected by the
variant-union default widening, and no public API was removed or
renamed. No codemod required.

TML-2834: scaffolds the new `@prisma-next/extension-supabase` package.
Two enabling framework changes touch the SPI: (a) the emitter now
emits multi-namespace contracts — single-namespace `.d.ts` output is
byte-identical; multi-namespace contracts get a flattened top-level
`Models` map alongside per-namespace `domain.namespaces.<ns>.models`
(and `valueObjects`) blocks; (b) the migration aggregate loader now
accepts extension contract spaces that ship zero migration packages —
the head ref is read normally from the space's on-disk `head.json`
(written by `emitContractSpaceArtefacts`), and the graph-reachability
integrity check is gated on `member.packages.length > 0`. Both are
forward-compatible: migration-backed extensions (e.g. pgvector) are
unaffected; single-namespace single-migration-backed extensions
behave identically. No extension-author action required.
-->

# 0.12 → 0.13 — Extension-author upgrade instructions

No extension-author action required for this transition. The `defineContract` wrappers in the `@prisma-next/postgres` and `@prisma-next/sqlite` packages were refactored to be cast-free via a shared `buildBoundContract` helper in `@prisma-next/sql-contract-ts`; the consumer-facing API and emitted contract shapes are unchanged.
