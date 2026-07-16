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
`foreignKeyDefaults`). An extension whose contract declares FKs re-emits to the new
shape on the next `contract emit`, with no authoring change. Extension code that
reads `.constraint` / `.index` off a contract's `foreignKeys[]` entry (e.g. custom
migration/verify logic or a hand-built contract fixture) must drop those fields and
read the discrete `indexes[]` entry instead. No SPI or DDL change: the schema-IR the
planner and `db verify` derive is identical. (The `packages/3-extensions/` diff is
pgvector test fixtures updated to the new FK literal shape.)
-->

<!--
Supabase integration close-out (TML-2503): docs-only. The
`packages/3-extensions/` touch is `packages/3-extensions/supabase/README.md` —
links into the deleted `projects/supabase-integration/` workspace re-pointed at
ADR 237 (the service_role secondary-root decision) or inlined as plain text.
No SPI, contract shape, or emitted artefact change. Incidental substrate diff
only.
-->
