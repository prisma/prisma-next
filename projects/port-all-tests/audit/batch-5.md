# Batch 5 faithfulness audit (READ-ONLY)

Scope: six ported issue-regression tests under
`test/integration/test/ports/prisma/functional/issues-<id>.test.ts`
vs upstream `prisma/prisma@a6d0155 packages/client/tests/functional/issues/<id>/`.

Faithfulness bar: same schema + logically-same query + SAME assertions (runtime + type-level).
Categories: DROPPED-TYPE-ASSERTION, DROPPED/WEAKENED-RUNTIME-ASSERTION, FEATURE-SUBSTITUTION,
SCHEMA-SIMPLIFICATION, INPUT-SUBSTITUTION, WRONG-DISPOSITION.

---

## issues-4004 — VERDICT: FAITHFUL (no violation)

Subject: `updateMany` on a M:N join table can update the FK scalar fields
(`studentId`/`classId`) without throwing.

Schema:
- Upstream `4004/prisma/_schema.ts:15-33`: Student/Class/StudentClass with explicit
  StudentClass model exposing `studentId`, `classId` FKs. (Note: upstream already uses an
  *explicit* join model, not implicit M:N.)
- Port fixture `_fixtures/issues-4004/contract.prisma`: same three models, same FK fields,
  same relations. `id String @id` matches `idForProvider(postgresql)`. StudentClass adds
  `@default(cuid(2))` so ids can be omitted on create — faithful (upstream ids are auto too).
  No SCHEMA-SIMPLIFICATION.

Query mapping:
- Seed: upstream `tests.ts:36-64` uses nested `student:{connect}`/`class:{connect}`; port
  (`issues-4004.test.ts:38-39`) sets `studentId`/`classId` directly. Seeding is not the
  subject; direct-FK-set produces the same join rows. Acceptable API-shape translation.
- The mutation under test: upstream `tests.ts:72-77`
  `prisma.studentClass.updateMany({ data: { studentId: student1Id } })` — **no where** (all rows).
  Port `issues-4004.test.ts:42-44`
  `.where((sc) => sc.studentId.isNotNull()).updateAll({ studentId: student1.id })`.
  Verified: `collection.ts:1937-1947` gates `updateAll`'s `data` param on
  `State['hasWhere'] extends true` (else `never`) — prisma-next genuinely **requires** a
  prior `.where()`; a bare no-where "update all" is not expressible. `studentId` is a
  required non-null FK, so `isNotNull()` is a tautology matching every row → same subject
  (updateMany-with-no-where). This is the intended disposition per the audit note; the added
  predicate does NOT change the subject. Not WRONG-DISPOSITION.

Assertion mapping (SAME):
- Upstream `tests.ts:80-90`: `findMany({ select: { student:true, class:true } })` then
  `forEach` asserts `studentClass.student.id === student1Id`.
- Port `issues-4004.test.ts:47-59`: `.include('student', s=>s.select('id')).include('class', ...)
  .select('studentId','classId').all()` then `forEach` asserts `sc.student.id === student1.id`.
  Same assertion. No WEAKENED-RUNTIME-ASSERTION.

No type-level assertions upstream → none to port. Disposition: passing (correct — feature supported).

---

## issues-11974 — VERDICT: FAITHFUL (no violation)

Subject: counting/aggregating two named M:N relation fields on Comment does not throw and
returns correct counts.

Schema:
- Upstream `11974/prisma/_schema.ts:13-25`: implicit M:N with two named relations
  ("upVotes"/"downVotes") between Comment and User.
- Port fixture: adds explicit `UpVote`/`DownVote` junction models (`@@id([commentId,userId])`)
  because prisma-next PSL cannot express implicit M:N. Backrelation list fields keep the same
  named relations. Faithful translation of implicit M:N, not SCHEMA-SIMPLIFICATION.

Test 1 (`tests.ts:27-40`, disposition it.fails):
- Upstream: `findMany({ include:{ _count:{ select:{ upVotedUsers:true, downVotedUsers:true }}}})`;
  asserts `[{ id:'1', _count:{ upVotedUsers:1, downVotedUsers:1 }}]`.
- Port `issues-11974.test.ts:53-60`: `include('upVotedUsers', rel=>rel.count())
  .include('downVotedUsers', rel=>rel.count()).select('id').all()`; asserts
  `[{ id:'1', upVotedUsers:1, downVotedUsers:1 }]` (`toMatchObject`).
  Note: upstream nests counts under `_count`; port flattens (`upVotedUsers:1`). This reflects
  prisma-next's include-count result shape (there is no `_count` envelope), so it is a faithful
  shape translation of the same values — not WEAKENED. `it.fails` is correct: the N:M scalar
  include-count hits the junction-`through` gap (documented in the port comment). Faithful test.fails.

Test 2 (`tests.ts:42-51`, disposition passing):
- Upstream: `aggregate({ where:{ AND:[{downVotedUsers:{every:{uid:'2'}}}, {upVotedUsers:{every:{uid:'3'}}}]}, _count:true })`;
  asserts `{ _count:1 }`.
- Port `issues-11974.test.ts:76-83`: `where((c)=>and(c.downVotedUsers.every(u=>u.uid.eq('2')),
  c.upVotedUsers.every(u=>u.uid.eq('3')))).aggregate((agg)=>({ _count: agg.count() }))`;
  asserts `{ _count:1 }` (`toMatchObject`). Same filter (AND of two `every` on named M:N),
  same aggregate, same assertion. Faithful.

Seed: upstream `beforeAll` nested-creates users through the relation; port direct-inserts
DownVote/UpVote rows (`test.ts:47-51,68-72`). Seeding not the subject; produces the same rows.

No type-level assertions upstream. No violation.

---

## issues-12378 — VERDICT: FAITHFUL (no violation)

Subject: updating a User field after creating a Workspace with a nested join-table
(`UsersOnWorkspaces`) create+connect does not throw.

Schema:
- Upstream `12378/prisma/_schema.ts:24-44`: User/Workspace/UsersOnWorkspaces (explicit join,
  `@@id([userId,workspaceId])`, `@default(cuid())`, `email @unique`, `name String?`).
- Port fixture: identical models/fields (`@default(cuid(2))`). Faithful.

Query mapping:
- User create: upstream `tests.ts:16-21` `create({data:{email,name}})`; port
  `issues-12378.test.ts:29-32` same. Assertions upstream `toMatchObject({email,name})` +
  `user.id` truthy (`22-26`) → port asserts `user.email`, `user.name`, `user.id` individually
  (`33-35`). Equivalent, not weakened.
- Nested M:N create (the flagged item): upstream `tests.ts:28-43`
  `workspace.create({ data:{ name, users:{ create:[{ user:{ connect:{ id }}}]}}})`.
  Port `issues-12378.test.ts:44-47`:
  `Workspace.select('id','name').create({ name:'workspace',
   users:(u)=>u.create([{ user:(usr)=>usr.connect({ id: user.id }) }]) })`.
  This is a **faithful nested M:N mutation** through the join model (nested create of a
  UsersOnWorkspaces row that connects the existing user) — NOT a manual insert of join rows.
  Confirmed against audit note. No FEATURE-SUBSTITUTION.
- User update: upstream `tests.ts:49-54` `update({ where:{id}, data:{name:'Bob'}})`; port
  `issues-12378.test.ts:56-58` `.select(...).where({id}).update({name:'Bob'})`. Same.

Assertions (SAME): workspace `toMatchObject({name})`+id-truthy → port `55,56`; user-as-Bob
`toMatchObject({email,name:'Bob'})`+id-truthy+`user.id` matches (`55-60`) → port `59-63`
asserts email unchanged, name 'Bob', id truthy, `user.id` matches `userAsBob.id`. Faithful.

No type-level assertions upstream. Disposition: passing (correct). No violation.

---

## issues-12557 — VERDICT: FAITHFUL (no violation)

Subject: M:N brand counts per category are correct via include-count, including after a
cascade-deleting a Brand.

Schema:
- Upstream `12557/prisma/_schema.ts:24-34`: implicit M:N Category/Brand (`name @unique`,
  `@default(cuid())`).
- Port fixture: explicit `CategoryBrand` junction (`@@id`, FK `onDelete: Cascade` to match
  implicit-M:N cascade). `id String @id` (no cuid default) so ids are seeded explicitly. The
  cascade FK is the faithful analogue of Prisma's implicit-M:N join-row cleanup. Not a
  simplification.

Query mapping + disposition (it.fails — confirmed against audit note):
- Nested M:N create: upstream `tests.ts:16-33` `category.create({ data:{ name,
  brands:{ create:[{name},{name}] }}})`. Port `issues-12557.test.ts:26-45`
  `Category.create({ id, name, brands:(b)=>b.create([{id,name},{id,name}]) })`.
  **Faithful nested M:N create** through the junction (not manual join rows). Confirmed.
- Include-count read: upstream `tests.ts:35-41,55-61`
  `findMany({ include:{ _count:{ select:{ brands:true }}}})`. Port `issues-12557.test.ts:53-56,
  74-77` `include('brands',(b)=>b.count()).select('id','name').orderBy((c)=>c.name.asc()).all()`.
  Faithful include-count read (same subject); flattened `brands:2` vs `_count:{brands:2}` is the
  prisma-next shape.
- The port is `it.fails` (`issues-12557.test.ts:16`) using nested create + include(count) —
  exactly what the audit note requires. Not adapted to a separate aggregate query. Correct.

Assertions (SAME values): upstream before-delete `[{_count:{brands:2},name:'cat-1'},
{_count:{brands:2},name:'cat-2'}]` (`42-51`); after `brand-1` delete
`[{brands:1,'cat-1'},{brands:2,'cat-2'}]` (`62-71`). Port `57-61` and `79-83` assert the same
counts (2/2 then 1/2) after `Brand.where({id:'brand-1'}).delete()` (`63`). The port adds
`orderBy(name asc)` to make the array order deterministic — upstream relies on insertion order;
this is a strengthening, not a weakening. Faithful.

No type-level assertions upstream. No violation.

---

## issues-12572 — VERDICT: FAITHFUL (no violation)

Subject: `@default(now())` and `@updatedAt` produce equal date values on record creation.

Schema:
- Upstream `12572/prisma/_schema.ts:15-19`: User with `createdAt DateTime @default(now())`,
  `updatedAt DateTime @updatedAt`.
- Port fixture: `createdAt DateTime @default(now())`, `updatedAt temporal.updatedAt()` —
  prisma-next's faithful mapping for `@updatedAt`. Faithful.

Query + assertion (SAME): upstream `tests.ts:10-15` `create({data:{}})` then
`new Date(createdAt).getDate() === new Date(updatedAt).getDate()`. Port `issues-12572.test.ts:
28-35` identical: `create({})`, `new Date(created.createdAt).getDate()` === `updatedAt`
counterpart. Faithful. Disposition passing (correct).

No type-level assertions upstream. No violation.

---

## issues-16535-select-enum — VERDICT: FAITHFUL (no violation)

Subject: creating a record with an enum field and `select`ing only that enum field returns
the value.

Schema:
- Upstream `16535-select-enum/prisma/_schema.ts:14-22`: User `{ id, role UserRole }`,
  `enum UserRole { ADMIN USER }`.
- Port fixture: `enum UserRole { @@type("pg/text@1") ADMIN="ADMIN" USER="USER" }`, User with
  `role UserRole`. Text-backed enum is prisma-next's faithful postgres analogue. Faithful.

Query + assertion (SAME): upstream `tests.ts:10-19`
`create({ data:{ role:'ADMIN' }, select:{ role:true } })` → `toEqual({ role:'ADMIN' })`.
Port `issues-16535-select-enum.test.ts:26-28` `User.select('role').create({ role:'ADMIN' })`
→ `toEqual({ role:'ADMIN' })`. Faithful (`toEqual` preserved — asserts whole shape). Passing.

Matrix note: upstream matrix is postgres/mysql/cockroach; port comment says
"sqlite/mongodb/sqlserver opted-out" — matches upstream `optOut` (`tests.ts:23-26`). Postgres
is the ported entry. Correct.

No type-level assertions upstream. No violation.

---

## Summary table

| Test | Disposition | Faithful? | Violation category | Needs fix? |
| --- | --- | --- | --- | --- |
| issues-4004 | passing | Yes | none | No |
| issues-11974 | it.fails (t1) + passing (t2) | Yes | none | No |
| issues-12378 | passing | Yes | none | No |
| issues-12557 | it.fails | Yes | none | No |
| issues-12572 | passing | Yes | none | No |
| issues-16535-select-enum | passing | Yes | none | No |

Category counts (violations): DROPPED-TYPE-ASSERTION 0, DROPPED/WEAKENED-RUNTIME-ASSERTION 0,
FEATURE-SUBSTITUTION 0, SCHEMA-SIMPLIFICATION 0, INPUT-SUBSTITUTION 0, WRONG-DISPOSITION 0.

Tests needing fixes: **none**.

Notes cross-checked:
- 12378 uses a faithful nested M:N mutation (nested create + connect through the join model),
  not manual join-row inserts. Confirmed.
- 12557 is `it.fails` using nested create + include(count), not adapted to a separate aggregate.
  Confirmed.
- 4004 maps no-where `updateMany` → `.where(isNotNull).updateAll()`; verified `updateAll` is
  type-gated on a prior `.where()` (`collection.ts:1937-1940`), and `studentId` is a required
  non-null FK, so the predicate is a tautology over all rows — the added predicate does NOT
  change the subject. Disposition correct.

None of the six carry upstream type-level assertions, so no `.test-d.ts` port is owed.
