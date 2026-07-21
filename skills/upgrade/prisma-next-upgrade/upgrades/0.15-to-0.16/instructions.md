---
from: "0.15"
to: "0.16"
changes:
  - id: extension-supabase-test-utils-export-removed
    summary: |
      `@prisma-next/extension-supabase` no longer exports the `./test/utils` subpath
      (`bootstrapSupabaseShim`). The import typechecked (types shipped in `dist`), but the
      subpath never worked from npm — the shim reads fixture `.sql` files that were never
      published, so every call failed with ENOENT before touching a database. There is no
      working code to migrate: delete the import and whatever test setup called
      `bootstrapSupabaseShim`.
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

<!--
TML-3028 (dependency-graph migration ordering; SchemaDiffIssue.reason removed):
the migration-diff internal `SchemaDiffIssue` lost its `reason` field —
discriminate via the presence of `expected`/`actual`, or the exported
`issueOutcome(issue): ExpectationFailureReason` helper. `ExpectationFailureReason`
keeps its `'not-found' | 'not-expected' | 'not-equal'` values and its export path;
it is now the helper's return type rather than the removed field's type. This is a
framework migration-control internal, not an app-authoring surface. The
`examples/` diff is supabase-example TEST assertions updated from `.reason` to
presence — no runtime, contract, or DDL change. Incidental test-only diff.
-->

<!--
Supabase example env template (TML-2503): docs-only. The `examples/` touch adds
`examples/supabase/.env.example`, naming the two env vars the real-Supabase
acceptance lane already reads (`DATABASE_URL`, `SUPABASE_JWT_SECRET`). Nothing
loads the file — it documents what to export. No framework surface, contract
shape, or emitted artefact change. Incidental substrate diff only.
-->

<!--
Dependabot dev-deps group bump (PR #961): dev-dependency version bumps only
(biome 2.5.2, wrangler, @types/react, @cloudflare/* and friends), plus the
biome.jsonc schema-version alignment and the handful of code sites biome 2.5
newly flags (useOptionalChain / noProto in tests). The `examples/` diff is
package.json devDependency version ranges and biome.jsonc schema versions only —
no framework surface, contract shape, or emitted artefact changes. No user
action required. Incidental substrate diff only.
-->

<!--
Dependabot runtime-deps group bump (PR #1014): `changes: []`. Dependency version
bumps only. The `examples/` diff is package.json version ranges in the demo apps
(isbot in react-router-demo; @radix-ui/react-radio-group, @radix-ui/react-select,
lucide-react, postcss in retail-store) — dependencies of the example applications
themselves, not of any `@prisma-next/*` package. No framework surface, contract
shape, or emitted artefact change. No user action required. Incidental substrate
diff only.
-->
