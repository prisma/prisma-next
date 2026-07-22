# Batch 2 faithfulness audit (READ-ONLY)

Auditor scope: `distinct`, `extended-where`, `string-filters`, `methods/count`, `methods/createMany`, `methods/findFirstOrThrow`, `methods/findUniqueOrThrow`.

Upstream root: `/tmp/prisma/packages/client/tests/functional/`. Port root: `test/integration/test/ports/prisma/functional/`. Fixtures: `test/integration/test/ports/_fixtures/`.

---

## distinct (fixture-faithful: yes)

Upstream: `distinct/tests.ts` (10 tests, `allProviders`). Fixture drops the `@default(cuid())` on `id` (comment notes explicit ids are seeded) — inert for distinct semantics; schema otherwise 1:1 (`User { id, firstName, lastName }`).

Note: upstream seeds via `copycat.firstName/lastName` producing a distinctness structure (A=B full dup, C half dup, D distinct) and asserts only `result.length`. Port seeds explicit values reproducing exactly that structure (`distinct.test.ts:14-19`) and asserts the same counts. Faithful — counts are the sole subject.

### distinct on firstName — VERDICT: FAITHFUL
- upstream asserts (tests.ts:47): `expect(result.length).toBe(2)`
- port asserts (distinct.test.ts:39): `expect(result.length).toBe(2)` via `.distinct('firstName').all()`
- finding: none.

### distinct on firstName and lastName — VERDICT: FAITHFUL
- upstream asserts (tests.ts:55): `expect(result.length).toBe(3)`
- port asserts (distinct.test.ts:49): `expect(result.length).toBe(3)`
- finding: none.

### distinct on id — VERDICT: FAITHFUL
- upstream asserts (tests.ts:63): `toBe(4)`; port (distinct.test.ts:59): `toBe(4)`. none.

### distinct on id and firstName — VERDICT: FAITHFUL
- upstream (tests.ts:71): `toBe(4)`; port (distinct.test.ts:69): `toBe(4)`. none.

### distinct on id and lastName — VERDICT: FAITHFUL
- upstream (tests.ts:79): `toBe(4)`; port (distinct.test.ts:79): `toBe(4)`. none.

### distinct on firstName and id — VERDICT: FAITHFUL
- upstream (tests.ts:87): `toBe(4)`; port (distinct.test.ts:89): `toBe(4)`. none.

### distinct on firstName and firstName — VERDICT: FAITHFUL
- upstream (tests.ts:95): `toBe(2)`; port (distinct.test.ts:99): `toBe(2)`. none.

### distinct on id and firstName and lastName — VERDICT: FAITHFUL
- upstream (tests.ts:103): `toBe(4)`; port (distinct.test.ts:109): `toBe(4)`. none.

### distinct on id shortcut — VERDICT: FAITHFUL
- upstream (tests.ts:106-111): `distinct: 'id'` → `toBe(4)`; port (distinct.test.ts:114-121): `.distinct('id')` → `toBe(4)`. String-shortcut → varargs is API-shape translation. none.

### distinct on id and firstName shortcut — VERDICT: FAITHFUL
- upstream (tests.ts:114-119): `distinct: 'firstName'` → `toBe(2)`; port (distinct.test.ts:124-131): `.distinct('firstName')` → `toBe(2)`. none.

---

## methods-count (fixture-faithful: yes)

Upstream: `methods/count/tests.ts` (9 tests). Port covers 6, non-ports 3 (recorded `non-ported.md:18-20`).

### simple — VERDICT: FAITHFUL
- upstream asserts (tests.ts:17): `expect(value).toMatchInlineSnapshot(`3`)`
- port asserts (methods-count.test.ts:35): `expect(count).toBe(3)` via `.aggregate(a => ({ count: a.count() }))`
- finding: `count()` → `aggregate(count())` is sanctioned API-shape translation.

### take — VERDICT: FAITHFUL (weak but justified)
- upstream asserts (tests.ts:25): `count({ take: 2 })` → `toMatchInlineSnapshot(`2`)`
- port asserts (methods-count.test.ts:46): `.take(2).all()` then `rows.length` `toBe(2)`
- finding: prisma-next `aggregate` has no `take`; the observable subject (count honours `take`) is preserved by counting the taken rows. Acceptable — result value identical (2).

### where — VERDICT: FAITHFUL
- upstream (tests.ts:35): `count({ where: { age: 111 } })` → `1`
- port (methods-count.test.ts:57): `.where({ age: 111 }).aggregate(count())` → `toBe(1)`. none.

### select where — VERDICT: FAITHFUL
- upstream (tests.ts:46): `count({ select: true, where: { age: 111 } })` → `1`
- port (methods-count.test.ts:69): same count, `toBe(1)`
- finding: upstream comment/port comment note `select: true` is a pass-through to plain count; value is the subject. Faithful.

### select all true — VERDICT: FAITHFUL
- upstream (tests.ts:77): `count({ select: true })` → `3`; port (methods-count.test.ts:81): `toBe(3)`. none.

### select all false — VERDICT: FAITHFUL
- upstream (tests.ts:86): `count({ select: false })` → `3` (with `@ts-expect-error` on a known Prisma bug); port (methods-count.test.ts:91): `toBe(3)`
- finding: the upstream `@ts-expect-error` guards a Prisma-specific TODO bug ("There is a bug here") with no prisma-next analogue; dropping only that comment is fine. Runtime value preserved.

### select mixed where — VERDICT: FAITHFUL (non-ported)
- upstream (tests.ts:62-69): per-field object `{ _all:1, age:1, email:1, name:1 }`
- port: none — `non-ported.md:18` (ORM aggregate has no `count(field)`).
- finding: correct disposition; per-field non-null count is genuinely unexpressible.

### select mixed — VERDICT: FAITHFUL (non-ported)
- upstream (tests.ts:99-106): `{ _all:3, ... }`; port none — `non-ported.md:19`. Correct.

### bad prop — VERDICT: FAITHFUL (non-ported)
- upstream (tests.ts:121-146): `matchPrismaErrorInlineSnapshot` on invalid `posts` select
- port: none — `non-ported.md:20` (compile-time validation message; no ORM equivalent). Correct.

---

## methods-createMany (fixture-faithful: yes)

Upstream: `methods/createMany/tests.ts` (3 tests; `skipDriverAdapter js_d1`). Fixture 1:1 (`User { id, email@unique, name?, posts }`, `Post { id, title, user, userId }`); cuid→cuid(2) inert.

### should create many records — VERDICT: FAITHFUL
- upstream asserts (tests.ts:34): `expect(created.count).toEqual(4)` via `createMany({ data: [4 rows] })`
- port asserts (methods-createMany.test.ts:26): `expect(count).toEqual(4)` via `createCount([4 rows])`
- finding: top-level `createMany`→`createCount` (both bulk-insert returning count) — faithful; prisma-next has no `createMany` returning `{count}`, `createCount` is the direct analogue.

### should create a single record with a single nested create — VERDICT: FAITHFUL (minor mechanism note)
- upstream asserts (tests.ts:59-62): `res.email/name` equal; `res.posts.length` `toEqual(1)`; `res.posts[0].title` equal — via nested `posts: { createMany: { data: { title } } }`
- port asserts (methods-createMany.test.ts:45-48): same four assertions — via nested `posts: p => p.create([{ title }])`
- finding: nested `createMany` (bulk child insert) is swapped for array-form nested `create`. prisma-next exposes no nested `createMany`; the observable result (one post, asserted fields) is identical, so this is defensible API-shape translation, not a result change. Borderline INPUT/MECHANISM note — flag as acceptable; a stricter reading would non-port the nested-createMany-specific behaviour, but nothing distinguishes it at the result level here.

### should create a single record with many nested creates — VERDICT: FAITHFUL (minor mechanism note)
- upstream asserts (tests.ts:88-102): `res.posts.length` `toEqual(4)`; each title `toBeTruthy()`
- port asserts (methods-createMany.test.ts:69-74): `res.posts.length` `toEqual(4)`; each title found `toBeTruthy()`
- finding: same nested-createMany→nested-create note; result identical.

---

## methods-findFirstOrThrow (fixture-faithful: yes)

Upstream: `methods/findFirstOrThrow/tests.ts` (6 tests; 3 non-ported at `non-ported.md:56-58`). Fixture 1:1 (`User{id,email@unique,posts}`,`Post`).

### finds existing record — VERDICT: VIOLATION: DROPPED-TYPE-ASSERTION
- upstream asserts (tests.ts:22-23): `expect(record).toMatchObject({ id: expect.any(String), email })` AND `expectTypeOf(record).not.toBeNullable()`
- port asserts (methods-findFirstOrThrow.test.ts:41-42): `expect(record).toMatchObject({ email })` + `expect(typeof record.id).toBe('string')`
- finding: runtime half faithful (id-is-string + email preserved). The type-level `expectTypeOf(record).not.toBeNullable()` (tests.ts:23) is DROPPED — no sibling `.test-d.ts` exists. prisma-next's `.firstOrThrow()` returns a non-nullable row type, so it IS expressible per spec §"Type-level assertions are ported, not dropped". Faithful fix: add `extended-where`-style `.test-d.ts` (or reuse this suite's) with `expectTypeOf(record).not.toBeUndefined()`/`.not.toBeNull()` on the `.firstOrThrow()` result.

### throws if record was not found — VERDICT: FAITHFUL
- upstream asserts (tests.ts:29-32): rejects `{ name:'PrismaClientKnownRequestError', code:'P2025' }`
- port asserts (methods-findFirstOrThrow.test.ts:52-54): rejects `{ code:'RUNTIME.NO_ROWS' }`
- finding: P2025 → `RUNTIME.NO_ROWS` is the sanctioned error-condition mapping (spec OQ4). Faithful.

### works with transactions / interactive transactions / reports correct method name — VERDICT: FAITHFUL (non-ported)
- upstream (tests.ts:36-92); port none — `non-ported.md:56-58` (no batch/interactive `$transaction`; method-name-in-error is a generated-client artifact). Correct dispositions.

---

## methods-findUniqueOrThrow (fixture-faithful: yes)

Upstream: `methods/findUniqueOrThrow/tests.ts` (6 tests; 3 non-ported at `non-ported.md:21-23`). Fixture 1:1.

### finds existing record — VERDICT: VIOLATION: DROPPED-TYPE-ASSERTION (+ mechanism note)
- upstream asserts (tests.ts:22-23): `toMatchObject({ id: expect.any(String), email })` AND `expectTypeOf(record).not.toBeNullable()`
- port asserts (methods-findUniqueOrThrow.test.ts:39-40): `toMatchObject({ email })` + `typeof record.id === 'string'`
- finding: (1) DROPPED-TYPE-ASSERTION — `expectTypeOf(record).not.toBeNullable()` (tests.ts:23) omitted; expressible on `.firstOrThrow()` (same fix as findFirstOrThrow). (2) MECHANISM note: `findUniqueOrThrow` (unique-key lookup) is ported as `.where({email}).all().firstOrThrow()` (a findFirst-style scan). `email` is `@unique` so the result is identical; prisma-next has no distinct unique-index-lookup surface, so this is acceptable shape-translation, but it does make findUniqueOrThrow and findFirstOrThrow ports byte-identical (the unique-vs-first distinction is lost). Acceptable but worth noting.

### throws if record was not found — VERDICT: FAITHFUL
- upstream (tests.ts:28-31): rejects `{ name:'PrismaClientKnownRequestError', code:'P2025' }`
- port (methods-findUniqueOrThrow.test.ts:50-52): rejects `{ code:'RUNTIME.NO_ROWS' }`. Sanctioned mapping. Faithful.

### works with transactions / interactive transactions / reports correct method name — VERDICT: FAITHFUL (non-ported)
- upstream (tests.ts:35-91); port none — `non-ported.md:21-23`. Correct.

---

## string-filters (fixture-faithful: yes)

Upstream: `string-filters/tests.ts` (15 base + 3 `mode:insensitive` = 18 postgres tests). Fixture: `TestModel { id, value }` (single string field) — faithful. Port maps `startsWith/endsWith/contains` → `.like('pfx%'/'%sfx'/'%sub%')` and `mode:'insensitive'` → `.ilike(...)`.

**Mechanism verdict (the flagged concern): FAITHFUL, not a workaround.** Confirmed prisma-next's ORM exposes NO `startsWith/endsWith/contains` filter methods (grep of `packages/3-extensions/sql-orm-client/src` and repo-wide — only string-utility `.startsWith` usages), and DOES expose `like` (core, `types.ts:178`) and `ilike` (postgres adapter op, `planner-sql-checks.ts:82`). Prisma's `startsWith:'foo'` compiles to exactly `value LIKE 'foo%'` and `mode:'insensitive'` to `ILIKE`; the port's `.like('foo%')`/`.ilike('%bar%')` are the identical SQL predicate, not a different feature. All row-sets/orderings/counts asserted are byte-identical to upstream. The only theoretical gap — Prisma escapes LIKE metacharacters (`%`,`_`) in the operand — is not exercised (no seed value contains `%`/`_`), so no divergence. Acceptable under spec §"Allowed — API-shape translation".

### startsWith matches prefix — VERDICT: FAITHFUL
- upstream (tests.ts:30-31): `toHaveLength(2)`; `map(value)` `toEqual(['foo','foo bar baz'])`
- port (string-filters.test.ts:46-47): `length` `toBe(2)`; `map` `toEqual(['foo','foo bar baz'])`. none.

### startsWith with no match — VERDICT: FAITHFUL
- upstream (tests.ts:39): `toHaveLength(0)`; port (string-filters.test.ts:57): `toBe(0)`. none.

### startsWith with empty string matches all — VERDICT: FAITHFUL
- upstream (tests.ts:47): `startsWith:''` → `toHaveLength(6)`; port (string-filters.test.ts:68): `.like('%')` → `toBe(6)`
- finding: `startsWith('')`≡`LIKE '%'` matches all 6 — same result. Faithful.

### endsWith matches suffix — VERDICT: FAITHFUL
- upstream (tests.ts:56-57): `toHaveLength(2)`; `['baz','foo bar baz']`; port (string-filters.test.ts:80-81): same. none.

### endsWith with no match — VERDICT: FAITHFUL
- upstream (tests.ts:65): `0`; port (string-filters.test.ts:91): `0`. none.

### endsWith with empty string matches all — VERDICT: FAITHFUL
- upstream (tests.ts:73): `6`; port (string-filters.test.ts:102): `.like('%')` `6`. none.

### contains matches substring — VERDICT: FAITHFUL
- upstream (tests.ts:82-83): `2`; `['bar','foo bar baz']`; port (string-filters.test.ts:114-115): `.like('%bar%')` same. none.

### contains with no match — VERDICT: FAITHFUL
- upstream (tests.ts:91): `0`; port (string-filters.test.ts:126): `0`. none.

### contains with empty string matches all — VERDICT: FAITHFUL
- upstream (tests.ts:99): `contains:''` `6`; port (string-filters.test.ts:137): `.like('%%')` `6`. none.

### combined startsWith + endsWith — VERDICT: FAITHFUL
- upstream (tests.ts:108-109): `1`; `[0].value` `'foo bar baz'`; port (string-filters.test.ts:150-151): `and(like('foo%'),like('%baz'))` same
- finding: Prisma's combined `{startsWith,endsWith}` on one field ANDs the predicates; `and(...)` is the faithful translation. none.

### combined startsWith + contains — VERDICT: FAITHFUL
- upstream (tests.ts:118-119): `1`; `'foo bar baz'`; port (string-filters.test.ts:165-166): same. none.

### combined contains + endsWith — VERDICT: FAITHFUL
- upstream (tests.ts:128-129): `1`; `'foo bar baz'`; port (string-filters.test.ts:180-181): same. none.

### NOT startsWith — VERDICT: FAITHFUL
- upstream (tests.ts:138-139): `4`; `['','bar','baz','completely different']`; port (string-filters.test.ts:193-194): `not(like('foo%'))` same
- finding: Prisma `NOT:{value:{startsWith}}` → `not(...)`. Faithful.

### NOT contains — VERDICT: FAITHFUL
- upstream (tests.ts:148-149): `4`; `['','baz','completely different','foo']`; port (string-filters.test.ts:206-207): same. none.

### NOT endsWith — VERDICT: FAITHFUL
- upstream (tests.ts:158-159): `4`; `['','bar','completely different','foo']`; port (string-filters.test.ts:219-220): same. none.

### mode:insensitive contains — VERDICT: FAITHFUL
- upstream (tests.ts:177): `sort()` `toEqual(['FOO BAR BAZ','bar','foo bar baz'])`
- port (string-filters.test.ts:237): `.ilike('%bar%')` `sort()` same
- finding: upstream seeds the insensitive rows in a suite-level `beforeAll`; port re-seeds per-isolated-db (documented string-filters.test.ts:225-226). Same result. Faithful.

### mode:insensitive startsWith — VERDICT: FAITHFUL
- upstream (tests.ts:186): `['FOO BAR BAZ','Foo','foo','foo bar baz']`; port (string-filters.test.ts:253-258): `.ilike('foo%')` same. none.

### mode:insensitive endsWith — VERDICT: FAITHFUL
- upstream (tests.ts:195): `['FOO BAR BAZ','baz','foo bar baz']`; port (string-filters.test.ts:273): `.ilike('%baz')` same. none.

---

## extended-where (fixture-faithful: NO — dropped `onDelete: Cascade`)

Upstream: 11 files. Fixture (`_fixtures/extended-where/contract.prisma`) matches the four models EXCEPT it drops `onDelete: Cascade` on `Profile.user` (upstream schema comment line 15 / port line 42) and `Post.author` (upstream comment line 23 / port line 52). prisma-next PSL/migrations DO support `onDelete: Cascade` (`relation-inference.ts:170`, `constraints.ts:30`), so this is an expressible construct that was simplified — SCHEMA-SIMPLIFICATION. Consequence in the delete-PK test below.

Checklist status: only the 9 cursor tests (test.fails) and the 4 aggregate/validation entries (non-ported) are `[x]`; **all 17 passing findUnique/findUniqueOrThrow/create/update/upsert/delete ports remain `[ ]` unchecked** (`checklists/prisma-functional-0-l.md:484-536`) — i.e. reviewer has not yet ratified them, consistent with the substitutions flagged below.

### findMany/findFirst/findFirstOrThrow with cursor (9 tests) — VERDICT: FAITHFUL (test.fails)
- upstream findMany (findMany.ts:21,32,42): `data.length` `toBe(2)` ×3; findFirst (findFirst.ts:21,32,42): `data?.id` `toBe(postId2)` ×3; findFirstOrThrow (findFirstOrThrow.ts:21,32,42): `data.id` `toBe(postId2)` ×3
- port asserts (extended-where.test.ts:85,100,115 / 132,145,158 / 174,187,201): identical assertions, all wrapped `it.fails`, recorded `failing.md:18-26`
- finding: prisma-next cursor is exclusive (keyset-after) vs Prisma inclusive; the faithful `.cursor(...)` call is written and the upstream expected value kept, flipped to `it.fails` — exactly the spec's prescribed handling of the inclusive/exclusive gap (spec §FORBIDDEN "inclusive cursor ... mark test.fails"). Correct. Minor: port adds explicit `.orderBy(...)` (upstream relies on default cursor order); does not change the subject.

### findUnique with where 1 unique (PK) — VERDICT: FAITHFUL
- upstream (findUnique.ts:21): `data?.id` `toBe(userId)`; port (extended-where.test.ts:215): `.first({id})` `data?.id` `toBe(userId)`. `findUnique`→`.first(pk)` sanctioned.

### findUnique with where 2 uniques (PK & non-PK) — VERDICT: FAITHFUL (subject-shift note)
- upstream (findUnique.ts:32): `findUnique({ where:{ id, title } })` `data?.id` `toBe(postId1)`
- port (extended-where.test.ts:225-228): `.where({id}).where({title}).first()` `toBe(postId1)`
- finding: the extended-where subject is passing a non-unique field (`title`) alongside a unique into a UNIQUE input. Port re-expresses as chained filters (semantically a findFirst with two predicates). `title` is `@unique` here so the result matches; acceptable API-shape translation, but the "extended unique where" mechanism itself is not distinctly exercised. Acceptable.

### findUnique with where 1 unique (non-PK) — VERDICT: FAITHFUL
- upstream (findUnique.ts:42): `data?.id` `toBe(postId2)`; port (extended-where.test.ts:238): `.first({title})` same. none.

### findUnique with nested where on optional 1:1 not found — VERDICT: VIOLATION: FEATURE-SUBSTITUTION
- upstream (findUnique.ts:45-60): `findUnique({ where:{id}, include:{ payment:{ where:{ ccn:'not there' } } } })` then `data?.payment` `toBeNull()`
- port (extended-where.test.ts:249-254): separate `Payment.where({id}).where({ccn:'not there'}).first()` `toBeNull()`
- finding: SUBJECT is a **filtered nested include on an optional 1:1 relation** (does the filtered include null out a non-matching relation). Port replaces it with a standalone `Payment` query — a different mechanism (no include, no relation traversal). This is feature-substitution. If prisma-next's `include(rel => rel.where(...))` cannot express a filtered 1:1 include, the correct disposition is `non-ported` (or `test.fails` if written faithfully and it throws) — not a green standalone query. Checklist line is (correctly) still `[ ]`.

### findUnique with nested where on optional 1:1 found — VERDICT: VIOLATION: FEATURE-SUBSTITUTION
- upstream (findUnique.ts:62-76): `include:{ payment:{ where:{ ccn: vars.ccn } } }` then `data?.payment` `not.toBeNull()`
- port (extended-where.test.ts:263-267): separate `Payment.first({id})` `not.toBeNull()` — and drops the `ccn` filter entirely
- finding: same filtered-nested-include subject substituted by a standalone lookup; additionally the `ccn` match condition is dropped, so the port does not even exercise the matching filter. `non-ported`/`test.fails`, not green.

### findUniqueOrThrow with where 1 unique (PK) — VERDICT: FAITHFUL
- upstream (findUniqueOrThrow.ts:21): `data.id` `toBe(userId)`; port (extended-where.test.ts:279-281): `.first({id})` + throw-guard, `toBe(userId)`. Acceptable.

### findUniqueOrThrow with where 2 uniques — VERDICT: FAITHFUL (same subject-shift note as findUnique 2-uniques)
- upstream (findUniqueOrThrow.ts:32): `toBe(postId1)`; port (extended-where.test.ts:291-295): chained `.where().where().first()`. Acceptable.

### finUniqueOrThrow with where 1 unique (non-PK) — VERDICT: FAITHFUL
- upstream (findUniqueOrThrow.ts:42): `data.id` `toBe(postId1)`; port (extended-where.test.ts:305-307): `.first({title:'Hello World 1'})`. none.

### create with connect (3 tests) — VERDICT: FAITHFUL (verification-shift note)
- upstream (create.ts:42,80,115): connect via `{id}` / `{id,referralId}` / `{referralId}`, verified by `findUnique({ include:{ profile:true } })` then `user?.profile` `toBeTruthy()`
- port (extended-where.test.ts:333,357,381): connect via `u.connect({id})` / `{id}` (see below) / `{referralId}`, verified by `Profile.first({userId})` `not.toBeNull()`
- finding: (a) verification mechanism differs (include vs separate query) but the SUBJECT is the connect; verified equivalently — acceptable. (b) **"connect 2 uniques"**: upstream connects `{ id, referralId }` (two-key unique connect); port (extended-where.test.ts:353) connects only `{ id }` — the second unique key is dropped, so tests "connect 1" and "connect 2" are effectively identical in the port. Minor WEAKENING of the 2-unique case (the multi-key connect subject is not exercised). Flag as INPUT-SUBSTITUTION (dropped second key).

### update with where 1 unique (PK) — VERDICT: VIOLATION: INPUT-SUBSTITUTION
- upstream (update.ts:19-22): `update({ where:{id}, data:{} })` (EMPTY data) then `data.id` `toBe(userId)`
- port (extended-where.test.ts:394-395): `.update({ referralId: newReferral })` (non-empty) then `data?.id` `toBe(userId)`
- finding: upstream subject is "update with empty `data` still returns the row addressed by unique where". prisma-next `update({})` returns null (documented port comment lines 33-34), so the port swaps in a non-empty update. That changes the input under test. Faithful handling: write the empty-`data` update and mark `test.fails` (or `non-ported`), not a green with a substituted input.

### update with where 2 uniques (PK & non-PK) — VERDICT: FAITHFUL (subject-shift note)
- upstream (update.ts:36): `data.title` `toBe('Hello World 4')`; port (extended-where.test.ts:408): chained `.where().where().update()` same. Acceptable (title is unique).

### update with where 1 unique (non-PK) — VERDICT: FAITHFUL
- upstream (update.ts:49): `toBe('Hello World 5')`; port (extended-where.test.ts:421): `.where({title}).update()` same. none.

### upsert with where (3 tests) — VERDICT: FAITHFUL (input-shape note)
- upstream (upsert.ts:30,48,65): `data.referralId`/`data.title` assertions; create clause omits PK and uses `payment:{create:{}}` (PK) / omits id (non-PK)
- port (extended-where.test.ts:443,460,475): same result assertions; but supplies explicit `id`/`paymentId` and `conflictOn` in create (documented port comment lines 434-437: upsert has no nested relation callback, so paymentId is pre-looked-up)
- finding: prisma-next upsert requires explicit `conflictOn` + no nested-create; the create-clause inputs are reshaped but the asserted result (update path taken, field value) is identical. Acceptable API-shape translation; the "update branch of upsert on extended unique where" subject is preserved.

### delete with where 2 uniques (PK & non-PK) — VERDICT: FAITHFUL
- upstream (delete.ts:14-20): `delete({ where:{ id, title } })` (no explicit assertion; success = no throw)
- port (extended-where.test.ts:487-492): chained `.where().where().delete()` + `deleted not.toBeNull()` + row gone `toBeNull()`
- finding: port STRENGTHENS (adds post-delete verification) — fine; subject preserved.

### delete with where 1 unique (non-PK) — VERDICT: FAITHFUL
- upstream (delete.ts:23-28): `delete({ where:{ title } })`; port (extended-where.test.ts:502-505): `.where({title}).delete()` + verification. Acceptable.

### delete with where 1 unique (PK) — VERDICT: VIOLATION: SCHEMA-SIMPLIFICATION (cascade workaround)
- upstream (delete.ts:31-37): `prisma.user.delete({ where:{id} })` — relies on `onDelete: Cascade` (schema) to remove the user's posts/profile
- port (extended-where.test.ts:513-521): manually `Post...deleteAll()` + `Profile...deleteAll()` FIRST, then deletes user
- finding: because the fixture dropped `onDelete: Cascade`, a plain PK delete would FK-fail, so the port hand-rolls the child cleanup. The upstream subject (single PK delete cascading to children) is not exercised. Faithful fix: restore `onDelete: Cascade` on `Profile.user` and `Post.author` in the fixture (prisma-next supports it) and delete the user directly, letting the cascade run.

### aggregate with cursor (3 tests) — VERDICT: FAITHFUL (non-ported)
- upstream (aggregate.ts:22,34,45): `data._count` `toBe(2)` ×3 with `cursor` + `_count:true`
- port: none — `non-ported.md:24-26` (Collection.aggregate ignores cursor state; no aggregate-with-cursor API). Correct disposition.

### validation: where and no keys / missing unique keys — VERDICT: FAITHFUL (non-ported)
- upstream (validation.ts:17-40, 51-74): `matchPrismaErrorInlineSnapshot` on `delete({where:{}})` / `{profile:{}}`
- port: none — `non-ported.md:27-28` (Prisma-client error-message snapshot format). Correct.

### validation: AtLeast type (2 tests) — VERDICT: FAITHFUL (non-ported)
- upstream (validation.ts:77-97): `expectTypeOf` against `Prisma.AtLeast<...>` utility type
- port: none — `non-ported.md:29-30` (Prisma-generated utility type, no prisma-next equivalent; spec §"When a type assertion IS non-portable"). Correct.

---

## Summary table

| Category | Count | Tests needing fixes (port location) |
| --- | --- | --- |
| DROPPED-TYPE-ASSERTION | 2 | methods-findFirstOrThrow.test.ts `finds existing record` (add `.test-d.ts` `not.toBeNullable`); methods-findUniqueOrThrow.test.ts `finds existing record` (same) |
| DROPPED/WEAKENED-RUNTIME-ASSERTION | 1 | extended-where.test.ts `create with connect 2 uniques` (dropped second unique key → identical to 1-unique case) |
| FEATURE-SUBSTITUTION | 2 | extended-where.test.ts `findUnique nested where 1:1 not found` & `... found` (filtered nested include → standalone query; should be non-ported/test.fails) |
| SCHEMA-SIMPLIFICATION | 1 | extended-where fixture drops `onDelete: Cascade` → forces child-delete workaround in `delete with where 1 unique (PK)`; restore cascade |
| INPUT-SUBSTITUTION | 1 | extended-where.test.ts `update with where 1 unique (PK)` (empty `data:{}` → non-empty update; should be test.fails) |
| WRONG-DISPOSITION | 0 | (2 filtered-include ports shipped green rather than non-ported/test.fails are counted under FEATURE-SUBSTITUTION; note extended-where passing ports remain `[ ]` unratified in checklist) |
| FAITHFUL (incl. correct non-ported/test.fails) | ~62 | — |

Faithful total: distinct 10/10, methods-count 9/9, methods-createMany 3/3, string-filters 18/18, plus all correctly-dispositioned extended-where cursor (9 test.fails) + aggregate/validation (7 non-ported) + count/find non-ported (6). Violations concentrate in extended-where's passing ports (5 issues) and the two OrThrow type-assertion drops.
