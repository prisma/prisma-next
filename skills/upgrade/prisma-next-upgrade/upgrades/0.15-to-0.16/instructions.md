---
from: "0.15"
to: "0.16"
changes: []
---

<!--
TML-3027 (foreign keys and indexes are discrete contract entities): emitted
contract-shape change. `contract emit` now materializes the per-FK `constraint`/
`index` authoring booleans into discrete entities — a `foreignKeys[]` entry is the
referential constraint only (no `constraint`/`index` fields), and every backing
index (including one backing a FK) is its own named `indexes[]` entry. The booleans
remain as authoring input (`@relation(index:)`, TS `fk({ constraint, index })`,
`foreignKeyDefaults`). Every FK-bearing `contract.json` / `contract.d.ts` in the
repo re-emits to the new shape (the `examples/` diff is that regeneration); a
downstream `contract emit` picks it up automatically with no source change. The
only caller-visible break is TypeScript that reads `.constraint` / `.index` off a
contract's `foreignKeys[]` entry (contract internals, not an app-authoring
surface) — those fields are gone; read the discrete `indexes[]` entry instead. No
migration or DDL change: the schema the planner and `db verify` derive is
identical.
-->

<!--
Supabase integration close-out (TML-2503): docs-only. The `examples/` touch is
`examples/supabase/README.md` — a link into the deleted
`projects/supabase-integration/` workspace removed. No framework surface,
contract shape, or emitted artefact change. Incidental substrate diff only.
-->
