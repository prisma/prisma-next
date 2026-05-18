# Manual QA report — TML-2520 (PR2: namespace exemplar + cross-namespace FKs) — 2026-05-17

> **Script:** `projects/target-extensible-ir/manual-qa/pr2.md` (commit `ee0b209baf38dc364350e919f8e8be01f3f8e0d6` at run time)
> **Runner:** cursor-sonnet-46 (Cursor IDE agent, Sonnet 4.6)
> **Environment:** macOS darwin 25.3.0, Node v24.13.0, branch `tml-2520-pr2-namespace-exemplar-cross-namespace-fk-references-follow` @ `ee0b209ba`; no live Postgres (DATABASE_URL absent); PGlite-only for demo
> **Started / finished:** 2026-05-17T15:02:00Z / 2026-05-17T15:25:00Z (approx)
> **Verdict:** ❌ Fail

## Summary

PR2's core namespace behaviour is correct across every tested surface: the demo emits a properly nested two-namespace contract, migration ops include `CREATE SCHEMA "auth"` first, cross-namespace FKs carry the right `namespaceId`, the SQLite rejection fires with a clear diagnostic, the `unbound` reservation is enforced with an actionable message, and the canonical-shape strict throw names the offending key. However, 20 of 21 tests in `packages/2-sql/2-authoring/contract-ts/test/contract.parameterized-types.test.ts` are failing because those tests construct flat-shape contract JSON (`storage.tables.User = StorageTable`) that the PR2 validator now rejects as a namespace-ID-level mismatch. This is a ⚠️ High test-suite regression that needs to be fixed before merge. No 🛑 Blocker (original-bug regression or negative-control failure) was observed.

## Findings

### F-1 — ⚠️ High — `contract.parameterized-types.test.ts` fails: 20/21 tests broken by PR2 schema change

**Scenario:** Observed during Scenario 2 (TS builder exploration; tests in the same package)
**Step:** Running `pnpm test` in `packages/2-sql/2-authoring/contract-ts`
**Oracle:** The package's test suite should pass
**Observed:**
```
pnpm test (packages/2-sql/2-authoring/contract-ts)

FAIL  test/contract.parameterized-types.test.ts
ContractValidationError: Contract structural validation failed:
  storage.tables.User.columns.namespaceId must be a string (was missing);
  storage.tables.User.columns.columns must be an object (was missing);
  storage.tables.User.columns.foreignKeys must be an array (was missing);
  ... [25+ errors per test, all the same pattern]
Tests: 20 failed | 1 passed (21)
Exit: 1
```

**Root cause:** The tests construct flat-shape contract JSON:
```
storage: { tables: { User: { columns: { id: ... }, primaryKey: { columns: ['id'] }, ... } } }
```
But PR2's `validateSqlContractFully` now expects `storage.tables` to be namespace-bucketed:
```
storage: { tables: { <namespaceId>: { <tableName>: StorageTable } } }
```
The validator interprets `User` as a namespace ID, then looks for `User.columns` to be a namespace bucket (another StorageTable level) rather than a column map, producing the cascade of errors. These tests test parameterized type handling (`typeParams`, `typeRef`) and their fixtures were not updated during PR2 to use the new nested shape.

**Expected (per script):** The package's unit tests pass.
**Reproduction:**
- `git rev-parse HEAD` → `ee0b209baf38dc364350e919f8e8be01f3f8e0d6`
- `git status` at failure → clean
- Exact command: `cd packages/2-sql/2-authoring/contract-ts && pnpm test test/contract.parameterized-types.test.ts`
**Notes:** This is a test-quality regression (tests not migrated to the new shape), not a bug in the validator. The fix is to wrap the `storage.tables` input in a namespace bucket (e.g. `tables: { public: { User: {...} } }`). Not a blocker because no user-facing behaviour is broken — but the test suite being red signals incomplete coverage migration.

---

### F-2 — 📝 Follow-up — `User.refs.id.namespaceId` is `undefined`; script oracle references non-existent accessor

**Scenario:** 2 — TS builder
**Step:** Step 3 (inspect in-memory contract)
**Oracle:** Script says: `User.refs.id.namespaceId` prints `"auth"` (not `undefined`)
**Observed:**
```
pnpm tsx wip/qa-pr2-scenario2.ts (from within contract-ts package)

User.refs.id.namespaceId: undefined
Post FK target: {"namespaceId":"auth","table":"User","columns":["id"]}
```

`model('User', { namespace: 'auth', ... })` inspected:
```
model keys: [ 'stageOne', 'attributesFactory', 'sqlFactory', 'refs' ]
namespaceId: undefined
namespace: undefined
refs.id: {"kind":"targetFieldRef","source":"token","modelName":"User","fieldName":"id"}
```

**Expected (per script):** `User.refs.id.namespaceId` prints `"auth"`
**Reproduction:**
- `git rev-parse HEAD` → `ee0b209baf38dc364350e919f8e8be01f3f8e0d6`
- `git status` → clean
- `cd packages/2-sql/2-authoring/contract-ts && pnpm tsx --eval "import { field, model } from './src/contract-builder'; const textCol = { codecId: 'pg/text@1', nativeType: 'text' }; const User = model('User', { namespace: 'auth', fields: { id: field.column(textCol).id() } }); console.log(User.refs['id']);"`
- Output: `{"kind":"targetFieldRef","source":"token","modelName":"User","fieldName":"id"}` — no `namespaceId` field
**Notes:** The namespace IS correctly propagated to FK targets during lowering (FK target shows `namespaceId: "auth"`), and `contract-builder.per-model-namespace.test.ts` and `contract-builder.cross-namespace-fk.test.ts` both pass (11/11). The `refs` property on a model handle carries a `targetFieldRef` that records `modelName` + `fieldName` only — the namespace coordinate is resolved at FK lowering time by looking up the model's declared namespace from the `defineContract` config. The script's oracle references an accessor that doesn't exist. Filed as 📝 Follow-up for the script author to correct the oracle, and optionally for the implementer to decide whether to expose `namespaceId` on the field ref.

---

### F-3 — 📝 Follow-up — Script Scenario 3 step 1 assumes SQLite PSL demo exists; it uses TS builder

**Scenario:** 3 — SQLite namespace rejection
**Step:** Step 1 (copy `contract.prisma` from SQLite demo)
**Observed:**
```
ls examples/prisma-next-demo-sqlite/src/prisma/
→ contract.d.ts  contract.json  db.ts   (no contract.prisma)
cat examples/prisma-next-demo-sqlite/prisma-next.config.ts
→ contract: typescriptContract(contract, 'src/prisma/contract.json')
```
The `prisma-next-demo-sqlite` example uses the TS builder + `typescriptContract`, not a PSL file. Step 1's suggested `cp examples/prisma-next-demo-sqlite/src/prisma/contract.prisma ...` would fail.
**Notes:** The SQLite rejection behaviour itself is confirmed correct — unit tests at `packages/2-sql/2-authoring/contract-psl/test/interpreter.diagnostics.test.ts` (lines 1112–1180) pass: `✓ SQLite rejects every explicit \`namespace { … }\` block` and `✓ SQLite also rejects \`namespace unbound { … }\``. Diagnostic message is:
```
SQLite does not support `namespace auth { … }` blocks (SQLite has no schema concept; declare models at the document top level instead).
```
The script should be updated to note that the SQLite demo uses TS builder and direct CLI end-to-end testing requires scaffolding a minimal PSL scratch contract.

---

### F-4 — 📝 Follow-up — Scenario 4 Not Run (no real Postgres available)

**Scenario:** 4 — Late-binding `namespace unbound` + IR + DDL
**Oracle:** `storage.tables` has `"__unbound__"` key; DDL emits unqualified; real DB search_path resolution works
**Not Run:** `examples/prisma-next-demo/.env` absent; `DATABASE_URL` not set. Script explicitly authorises skipping when only PGlite available.
**Notes:** Steps 1–3 (IR inspection) could be verified via unit tests, but the database-level multi-tenant apply (steps 5–7) requires real Postgres. The PSL interpreter probe confirms that `namespace unbound { }` correctly lowers to `__unbound__` in `tablesByNamespace`.

---

### F-5 — 📝 Follow-up — ORM query routing (Scenario 1 Step 4) Not Observed

**Scenario:** 1 — Demo two-namespace artifacts
**Step:** Step 4 (ORM query via `db.user.findMany`)
**Not Observed:** No `DATABASE_URL` → no connection → cannot apply migrations or issue queries.
**Notes:** The SQL emitted by the `post` FK ALTER statement is:
```
REFERENCES "auth"."user" ("id")
```
which proves the qualified DDL is correct at the SQL layer. The ORM routing (whether the runtime issues `FROM "auth"."user"`) is not directly observable without a DB connection. Marked "Not Observed" per script's pre-flight note.

## Per-scenario log

| # | Scenario | Result | Findings |
| - | -------- | ------ | -------- |
| 1 | Inspect demo two-namespace artefacts + query | ✅ pass-with-follow-ups | F-5 (ORM not observed; no DB) |
| 2 | TS builder two-namespace contract | ✅ pass-with-follow-ups | F-1 (adjacent package tests failing), F-2 (script oracle wrong accessor) |
| 3 | SQLite namespace rejection (negative control) | ✅ pass-with-follow-ups | F-3 (script step 1 inaccurate; behaviour confirmed via unit tests) |
| 4 | Late-binding `namespace unbound` + DDL | ⏭️ not run | F-4 (no Postgres) |
| 5 | Reject user-declared `namespace unbound` reservation | ✅ pass | — |
| 6 | Canonical-shape strict throw on flat literal | ✅ pass | — |
| 7 | Exploratory: namespace + cross-namespace combos | ✅ pass-with-follow-ups | See exploratory notes |

## Exploratory notes (Scenario 7 — 30-minute budget; ran ~12 minutes)

**Probe 1: Reopen-merge (two `namespace auth { … }` blocks).**
Both blocks merged correctly. `storage.tablesByNamespace` = `{ auth: { user: StorageTable, admin: StorageTable } }`. The PSL parser and interpreter correctly accumulate multiple blocks under the same namespace key. `storage.tables` (flat compat surface) shows `{ user, admin }` at the top level — this is expected: the canonical namespace-aware truth lives in the non-enumerable `tablesByNamespace` property (see `sql-storage.ts` L166), not in the flat `tables` map.

**Probe 2: Cross-namespace FK from `unbound` to named namespace.**
A model in `namespace unbound { … }` referencing a model in `namespace auth { … }` via dot-qualified type name works correctly. `tablesByNamespace = { auth: { user }, __unbound__: { post } }`. The FK target on `post` is `{ namespaceId: "auth", table: "user", columns: ["id"] }`. This combination was not explicitly scripted and passes.

**Probe 3: Single-namespace contract gains second namespace.**
A top-level `model Post` (no namespace block) alongside `namespace auth { model User }` produces `tablesByNamespace = { auth: { user }, __unbound__: { post } }`. The top-level model correctly lands in `__unbound__` (unspecified bucket). Cross-namespace FK from top-level to auth also works.

**`tables` vs `tablesByNamespace` duality.**
The in-memory `SqlStorage` IR exposes `tables` (flat, for backward compat) and `tablesByNamespace` (non-enumerable, namespace-aware). Any caller who reads `storage.tables` on a multi-namespace contract will see the flat map without namespace separation. The script oracle in Scenario 2 references `contract.storage.tables` — this would show the flat map, not the namespace-bucketed view. Callers should use `tablesByNamespace` for namespace-aware access. Worth documenting in the API surface.

**Exploratory ideas not explored in this run (suggest for future rounds):**
- Recursive nested namespace blocks (`namespace a { namespace b { model X } }`) — the spec calls this a parse error; not verified.
- Model name collision within reopen-merge (`namespace auth { model User }` + `namespace auth { model User }` — same name in both blocks).
- DDL for cross-namespace FKs with `onDelete: CASCADE` (AC4 doesn't specify; cascade not verified).
- TS-builder type narrowing in editor (autocomplete on `model('User', { namespace: 'auth' }).refs.xxx`) — requires IDE session, not automatable.

## Coverage outcome

| AC ID | Scenario(s) | Result | Notes |
| ----- | ----------- | ------ | ----- |
| AC1 | (CI; not manual-QA scope) | N/A | — |
| AC2 | (PR1 scope) | N/A | — |
| AC3 | (PR1 scope) | N/A | — |
| AC4 | 1 (authoring + emit + DDL) | ✅ pass | PSL shape, contract.json, migration ops all correct; ORM step not observed (no DB) |
| AC4a | 1 (PSL), 2 (TS) | ✅ pass | PSL surface correct; TS builder FK lowering correct per unit tests |
| AC5 | 3 | ✅ pass | SQLite rejection fires with code `PSL_UNSUPPORTED_NAMESPACE_BLOCK`; message names target + namespace |
| AC6 | 4 | ⏭️ not run | No real Postgres; IR slot behaviour confirmed via PSL interpreter probe in scenario 7 |
| AC6a | 5 | ✅ pass | `defineContract` throws with `"unbound" is reserved by Postgres for the late-binding opt-in` |
| AC6b | (parser-level; covered by AC4's scenario 1 indirectly) | N/A | — |
| AC7 | (PR1 scope) | N/A | — |
| AC8 | 2 (observed slice via TS-builder round-trip) | ✅ pass | Serialize → JSON → deserialize preserves namespace structure |
| AC9 | (deferred to project close-out QA) | N/A | — |
| AC10 | (file-existence; CI) | N/A | — |
| AC11 | (CI) | N/A | — |
| AC12 | (PR1 scope) | N/A | — |
| AC13 | (PR1 scope) | N/A | — |
| (reversal guardrail — strict-shape throw) | 6 | ✅ pass | `SqlStorage: types["user_type"] looks like a flat type entry…` — names key, actionable |
| (unknown unknowns) | 7 (exploratory) | ✅ pass-with-follow-ups | Reopen-merge, cross-namespace unbound→auth FK, and namespace-gain all work correctly |

## Suggested follow-ups

1. **Fix `contract.parameterized-types.test.ts` (F-1, ⚠️ High — address before merge):** Update the 20 failing tests to use the namespace-bucketed `storage.tables` shape (wrap the existing flat fixture in a namespace bucket, e.g. `tables: { public: { User: { ... } } }`). These tests cover `typeParams` and `typeRef` handling on columns, which is separate from the namespace feature — the failure is a fixture migration gap.

2. **Script update — Scenario 3 step 1 (F-3, 📝):** Note that `examples/prisma-next-demo-sqlite` uses TS builder (no `contract.prisma`). Suggest creating a minimal scratch PSL + SQLite config in `/tmp/qa-pr2-s3/` as an alternative, or referencing `packages/3-targets/3-targets/sqlite/test/` for a minimal PSL fixture to copy.

3. **Script update — Scenario 2 oracle (F-2, 📝):** Replace `User.refs.id.namespaceId` check with a check against the FK target's `namespaceId`. The `refs` object carries `{ kind: "targetFieldRef", modelName, fieldName }` only — namespace is resolved at FK lowering time, not stored on the field ref. Alternatively, decide whether to expose `namespaceId` on the model handle as a convenience accessor.

4. **Consider adding Scenario 4 partial coverage via PSL interpreter probe:** Even without real Postgres, a unit-level probe can verify that `namespace unbound { … }` lowers to `tablesByNamespace.__unbound__` and that the emitted DDL is unqualified. This would cover the non-DB half of AC6.

5. **Document `tables` vs `tablesByNamespace` duality:** The in-memory `SqlStorage` IR exposes both a flat `tables` map and a namespace-aware `tablesByNamespace` property. Callers who read `storage.tables` on a multi-namespace contract see the flat map. The DEVELOPING.md or a code comment should clarify which to use in which context.

6. **Future exploratory scenarios to script:** (a) Model name collision within reopen-merge; (b) recursive nested namespace blocks (`namespace a { namespace b { model X } }`); (c) cascade FK behaviour across namespaces.
