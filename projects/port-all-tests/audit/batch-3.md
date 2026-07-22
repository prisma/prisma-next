# Batch 3 faithfulness audit (READ-ONLY)

Auditor pass over 7 ported suites vs upstream `prisma/prisma@a6d0155`
(`/tmp/prisma`, SHA confirmed `a6d01554…`). No files modified.

Ported tests live in
`test/integration/test/ports/prisma/functional/<name>.test.ts`; fixtures in
`test/integration/test/ports/_fixtures/<name>/contract.prisma`. Ledgers:
`test/integration/test/ports/prisma/{non-ported.md,failing.md}`.

Legend for categories: DROPPED-TYPE-ASSERTION, DROPPED/WEAKENED-RUNTIME-ASSERTION,
FEATURE-SUBSTITUTION, SCHEMA-SIMPLIFICATION, INPUT-SUBSTITUTION, WRONG-DISPOSITION,
UNDER-PORTED-MATRIX, STALE-COMMENT (informational, not a faithfulness violation).

---

## 1. methods-upsert-native-atomic

Upstream `methods/upsert/native-atomic/tests.ts` — **7 tests** total
(optOut mongodb/mysql/sqlserver → postgres+cockroach only).

| # | Upstream test (line) | Subject | Disposition | Verdict |
|---|---|---|---|---|
| 1 | `should only use ON CONFLICT when update arguments do not have any nested queries` (63) | ON CONFLICT strategy vs nested mutation, via `$on('query')` log inspection | non-ported (ledger line 59) | OK |
| 2 | `should only use ON CONFLICT when there is only 1 unique field in the where clause` (186) | strategy w/ multiple unique fields, query-log | non-ported (ledger 60) | OK |
| 3 | `should only use ON CONFLICT when the unique field defined in where clause has the same value as defined in the create arguments` (224) | strategy on where/create value parity, query-log | non-ported (ledger 61) | OK |
| 4 | `should perform an upsert using ON CONFLICT` (262) | behavioral upsert on `name` @unique | ported (port 25-46) | OK |
| 5 | `should perform an upsert using ON CONFLICT with id` (299) | behavioral upsert on id | ported (port 48-69) | OK w/ note |
| 6 | `should perform an upsert using ON CONFLICT with compound id` (337) | compound id `id1_id2` | ported (port 71-90) | OK |
| 7 | `should perform an upsert using ON CONFLICT with compound uniques` (386) | compound unique `field1_field2` | ported (port 92-111) | OK |

Assertion mapping (behavioral tests): upstream `expect(user.name).toEqual(name)`
(279) → port `expect(user.name).toEqual(name)` (36); upstream
`expect(userUpdated.name).toEqual(`${name}-updated`)` (295) → port (43);
upstream `expect(compound.val).toEqual(1/2)` (359/382, 408/430) → port (80/87,
101/108). The `checker.expectUsedNativeUpsert(...)` calls are the query-log
assertions correctly dropped (they are the subject of tests 1-3, incidental in 4-7).

**Prompt's "non-ports 3 as query-log inspection" — VERIFIED CORRECT.** Tests 1-3
are genuinely query-log-strategy tests (they call `checker.expectUsedNativeUpsert`
as the *primary* assertion and have no other observable check that differs from
tests 4-7). prisma-next has no `$on('query')` event API. Ledger lines 59-61 are
accurate individual entries.

Findings:
- **STALE-COMMENT (non-blocking):** port header (lines 14-17) says "Tests 4–6 are
  pure behavioural … ported" but there are **4** behavioral tests (upstream 4-7)
  and the port correctly ports all four. The comment mis-numbers the range; the
  code is faithful.
- **Note on test 5 (INPUT-SUBSTITUTION, minor / acceptable):** upstream test 5's
  *second* upsert uses `where: { name }` (line 322) — i.e. the id-conflict first
  call then a name-conflict second call. The port uses `conflictOn: { id }` for
  BOTH calls (port 57, 65). This still exercises the same behavior (create then
  update-on-conflict returns updated row) and asserts the same values, so it is
  logically faithful; not flagged as a violation, but noted.

Runtime assertions preserved: YES. Type assertions: upstream has none. Schema:
faithful (User w/ name @unique, Compound w/ compound id + compound unique — the
port exercises all four constraint forms).

**Suite verdict: FAITHFUL.** 4 behavioral tests ported, 3 query-log tests
correctly non-ported with individual ledger entries.

---

## 2. methods-upsert-simple

Upstream `methods/upsert/simple/tests.ts` — **2 tests**.

| # | Upstream (line) | Port (line) | Verdict |
|---|---|---|---|
| 1 | `should create a record using upsert` (10) — upsert on `name`, then `count({where:{name}})===1` (25-27) | port 16-34 — `upsert({create,update,conflictOn:{name}})`, `aggregate(count)===1` (28-31) | OK |
| 2 | `should update a record using upsert` (30) — create, upsert w/ `update:{name:name+'new'}`, old count===0, new count===1 (51-55) | port 36-61 — same; `countOld===0`, `countNew===1` (50-58) | OK |

`where: { name }` (unique) → `conflictOn: { name }` is the sanctioned upsert
API-shape translation. `count({where})` → `.where().aggregate(a=>({count:a.count()}))`
is the sanctioned count translation. No type assertions upstream.

**Suite verdict: FAITHFUL.** 2/2 ported, no violations.

---

## 3. multiple-types

Upstream `multiple-types/tests.ts` — **6 tests** (optOut mongodb).
Suite's raison d'être: comparing `$queryRaw` vs `findMany` output for scalar types.

| # | Upstream test (line) | Subject | Disposition | Verdict |
|---|---|---|---|---|
| 1 | `Bool field: true or false should succeed` (27, skipTestIf D1/mysql) | bool round-trip; queryRaw==findMany | ported findMany-half (port 36-50) | OK (see note) |
| 2 | `String field: true or false as string should succeed` (70) | string round-trip; queryRaw==findMany | ported findMany-half (port 52-66) | OK (see note) |
| 3 | `shows differences between queryRaw and findMany` (113) | documents queryRaw vs findMany coercion diffs | non-ported (ledger 31) | OK |
| 4 | `a record with all fields set to null should succeed` (172) | all-null row | ported (port 71-92) | OK |
| 5 | `2 records, 1st with null, 2nd with values should succeed` (196) | null row + full-values row | **PORTED** (port 94-143) | OK, but comment lies |
| 6 | `all fields are null` (252) | all-null row (near-dup of #4) | ported (port 145-166) | OK |

Assertion mapping:
- Test 1: upstream asserts `resultFromQueryRaw` 2-row shape (43-66) AND
  `toStrictEqual(resultFromFindMany)` (67). Port keeps the findMany half:
  `toHaveLength(2)` + `boolValues.toEqual([false,true])` (46-47). The
  queryRaw==findMany equivalence is dropped — but that half depends on `$queryRaw`
  which prisma-next lacks; the findMany data assertion is preserved.
- Test 5: upstream nullRow (217-228) + valuesRow with `bInt: expect.anything()`
  (235), `bool: true` (postgres branch, 239), `dec: new Prisma.Decimal('0.0625')`
  → port asserts nullRow (119-128) + valuesRow with `bInt:'12345'` (133, STRONGER
  than upstream's `expect.anything()`), `bool:true`, `dec:'0.0625'` (Numeric
  branded string — sanctioned result-shape translation), `bytes:Uint8Array`
  (sanctioned). Faithful; the only thing dropped is the queryRaw comparison.

Findings:
- **WRONG-COMMENT / STALE-COMMENT (non-blocking):** port header lines 26-29 list
  "Non-portable tests: … '2 records, 1st with null, 2nd with values should
  succeed' (uses queryRaw comparison) … recorded in the inbox ledger." **This is
  false** — test #5 IS ported (port 94-143) and is NOT in `non-ported.md` (grep
  finds no entry). The comment contradicts the code. The code is the faithful one
  (test #5 is legitimately portable via findMany); the comment is stale and should
  be corrected, but no faithfulness violation results.
- **Note (acceptable):** tests 1 & 2 upstream also assert the exact all-column
  shape (bInt/bytes/dec null etc.) of every row via the queryRaw payload. The port
  narrows to `boolValues`/`stringValues` only, dropping the per-row null-column
  assertions that tests 1-2 also made. Tests 4-6 cover the full null-shape
  assertion, so the phenomenon is covered elsewhere; flagged as a minor
  WEAKENED-RUNTIME-ASSERTION on tests 1-2 specifically (the other columns' null
  values are no longer asserted in those two tests).
- INPUT note: upstream #5 uses `bInt: BigInt('12345')` (207); port uses
  `bInt: 12345` (number literal, port 102). Minor input-form difference; the stored
  value is the same integer and reads back as `'12345'`. Acceptable.

Non-ported accounting: test #3 correctly in ledger (line 31). No entry needed for
tests 1/2's dropped queryRaw-equivalence half (they are ported, just the
queryRaw comparison is the non-portable slice). Schema faithful.

**Suite verdict: FAITHFUL with stale/incorrect comments.** 5 tests ported, 1
(queryRaw-diff) non-ported. Minor assertion-narrowing on tests 1-2.

---

## 4. mixed-string-uuid-datetime-list-inputs

Upstream `mixed-string-uuid-datetime-list-inputs/tests.ts` — **7 tests**
(optOut sqlite/mysql/sqlserver; postgres + mongodb + cockroach in matrix).

1:1 faithful port. Every test maps directly:

| # | Upstream (line) | Port (line) | Inputs match |
|---|---|---|---|
| 1 | `create with two strings` (27) | port 47-54 | `['hello','world']` ✓ |
| 2 | `create with a string that looks like a date` (31) | 56-64 | both calls ✓ |
| 3 | `create with a string and a string that looks like a date` (36) | 66-74 | both orders ✓ |
| 4 | `create a string that looks like a uuid` (41) | 76-87 | both calls (lower+upper) ✓ |
| 5 | `create with a string and a string that looks like a uuid` (46) | 89-97 | both orders ✓ |
| 6 | `create with a date and uuid` (52) | 99-113 | both calls ✓ |
| 7 | `create with a string, date and uuid` (57) | 115-126 | permutations() over same 3-elem array ✓ |

Helper `expectCreateToSucceed`: upstream (11-25) asserts `result.words===words`
and `readBack?.words===words` after `findUnique({where:{id}})`. Port (33-44)
asserts `created.words.toEqual(words)`, then `.where({id}).all()` →
`toHaveLength(1)` + `readBack[0]?.words.toEqual(words)`. `findUnique` →
`.where({id}).all()`[0] is the sanctioned translation. `permutations` helper
reproduced inline (identical algorithm). Schema (`Post { id, words String[] }`)
faithful. No type assertions upstream.

Findings:
- **STALE-COMMENT (non-blocking):** port header line 11 & fixture comment say
  "mongodb and cockroachdb skipped". Upstream optOut is actually
  `['sqlite','mysql','sqlserver']` (mongodb and cockroachdb are IN the matrix).
  Wording is wrong but irrelevant to the postgres port's faithfulness.

**Suite verdict: FAITHFUL.** 7/7 ported, no violations.

---

## 5. naming-conflict-builtin-vs-enum  ⚠ UNDER-PORTED MATRIX

Upstream `naming-conflict/built-in-types-vs-enum/tests.ts` — **1 test body**
parametrized over `builtInNames` (**67 names**, `_builtInNames.ts` lines 1-69) ×
matrix providers. Matrix (`_matrix.ts`): postgresql, mysql, mongodb, cockroachdb.
optOut sqlite/sqlserver (enums unsupported).

**Distinct postgres cases upstream: 67** (one `allows to create enum with
conflicting name` per enumName).

**Ported: 4** — Promise, Result, Union, Keys (port 28-74; distinct fixture models
`EnumHolder{Promise,Result,Union,Keys}` each with its own enum). Under-port ratio
**4 / 67**.

Assertion mapping per case:
- Upstream (11-17): `create({data:{value:'ONE'}})`, `findFirstOrThrow()`,
  `expect(data.value).toBe('ONE')` **and `expectTypeOf(data.value).toEqualTypeOf<'ONE'|'TWO'>()`** (line 16).
- Port (e.g. 31-35): `create({value:'ONE'})`, `.all().firstOrThrow()`,
  `expect(data.value).toBe('ONE')`. **The `expectTypeOf` type assertion is DROPPED**
  for all 4 ported cases; no sibling `.test-d.ts` exists (confirmed: `find … test-d.ts`
  matching these suites → NONE).

Findings:
- **UNDER-PORTED-MATRIX:** 4 of 67 name-cases ported; the remaining 63 have **no
  `non-ported.md` accounting** (grep of non-ported.md for naming-conflict / enum /
  builtInName → NONE). Per spec §"Under-porting a matrix" (spec lines 97, 105-114)
  this must be either fully ported or the suite non-ported with the codegen-collision
  reason — representative-sampling to 4 with no ledger entry is a violation of the
  accounting invariant.
- **DROPPED-TYPE-ASSERTION:** `expectTypeOf(data.value).toEqualTypeOf<'ONE'|'TWO'>()`
  (upstream line 16) dropped from all ported cases. prisma-next CAN express the
  inferred enum-value literal-union type (contract.d.ts emits the enum member
  union), so a `.test-d.ts` assertion is portable per spec lines 100-104. Dropped
  with no ledger entry.
- Port header (lines 15-21) argues the type assertion is "non-portable (no
  generated PrismaClient types)". This reasoning is questionable: the assertion is
  about the *inferred value literal union*, which prisma-next's ORM result type
  should carry. Even if truly non-portable, it needs an individual `non-ported.md`
  line (there is none).
- Fixture header says "63 enum names" — actual count is **67**.

Runtime half (4 cases): faithful. Schema faithful per-fixture (enum ONE/TWO,
EnumHolder-per-name).

**Suite verdict: UNDER-PORTED + DROPPED-TYPE-ASSERTION, un-accounted.**
Needs fix: port all 67 (or non-port the 63 remainder + the type assertion with
individual ledger lines).

---

## 6. naming-conflict-builtin-vs-model  ⚠ UNDER-PORTED MATRIX

Upstream `naming-conflict/built-in-types-vs-model/tests.ts` — **2 test bodies**
parametrized over `builtInNames` (**67 names**) × allProviders-ish (postgres,
mysql, mongodb, cockroach — same `_matrix.ts` shape via builtInNames).

**Distinct postgres cases upstream: 67 × 2 = 134**
(`allows to use <name> name for a model name` + `… (relation)`).

**Ported: 4 names × 2 = 8** — Promise, Result, Union, Keys (port 29-179), each with
a plain test + a `(relation)` test via `include('model')`. Under-port ratio
**8 / 134**.

Assertion mapping per name:
- Non-relation: upstream (32-44) `findFirstOrThrow()`,
  `expect(result).toEqual({id:any,isUserProvidedType:true})` **+
  `expectTypeOf(result).not.toBeAny()` (42) + `.toMatchTypeOf<{id:string;
  isUserProvidedType:boolean}>()` (43)**. Port (e.g. 38-43): same runtime `toEqual`;
  **both `expectTypeOf` assertions DROPPED.**
- Relation: upstream (46-58) `findFirstOrThrow({include:{model:true}})`,
  `expect(result.model).toEqual({...})` **+ `expectTypeOf(result.model).not.toBeAny()`
  (56) + `.toMatchTypeOf<…>()` (57)**. Port (e.g. 57-62): `include('model')
  .all().firstOrThrow()`, `expect(result.model).toEqual({...})`; **both type
  assertions DROPPED.**

Findings:
- **UNDER-PORTED-MATRIX:** 8 of 134 cases; remaining 126 un-accounted (no
  non-ported.md entry).
- **DROPPED-TYPE-ASSERTION (×2 per name × 8 = 16 dropped assertions):**
  `.not.toBeAny()` and `.toMatchTypeOf<{id;isUserProvidedType}>()` dropped from all
  8 ported cases. `.not.toBeAny()` and a structural `toMatchTypeOf` are directly
  expressible against the prisma-next ORM inferred row type (spec lines 100-104,
  pattern in `dsl-type-inference.test-d.ts`). Dropped with no sibling `.test-d.ts`
  and no ledger entry. Port header (lines 19-22) asserts these are "type-level tests
  with no runtime equivalent" — but they DO have a prisma-next type-level home;
  this is the exact case the spec calls portable.
- Fixture/port header says "63 model names" — actual is **67**.

Runtime half (8 cases): faithful (relation `connect`/`include` correctly modeled).

**Suite verdict: UNDER-PORTED + DROPPED-TYPE-ASSERTIONS, un-accounted.**

---

## 7. naming-conflict-model-vs-model  ⚠ UNDER-PORTED MATRIX

Upstream `naming-conflict/model-vs-model/tests.ts` — **1 test body** parametrized
over `conflictingModels` (**12 names**: ModelUpdate, ModelDefault, ModelSelect,
ModelInclude, ModelResult, ModelDelete, ModelUpsert, ModelAggregate, ModelCount,
ModelPayload, ModelFieldRefs, ModelGroupBy — `_matrix.ts` 4-17) × allProviders.

**Distinct postgres cases upstream: 12.**
**Ported: 1** (ModelUpdate; port 21-38). Under-port ratio **1 / 12**.

Assertion mapping:
- Upstream (10-24): `model.create({data:{other:{create:{name}}}})`,
  `findFirstOrThrow({include:{other:true}})`,
  `expect(value.other).toMatchObject({id:any,name:'Other type'})` (21) **+
  `expectTypeOf(value.other).not.toBeAny()` (22) + `.toMatchTypeOf<{name:string;
  id:string}>()` (23)**.
- Port (26-34): `Model.create({other:(o)=>o.create({name})})`,
  `Model.include('other').all().firstOrThrow()`,
  `expect(value.other).toMatchObject({name:'Other type'})` +
  `typeof value.other.id==='string'` + `typeof value.other.name==='string'`.
  **Both `expectTypeOf` assertions DROPPED** (re-expressed only as runtime
  `typeof` checks, which is NOT the same as a compile-time type assertion).

Findings:
- **UNDER-PORTED-MATRIX:** 1 of 12 cases; remaining 11 un-accounted.
- **DROPPED-TYPE-ASSERTION:** `.not.toBeAny()` + `.toMatchTypeOf<{name;id}>()`
  (upstream 22-23) replaced by runtime `typeof` checks. Runtime typeof is a
  weaker/different guarantee than a compile-time type assertion; per spec these
  should be ported to a `.test-d.ts`. No such file; no ledger entry.
- Runtime half: the port's `toMatchObject({name:'Other type'})` drops the
  `id: expect.any(String)` key that upstream's `toMatchObject` includes (line 21) —
  but compensates with `typeof value.other.id==='string'`. Equivalent coverage; not
  flagged separately.
- Nested-`create` relation write (`other:{create:...}` → `other:(o)=>o.create(...)`)
  is a genuine prisma-next feature here (fixture models it), so this is faithful
  API-shape translation, not feature-substitution.

**Suite verdict: UNDER-PORTED + DROPPED-TYPE-ASSERTIONS, un-accounted.**

---

## Summary table

| Suite | Upstream PG cases | Ported cases | Category flags | Needs fix? |
|---|---|---|---|---|
| methods-upsert-native-atomic | 7 (3 query-log + 4 behavioral) | 4 behavioral (+3 correctly non-ported) | STALE-COMMENT; minor INPUT-SUB on test 5 | No (faithful) |
| methods-upsert-simple | 2 | 2 | — | No |
| multiple-types | 6 | 5 (+1 queryRaw non-ported) | WRONG/STALE-COMMENT (says test5 non-ported but it's ported); minor WEAKENED-ASSERT tests 1-2 | Comment fix only |
| mixed-string-uuid-datetime-list-inputs | 7 | 7 | STALE-COMMENT (optOut list) | No |
| naming-conflict-builtin-vs-enum | **67** | **4** | UNDER-PORTED-MATRIX (4/67, 63 un-accounted); DROPPED-TYPE-ASSERTION (`toEqualTypeOf<'ONE'\|'TWO'>` ×4); wrong count (63 vs 67) | **YES** |
| naming-conflict-builtin-vs-model | **134** (67×2) | **8** (4×2) | UNDER-PORTED-MATRIX (8/134, 126 un-accounted); DROPPED-TYPE-ASSERTION (`.not.toBeAny()`+`.toMatchTypeOf` ×16); wrong count | **YES** |
| naming-conflict-model-vs-model | **12** | **1** | UNDER-PORTED-MATRIX (1/12, 11 un-accounted); DROPPED-TYPE-ASSERTION (`.not.toBeAny()`+`.toMatchTypeOf`); | **YES** |

### Category tallies
- DROPPED-TYPE-ASSERTION: **3 suites** (enum, builtin-vs-model, model-vs-model) —
  every `expectTypeOf` in the naming-conflict suites dropped with no `.test-d.ts`
  and no `non-ported.md` line.
- UNDER-PORTED-MATRIX (un-accounted): **3 suites** — enum (4/67), builtin-vs-model
  (8/134), model-vs-model (1/12). None of the un-ported cases have `non-ported.md`
  entries.
- WRONG-DISPOSITION / stale comment: multiple-types header wrongly lists test #5 as
  non-ported (it is ported); native-atomic mis-numbers behavioral range; mixed +
  naming fixtures cite wrong optOut lists / name counts (63 vs 67).
- WEAKENED-RUNTIME-ASSERTION (minor): multiple-types tests 1-2 drop the per-row
  null-column assertions the upstream queryRaw payload made (covered by tests 4-6).
- FEATURE-SUBSTITUTION / SCHEMA-SIMPLIFICATION / INPUT-SUBSTITUTION: none material
  (native-atomic test-5 conflictOn:id-vs-name is a minor, acceptable input note).

### Tests needing fixes
1. **naming-conflict-builtin-vs-enum** — port all 67 name-cases OR non-port the 63
   remainder with individual ledger lines; port `toEqualTypeOf<'ONE'|'TWO'>` to a
   `.test-d.ts` (or non-port that assertion with a precise per-case reason). Fix the
   "63" count.
2. **naming-conflict-builtin-vs-model** — same: 67×2 cases accounted; port
   `.not.toBeAny()` + `.toMatchTypeOf<{id;isUserProvidedType}>()` to `.test-d.ts`.
3. **naming-conflict-model-vs-model** — account 12 cases; port `.not.toBeAny()` +
   `.toMatchTypeOf<{name;id}>()` to `.test-d.ts` (runtime `typeof` ≠ type assertion).
4. **multiple-types** — correct the stale comment claiming test #5 is non-ported.

### Matrix upstream-count-vs-ported-count (the prompt's key ask)
| Matrix suite | Upstream distinct PG cases | Ported | Un-accounted remainder |
|---|---|---|---|
| built-in-types-vs-enum | 67 | 4 | 63 (no ledger) |
| built-in-types-vs-model | 134 (67 names × 2 tests) | 8 (4×2) | 126 (no ledger) |
| model-vs-model | 12 | 1 | 11 (no ledger) |
