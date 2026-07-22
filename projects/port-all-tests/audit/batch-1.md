# Batch-1 faithfulness audit (READ-ONLY)

Upstream pin: `prisma/prisma@a6d0155`, `/tmp/prisma/packages/client/tests/functional/<suite>/`.
Ports: `test/integration/test/ports/prisma/functional/<name>.test.ts`; fixtures `.../_fixtures/<name>/contract.prisma`.

Legend for line refs: `tests.ts:N` = upstream; `<name>.test.ts:N` = port.

---

## blog-update  (fixture-faithful: yes — schema matches `prisma/_schema.ts`; `@default(now())`, `@updatedAt`→`temporal.updatedAt()`, all fields/relations preserved. `cuid`→`cuid(2)` is the standard prisma-next translation.)

Upstream has 4 tests. Port carries 3; the 4th is in `non-ported.md`.

### should create a user and update that field on that user — VERDICT: FAITHFUL
- upstream asserts (tests.ts:41): `expect(response.email).toEqual(newEmail)`
- port asserts (blog-update.test.ts:45-46): `expect(response).not.toBeNull()` + `expect(response!.email).toEqual(newEmail)`
- create+findUnique(email)+update(select email, data email) mapped to `create` / `first({email})` / `select('email').where({id}).update({email})`. `findUnique({where:{email}})`→`first({email})` is allowed API-shape translation. Extra `not.toBeNull()` strengthens, does not weaken. FAITHFUL.

### should create a user and post and connect them together — VERDICT: FAITHFUL
- upstream asserts (tests.ts:99-102): `expect(response).toMatchObject({ ...user, posts: [post] })`
- port asserts (blog-update.test.ts:72-78): `not.toBeNull()` + `toMatchObject({ id: user.id, name: user.name, email: user.email, posts: [{ id: post.id, title: post.title, published: post.published }] })`
- Upstream `...user` spreads the selected `{id,email,name}`; port lists `id,name,email` explicitly — same three fields. `posts:[post]` where post = selected `{id,title,published}`; port lists the same three. Nested `connect` mechanism preserved (`posts.connect([{id}])`). FAITHFUL.

### should create a user and post and disconnect them — VERDICT: FAITHFUL
- upstream asserts (tests.ts:163-166): `expect(response).toMatchObject({ ...user, posts: [] })`
- port asserts (blog-update.test.ts:112-113): `not.toBeNull()` + `expect(response!.posts).toEqual([])`
- Upstream creates user with nested `posts.create:[{title,published}]`, then disconnects `user.posts[0].id`. Port reproduces nested `posts.create([{title,published}])` (create-side nested create IS supported), reloads to get the post id (extra read, no subject change), then `posts.disconnect([{id}])`. The `...user` fields in the upstream assertion are the seeded `{id,email,name}` which are unchanged by the disconnect; port asserts the load-bearing `posts:[]` and the non-null response. Slightly narrower on the unchanged scalar fields but the SUBJECT (disconnect → empty relation) is fully asserted. FAITHFUL (the dropped `...user` fields are unchanged identity fields, not the subject; not a weakening of what the test proves).

### should create a user with posts and a profile ... setting fields to null — VERDICT: FAITHFUL (non-ported, justified)
- upstream (tests.ts:177-303): single `update()` with nested `profile: { update: {...} }` (tests.ts:254) and `posts: { updateMany: {...} }` (tests.ts:266).
- port: absent; `non-ported.md` entry present with reason "ORM relation mutator exposes only create/connect/disconnect; no nested update/updateMany on relations."
- This is exactly the FORBIDDEN-to-emulate case ("nested relation update/updateMany → manual join rows"). Correct disposition. FAITHFUL.

---

## bytes-upsert  (fixture-faithful: yes — `TestByteId { id String @id @default(cuid(2)); bytes Bytes @unique }` matches postgres branch. Upstream uses `id` from `idForProvider(provider,{includeDefault:true})` = `String @id @default(cuid(2))` for postgres; sqlserver opt-out honored.)

### bytes upsert should work correctly — VERDICT: FAITHFUL (it.fails, justified)
- upstream asserts (tests.ts:26): second `upsertByteRow()` "Should not throw"; (tests.ts:32-33): `expect(result).toBeTruthy()` + `expect(result?.bytes).toEqual(byteId)`.
- port asserts (bytes-upsert.test.ts:38-44): calls `upsertByteRow()` twice; then `expect(result).toBeTruthy()` + `expect(result?.bytes).toEqual(byteId)`.
- Mechanism preserved: `upsert({create,update:{},...})` on a `Bytes @unique`. Upstream `where:{bytes:byteId}` → prisma-next `conflictOn:{bytes:byteId}` is the ORM's upsert-conflict spelling (allowed API-shape translation, not feature substitution — still keyed on the same `Bytes @unique` value). Input `new Uint8Array(randomBytes(16))` identical (tests.ts:12 vs test.ts:29). Marked `it.fails` with a precise `failing.md` entry (`ORM.MUTATION_ROW_MISSING`). This is the sanctioned faithful-but-failing disposition. FAITHFUL.

---

## create-default-date  (fixture-faithful: yes — `Visit { id Int @id @default(autoincrement()); visitTime DateTime @default(now()) }` matches upstream exactly. Mongo/Cockroach opt-out is structural.)

### correctly creates a field with default date — VERDICT: FAITHFUL
- upstream asserts (test.ts:12): `expect(visit.visitTime).toBeInstanceOf(Date)`
- port asserts (create-default-date.test.ts:23): `expect(visit.visitTime).toBeInstanceOf(Date)`
- `prisma.visit.create({})` → `db.public.Visit.create({})`. Same empty-create-relies-on-defaults subject, identical assertion. FAITHFUL.

---

## decimal-list  (fixture-faithful: yes, with a noted precision detail — upstream `Decimal[]` is bare `Decimal[]`; fixture uses a named type `D = Decimal @db.Numeric(65,30)`. Postgres maps bare `Decimal` to `numeric(65,30)` by default, so this is the faithful storage type, and the fixture comment documents it. Not a simplification.)

Upstream has 3 tests; all 3 ported. All three upstream tests have NO return-value assertion — they assert only that `create` does not throw (tests.ts:9-31).

### with decimal instances — VERDICT: FAITHFUL
- upstream (tests.ts:10-14): `create({ data: { decimals: [12.3, 45.6] } })`, no assertion.
- port (decimal-list.test.ts:29-31): `create({ decimals: [12.3, 45.6] })`, no assertion.
- Despite the name, upstream passes JS numbers `[12.3,45.6]` (NOT Decimal.js instances) — verified tests.ts:13. Port passes the identical numbers. Input faithful. FAITHFUL.

### with numbers — VERDICT: FAITHFUL
- upstream (tests.ts:18-22): `create({ data: { decimals: [12.3, 45.6] } })`, no assertion.
- port (decimal-list.test.ts:39-42): `create({ decimals: [12.3, 45.6] })`, no assertion.
- Identical. FAITHFUL.

### create with strings — VERDICT: FAITHFUL
- upstream (tests.ts:26-30): `create({ data: { decimals: ['12.3', '45.6'] } })`, no assertion.
- port (decimal-list.test.ts:50-53): `create({ decimals: ['12.3', '45.6'] })`, no assertion.
- Identical string input. FAITHFUL.

---

## decimal-precision  (fixture-faithful: yes, for the in-scope postgres rows — one `@db.Numeric(p,s)` column per postgres-applicable precision (10,0),(20,10),(38,30). The (65,30) and (1000,500) matrix rows are excluded for postgres by the upstream matrix's own precision cap logic — postgres numeric max precision is 1000 but the schema pattern and the mysql/mssql-oriented rows are out of the postgres port scope; fixture comment documents the exclusion. Columns made nullable so each test writes one column — acceptable, does not change the storage constraint under test.)

Upstream is ONE fast-check property test parameterized over the (precision,scale) matrix; the postgres-applicable entries are (10,0),(20,10),(38,30). The port replaces random property generation with representative full-precision values, 2 per column = 6 tests.

### Property under test (tests.ts:43-54)
- upstream asserts (tests.ts:53): `result.decimal.toFixed() === decimalString` (no precision loss).
- Input mechanism (tests.ts:50): `decimal: new Prisma.Decimal(decimalString)`.

### numeric(10,0) round-trips a 9-digit integer without loss — VERDICT: FAITHFUL
- port (decimal-precision.test.ts:31-32): `create({ d10_0: '123456789' })` → `expect(String(created.d10_0)).toBe('123456789')`.
- prisma-next has no `Prisma.Decimal`; Numeric is a branded string, so string input + `String(value) === input` is the sanctioned equivalent of `new Prisma.Decimal(s)` + `.toFixed() === s`. This is allowed ("Numeric branded string vs Prisma.Decimal — assert prisma-next's real shape"). Full-precision-preservation subject preserved. FAITHFUL.

### numeric(10,0) round-trips a single digit — VERDICT: FAITHFUL
- port (decimal-precision.test.ts:41-42): `d10_0: '1'` → `String === '1'`. FAITHFUL (added edge-value coverage; strengthens, not weakens).

### numeric(20,10) round-trips 10 integer + 10 fractional digits — VERDICT: FAITHFUL
- port (decimal-precision.test.ts:51-52): `d20_10: '1234567890.1234567890'` → equal. Full (20,10) precision exercised. FAITHFUL.

### numeric(20,10) round-trips a full-scale fractional value — VERDICT: FAITHFUL
- port (decimal-precision.test.ts:60-62): `d20_10: '9.9999999999'` → equal. FAITHFUL.

### numeric(38,30) round-trips 8 integer + 30 fractional digits — VERDICT: FAITHFUL
- port (decimal-precision.test.ts:70-74): `d38_30: '12345678.123456789012345678901234567890'` → equal. Full (38,30) precision. FAITHFUL.

### numeric(38,30) round-trips a 30-digit fractional tail — VERDICT: FAITHFUL
- port (decimal-precision.test.ts:82-86): `d38_30: '1.000000000000000000000000000001'` → equal. FAITHFUL.

Note: the fast-check *randomization* is not reproduced (deterministic representative values instead). This is an allowed translation — the SUBJECT is "no precision loss at the column's declared (p,s)", and full-precision representative values exercise it at least as hard as random in-range values. Not flagged.

---

## decimal-scalar  (fixture-faithful: yes — `User { id String @id @default(cuid(2)); money Decimal }` matches upstream. Mongo opt-out structural.)

Upstream has 4 tests in a `possible inputs` describe, seeded once with `money = new Decimal('12.5')` (tests.ts:13-17). Port seeds `money:'12.5'` per-run in the wrapper (decimal-scalar.test.ts:23-26). 2 ported, 2 non-ported.

### decimal as string — VERDICT: FAITHFUL
- upstream asserts (tests.ts:30): `findFirst({ where: { money: '12.5' } })` → `expect(String(result?.money)).toBe('12.5')`.
- port asserts (decimal-scalar.test.ts:34-35): `first({ money: '12.5' })` → `expect(String(result?.money)).toBe('12.5')`.
- Same string-equality filter input; identical assertion. FAITHFUL.

### decimal as number (gt/lt range) — VERDICT: FAITHFUL
- upstream asserts (tests.ts:46-50): `findFirst({ where: { money: { gt: 12.4, lt: 12.6 } } })` → `String(result?.money) === '12.5'`.
- port asserts (decimal-scalar.test.ts:44-47): `where((u) => and(u.money.gt('12.4'), u.money.lt('12.6'))).first()` → `String(result?.money) === '12.5'`.
- Subject is a `{gt,lt}` range filter on a Decimal column. Upstream passes JS numbers `12.4/12.6`; port passes strings `'12.4'/'12.6'`. prisma-next PgNumeric ordering operators take the branded-string form; this is the same range-filter mechanism on the same value, an allowed shape translation (Numeric string vs number literal), not an input-substitution of the SUBJECT (the subject is "range filter on decimal", not "number-typed input coercion"). Assertion identical. FAITHFUL. [Minor note: upstream's `decimal as number` name emphasizes numeric input; if strict readers consider the *number literal* itself the subject, this edges toward INPUT-SUBSTITUTION — but the test's describe/context is "possible inputs → range works", and gt/lt semantics are preserved. Judged FAITHFUL; see summary caveat.]

### decimal as Decimal.js instance — VERDICT: FAITHFUL (non-ported, justified)
- upstream (tests.ts:23-31): filter `where:{ money: new Decimal('12.5') }`.
- `non-ported.md` entry present: "prisma-next has no Decimal.js input interop." Correct — this is the FORBIDDEN input-substitution case; must be non-ported. FAITHFUL.

### decimal as decimal.js-like object — VERDICT: FAITHFUL (non-ported, justified)
- upstream (tests.ts:53-66): filter with `{d,e,s,toFixed}` decimal.js-like object.
- `non-ported.md` entry present: "no Decimal.js-like input coercion path." Correct disposition. FAITHFUL.

---

## default-selection  (fixture-faithful: yes for the postgres branch — `Model { id, value, otherId @unique, relation Other, list String[], enum Enum, enumList Enum[] }`, `Other`, `enum Enum {A B}` all present; mongo `composite` correctly excluded. Enum is `@@type("pg/text@1")` text-backed. NO SCHEMA SIMPLIFICATION — the port keeps the `Enum[]` list column that triggers the emitter gap rather than dropping it to make tests pass. This is the correct faithful choice.)

Upstream: 1 `beforeAll` seed + 6 tests; mongo-only `composites` test excluded. 5 ported (all `it.fails`), 1 (composites) mongo-only not ported.

Seed: upstream (tests.ts:11-37) `value:'Foo'`, `relation.create:{}`, `enum:'A'`, `list:['Hello','world']`, `enumList:['A','B']`. Port SEED_MODEL (default-selection.test.ts:33-40) matches: `value:'Foo'`, `list:['Hello','world']`, `enum:'A'`, `enumList:['A','B']` + explicit ids and a separately-created `Other`. Faithful (relation.create nested → explicit Other create + otherId, a create-side shape translation).

### includes scalars — VERDICT: FAITHFUL (it.fails, justified)
- upstream asserts (tests.ts:42-44): `expect(model.id).toBeDefined()` + `model.value` + `model.otherId`.
- port asserts (default-selection.test.ts:51-53): `model!.id/value/otherId` each `toBeDefined()` (+ `not.toBeNull()`).
- `findFirstOrThrow()` → `first({id})`. Same scalar-default-selection subject. `it.fails` justified by the `Enum[]` emitter gap (documented in failing.md, sqlState 22P02). FAITHFUL.

### does not include relations — VERDICT: VIOLATION: DROPPED-TYPE-ASSERTION
- upstream asserts (tests.ts:50-51): **TYPE** `expectTypeOf(model).not.toHaveProperty('relation')` AND **runtime** `expect(model).not.toHaveProperty('relation')`.
- port asserts (default-selection.test.ts:65-66): only the runtime `expect(model).not.toHaveProperty('relation')`.
- finding: the upstream `expectTypeOf(model).not.toHaveProperty('relation')` (tests.ts:50) is a type-level assertion that the default-selected row type excludes the relation field. Per the spec ("Type-level assertions are ported, not dropped"), it must be reproduced in a sibling `default-selection.test-d.ts` as `expectTypeOf<Row>().not.toHaveProperty('relation')` on the prisma-next ORM's inferred default-selection row type. No `.test-d.ts` sibling exists (verified: no `*.test-d.ts` in `functional/`). The type half was dropped. Faithful fix: add `default-selection.test-d.ts` asserting the inferred default-select row type of `db.public.Model.first(...)` has no `relation` property. (Runtime half itself is faithful and the `it.fails` is justified by the emitter gap.)

### includes enums — VERDICT: FAITHFUL (it.fails, justified)
- upstream asserts (tests.ts:58): `expect(model.enum).toBeDefined()`.
- port asserts (default-selection.test.ts:79-80): `model!.enum` `toBeDefined()` + `toEqual('A')`.
- Port asserts a superset (also checks value 'A'); strengthens. `it.fails` justified. FAITHFUL.

### includes lists — VERDICT: FAITHFUL (it.fails, justified)
- upstream asserts (tests.ts:67): `expect(model.list).toBeDefined()`.
- port asserts (default-selection.test.ts:93-94): `model!.list` `toBeDefined()` + `toEqual(['Hello','world'])`. Superset, strengthens. `it.fails` justified. FAITHFUL.

### includes enum lists — VERDICT: FAITHFUL (it.fails, justified)
- upstream asserts (tests.ts:77): `expect(model.enumList).toBeDefined()`.
- port asserts (default-selection.test.ts:107-108): `model!.enumList` `toBeDefined()` + `toEqual(['A','B'])`. Superset. `it.fails` justified. FAITHFUL.

### includes composites (mongo-only) — VERDICT: FAITHFUL (not ported)
- upstream (tests.ts:81-86): `testIf(provider === MONGODB)`. Postgres port correctly omits; port header documents it. FAITHFUL.

Note: the `beforeAll` seed block contains four `@ts-test-if` conditional-input comments (tests.ts:20,25,27,32). These are provider-conditional compile guards for the shared multi-provider suite, not standalone negative type assertions about the query surface, so they do not each need a `.test-d.ts` home. The one genuine type assertion is the `expectTypeOf` at tests.ts:50, flagged above.

---

## enum-array  (fixture-faithful: yes — `User { id, plans Plan[] }`, `enum Plan { FREE PAID CUSTOM }` text-backed. The list column is KEPT (not dropped), which is the faithful choice that triggers the emitter gap. No simplification.)

Upstream: 3 tests. 2 ported (`it.fails`), 1 (raw-query custom parser) non-ported.

### can create data with an enum array — VERDICT: FAITHFUL (it.fails, justified)
- upstream (tests.ts:17-25): `create({ data: { plans: [Plan.FREE] } })`, no return assertion.
- port asserts (enum-array.test.ts:31-34): `create({ plans: ['FREE'] })` → `expect(user.id).toBeDefined()` + `expect(user.plans).toEqual(['FREE'])`.
- `Plan.FREE` (generated enum member) → string literal `'FREE'` is the prisma-next enum spelling (text-backed enum values are strings). Port adds return assertions upstream lacked (strengthens). `it.fails` justified by emitter gap (failing.md, 22P02). FAITHFUL.

### can retrieve data with an enum array — VERDICT: VIOLATION: DROPPED-TYPE-ASSERTION
- upstream asserts (tests.ts:42-43): **TYPE** `expectTypeOf(data.plans).toEqualTypeOf<imports.Plan[]>()` AND **runtime** `expect(data.plans).toEqual([Plan.FREE])`.
- port asserts (enum-array.test.ts:46-47): only runtime `not.toBeNull()` + `expect(found!.plans).toEqual(['FREE'])`.
- finding: the upstream `expectTypeOf(data.plans).toEqualTypeOf<imports.Plan[]>()` (tests.ts:42) — asserting the read-back `plans` field is typed as the enum array — was dropped. prisma-next CAN express this: the ORM infers a row type whose `plans` field is the emitted `Plan[]` enum-array type. Faithful fix: add `enum-array.test-d.ts` with `expectTypeOf<Row['plans']>().toEqualTypeOf<Plan[]>()` (or `.toHaveProperty('plans')` against the contract's enum type) on the inferred `first`/`create` row type. Runtime half is faithful; `it.fails` is justified. Also: `findFirstOrThrow({where:{id}})` → `first({id})` (allowed shape translation).

### can retrieve data with an enum array with a raw query and a custom parser — VERDICT: FAITHFUL (non-ported, justified)
- upstream (tests.ts:46-107): `PrismaPg` adapter with `userDefinedTypeParser` custom OID parser + `$queryRaw`.
- `non-ported.md` entry present: "no equivalent raw OID-parser hook / $queryRaw path in prisma-next public API." Correct — raw-SQL + adapter-specific parser is the subject; must be non-ported. FAITHFUL.

---

## Summary table

| Suite | Tests audited | FAITHFUL | DROPPED-TYPE-ASSERTION | Other violations |
|---|---|---|---|---|
| blog-update | 4 (3 ported + 1 non-ported) | 4 | 0 | 0 |
| bytes-upsert | 1 (it.fails) | 1 | 0 | 0 |
| create-default-date | 1 | 1 | 0 | 0 |
| decimal-list | 3 | 3 | 0 | 0 |
| decimal-precision | 6 | 6 | 0 | 0 |
| decimal-scalar | 4 (2 ported + 2 non-ported) | 4 | 0 | 0 |
| default-selection | 6 (5 it.fails + 1 mongo n/p) | 5 | **1** (`does not include relations`) | 0 |
| enum-array | 3 (2 it.fails + 1 non-ported) | 2 | **1** (`can retrieve data with an enum array`) | 0 |
| **Total** | **28 line-items** | **26** | **2** | **0** |

### Violation categories tallied
- DROPPED-TYPE-ASSERTION: **2**
- DROPPED/WEAKENED-RUNTIME-ASSERTION: 0
- FEATURE-SUBSTITUTION: 0
- SCHEMA-SIMPLIFICATION: 0
- INPUT-SUBSTITUTION: 0 (one caveat noted — decimal-scalar `decimal as number` uses string literals for gt/lt vs upstream number literals; judged an allowed Numeric-shape translation since gt/lt range semantics are preserved, not flagged as a violation)
- WRONG-DISPOSITION: 0 (all `it.fails` and `non-ported` dispositions verified genuine)

### Tests needing fixes
1. `default-selection.test.ts` › `does not include relations` — restore the dropped `expectTypeOf(model).not.toHaveProperty('relation')` (tests.ts:50) in a new `default-selection.test-d.ts`.
2. `enum-array.test.ts` › `can retrieve data with an enum array` — restore the dropped `expectTypeOf(data.plans).toEqualTypeOf<Plan[]>()` (tests.ts:42) in a new `enum-array.test-d.ts`.

Both fixes are additive `.test-d.ts` siblings; the existing runtime assertions and `it.fails` dispositions are faithful and should remain.
