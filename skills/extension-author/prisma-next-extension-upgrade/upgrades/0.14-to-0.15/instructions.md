---
from: "0.14"
to: "0.15"
changes: []
---

<!--
TML-2787 (M:N slice 3): namespace-scoped execution-default refs land in
`@prisma-next/sql-orm-client` (nested writes through a junction, the
required-payload gate, and the namespace-keyed `ExecutionMutationDefault.ref`).
The changes are internal to the ORM client and its emitted-contract consumption;
the extension-author surface is unchanged. No extension-author action — re-emit
picks up the new contract ref shape. Incidental substrate diff only.

TML-2929 (replace legacy PSL parser with CST symbol table): the SQL/Mongo PSL
interpreters now consume a symbol table built from the CST parser instead of the
legacy `parsePslDocument` AST. The only `packages/3-extensions/` touch is a
test-file call-shape rewire in `postgres/test/psl-namespace-qualifier-routing.test.ts`
(`{ document }` → the symbol-table interpreter input); no extension-author API
changed. No extension-author action. Incidental substrate diff only.

TML-2794 (M:N slice 5): wires the `mn-psl` integration fixture into the
`@prisma-next/sql-orm-client` test `emit` script. Test-fixture infrastructure
only; no extension-author surface change. Incidental substrate diff only.

TML-2868 (Postgres RLS slice 1): adds the additive Postgres row-level-security
authoring feature. The only `packages/3-extensions/` touches are the re-emitted
`supabase/src/contract/contract.d.ts` (regeneration picks up the new RLS-capable
contract shape) and the `supabase/test/supabase-bootstrap.ts` test helper. No
extension-author API changed — the framework SPI is unchanged and re-emit
absorbs the contract shape. Incidental substrate diff only.

TML-2884 (Mongo enum end-to-end vertical): adds the Mongo domain-enum authoring
surface. The `packages/3-extensions/mongo/` touches are:
- New `mongo/src/contract/enum-type.ts` and exports in `mongo/src/exports/contract-builder.ts`
  (`enumType`, `member`, `EnumTypeHandle`, `EnumMember`) — all net-new exports; nothing
  existing was changed or removed.
- `mongo/src/runtime/mongo.ts` gains a `db.enums` facade property — an additive
  field on `MongoClient`; existing fields are unchanged.
- `mongo/package.json` gains `@prisma-next/emitter` and `@prisma-next/mongo-emitter`
  devDependencies for the new e2e test.
- `packages/3-extensions/sqlite/src/runtime/sqlite.ts` replaces the inline
  `NamespacedEnums<TContract>[UNBOUND_NAMESPACE_ID]` with the new `UnboundEnumsOf<TContract>`
  alias — structurally identical; no change to the `SqliteClient.enums` shape.
The `EnumTypeHandle` brand changed from a `Symbol()` to a string-key phantom (`__prismaNextEnumTypeHandle__`);
extension authors never construct or assert against the brand directly, so the structural surface
is unchanged. No extension-author action required — the enum surface is purely additive and
re-emit absorbs the new contract shape. Incidental substrate diff only.
-->
