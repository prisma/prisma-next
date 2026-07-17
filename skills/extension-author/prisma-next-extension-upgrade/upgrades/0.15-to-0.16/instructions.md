---
from: "0.15"
to: "0.16"
changes:
  - id: extension-supabase-test-utils-export-removed
    summary: |
      `@prisma-next/extension-supabase` no longer exports the `./test/utils` subpath
      (`bootstrapSupabaseShim`), and it is no longer a pattern to copy for extension test
      tooling. The import typechecked (types shipped in `dist`), but the subpath never worked
      from npm — the shim reads fixture `.sql` files that were never published, so every call
      failed with ENOENT before touching a database. Delete any import of
      `@prisma-next/extension-supabase/test/utils`; keep hermetic test helpers package-internal
      (tests import them by source path) rather than publishing them as subpath exports whose
      on-disk fixtures don't ship. For Supabase-shaped testing, use Supabase's own tooling
      (`supabase start` / `supabase db reset`, `supabase test db` with pgTAP).
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs}"
      contains:
        - "extension-supabase/test/utils"
      anyMatch: true
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

<!--
TML-3028 (dependency-graph migration ordering; SchemaDiffIssue.reason removed):
the migration-diff internal `SchemaDiffIssue` lost its `reason` field —
discriminate a diff issue via the presence of `expected`/`actual`, or the
exported `issueOutcome(issue): ExpectationFailureReason` helper from
`@prisma-next/framework-components/control`. `ExpectationFailureReason` keeps its
`'not-found' | 'not-expected' | 'not-equal'` values and its export path; it is now
the helper's return type rather than the removed field's type. This is a framework migration-control
internal, not an extension-authoring SPI. The `packages/3-extensions/` diff is
supabase-extension TEST assertions updated from `.reason` to presence — no runtime,
contract, SPI, or DDL change. Incidental test-only diff.
-->

<!--
TML-2783 (explicit MTI selections): `changes: []`. The `packages/3-extensions/sql-orm-client` diff is limited to internal polymorphic projection planning and regression tests; it changes no public API, contract/emitted artifact, extension-authoring surface, adapter API, or downstream source translation.
-->
