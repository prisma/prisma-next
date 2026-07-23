# Checklist — prisma/prisma client functional (suites m–z)

Source: prisma/prisma@a6d01554528e016bea1467a072776b0e2b94dcba — packages/client/tests/functional/

Protocol: each line is one source test. `[ ]` = not yet dispositioned. The Opus reviewer sub-agent checks `[x]` ONLY when satisfied that the test is (a) faithfully ported and passing, (b) faithfully ported as `test.fails` with a `failing.md` entry, or (c) covered by a justified individual `non-ported.md` entry. Implementer sub-agents never check boxes.

### packages/client/tests/functional/methods/count/tests.ts
- [x] `simple` — `user.count()` returns 3 (all seeded users) [providers: all] → ports/prisma/functional/methods-count.test.ts
- [x] `take` — `count({ take: 2 })` returns 2 [providers: all] → ports/prisma/functional/methods-count.test.ts
- [x] `where` — `count({ where: { age: 111 } })` returns 1 [providers: all] → ports/prisma/functional/methods-count.test.ts
- [x] `select where` — `count({ select: true, where: { age: 111 } })` returns 1 [providers: all] → ports/prisma/functional/methods-count.test.ts
- [x] `select mixed where` — `count` with per-field select (`_all`,email,age,name) + where returns object of 1s [providers: all] → non-ported
- [x] `select all true` — `count({ select: true })` returns 3 [providers: all] → ports/prisma/functional/methods-count.test.ts
- [x] `select all false` — `count({ select: false })` returns 3 (select:false is @ts-expect-error, known bug) [providers: all] → ports/prisma/functional/methods-count.test.ts
- [x] `select mixed` — `count` with per-field select returns object of 3s [providers: all] → non-ported
- [x] `bad prop` — count with unknown field `posts` in select rejects with validation error snapshot (Unknown field on UserCountAggregateOutputType) [providers: all] → non-ported

### packages/client/tests/functional/methods/createMany/tests.ts
- [x] `should create many records` — `createMany` with 4 rows returns `count` of 4 [providers: all] → ports/prisma/functional/methods-createMany.test.ts
- [x] `should create a single record with a single nested create` — `create` with nested `posts.createMany` (single) creates user + 1 post [providers: all] → ports/prisma/functional/methods-createMany.test.ts
- [x] `should create a single record with many nested create` — `create` with nested `posts.createMany` (4) creates user + all 4 posts found by title [providers: all] → ports/prisma/functional/methods-createMany.test.ts

### packages/client/tests/functional/methods/createManyAndReturn-supported/tests.ts
- [x] `should create one record` — `createManyAndReturn` with single object returns array of 1 matching email/id/name:null [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-createManyAndReturn.test.ts
- [x] `should create many records` — `createManyAndReturn` with 4 rows returns all 4 in order [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-createManyAndReturn.test.ts
- [x] `should accept select` — `createManyAndReturn({ select: { id: true } })` returns only id [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-createManyAndReturn.test.ts
- [x] `should accept include on the post side` — `post.createManyAndReturn({ include: { user: true } })` returns post with nested user [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-createManyAndReturn.test.ts
- [x] `should fail include on the user side` — `user.createManyAndReturn({ include: { posts: true } })` rejects (Unknown field posts for include on CreateManyUserAndReturnOutputType) [providers: postgres,cockroach,sqlite] → non-ported
- [x] `take should fail` — `createManyAndReturn({ take: 1 })` rejects (Unknown argument take) [providers: postgres,cockroach,sqlite] → non-ported
- [x] `orderBy should fail` — `createManyAndReturn({ orderBy })` rejects (Unknown argument orderBy) [providers: postgres,cockroach,sqlite] → non-ported
- [x] `distinct should fail` — `createManyAndReturn({ distinct })` rejects (Unknown argument distinct) [providers: postgres,cockroach,sqlite] → non-ported
- [x] `select _count should fail` — select `_count` rejects (Unknown field _count for select) [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-createManyAndReturn.test.ts
- [x] `include _count should fail` — include `_count` rejects (Unknown field _count for include) [providers: postgres,cockroach,sqlite] → test.fails: test/ports/prisma/functional/methods-createManyAndReturn.test.ts

### packages/client/tests/functional/methods/createManyAndReturn-unsupported/tests.ts
- [x] `should work as createMany is supported` — `prisma.user` has `createMany` property (runs it, type-checks presence) [providers: sqlserver,mongodb,mysql] → non-ported
- [x] `should fail as createManyAndReturn is not supported on tested providers` — `prisma.user` lacks `createManyAndReturn` (@ts-expect-error + expectTypeOf not.toHaveProperty) [providers: sqlserver,mongodb,mysql] → non-ported

### packages/client/tests/functional/methods/findFirstOrThrow/tests.ts
- [x] `finds existing record` — `findFirstOrThrow` returns seeded user by email, type not nullable [providers: all] → ports/prisma/functional/methods-findFirstOrThrow.test.ts
- [x] `throws if record was not found` — rejects with PrismaClientKnownRequestError code P2025 [providers: all] → ports/prisma/functional/methods-findFirstOrThrow.test.ts
- [x] `works with transactions` — batch `$transaction` with failing findFirstOrThrow rejects (snapshot) and rolls back create (skipTestIf js_d1) [providers: all] → non-ported
- [x] `works with interactive transactions` — interactive `$transaction` with failing findFirstOrThrow rejects (snapshot) and rolls back create (skipTestIf js_d1) [providers: all] → non-ported
- [x] `reports correct method name in case of validation error` — invalid where field rejects with message containing `prisma.user.findFirstOrThrow()` invocation [providers: all] → non-ported

### packages/client/tests/functional/methods/findUniqueOrThrow/tests.ts
- [x] `finds existing record` — `findUniqueOrThrow` returns seeded user by email, type not nullable [providers: all] → ports/prisma/functional/methods-findUniqueOrThrow.test.ts
- [x] `throws if record was not found` — rejects with PrismaClientKnownRequestError code P2025 [providers: all] → ports/prisma/functional/methods-findUniqueOrThrow.test.ts
- [x] `works with transactions` — batch `$transaction` with failing findUniqueOrThrow rejects (snapshot) and rolls back create (skipTestIf js_d1) [providers: all] → non-ported
- [x] `works with interactive transactions` — interactive `$transaction` with failing findUniqueOrThrow rejects (snapshot) and rolls back create (skipTestIf js_d1) [providers: all] → non-ported
- [x] `reports correct method name in case of validation error` — invalid where field rejects with message containing `prisma.user.findUniqueOrThrow()` invocation [providers: all] → non-ported

### packages/client/tests/functional/methods/updateManyAndReturn-supported/tests.ts
- [x] `should update and return many records` — `updateManyAndReturn` with empty where updates name on all 4 and returns them [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-updateManyAndReturn.test.ts
- [x] `should update and return one record` — updates email by where, returns the single updated record [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-updateManyAndReturn.test.ts
- [x] `should update and return records satisfying the where clause` — where `email in [...]` returns only the 2 matched updated records [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-updateManyAndReturn.test.ts
- [x] `should accept select` — `updateManyAndReturn({ select: { id: true } })` returns only id [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-updateManyAndReturn.test.ts
- [x] `should accept include on the post side` — `post.updateManyAndReturn({ include: { user: true } })` returns post with nested user [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-updateManyAndReturn.test.ts
- [x] `should fail include on the user side` — include `posts` rejects (Unknown field posts for include on UpdateManyUserAndReturnOutputType) [providers: postgres,cockroach,sqlite] → non-ported
- [x] `take should fail` — `updateManyAndReturn({ take: 1 })` rejects (Unknown argument take) [providers: postgres,cockroach,sqlite] → non-ported
- [x] `orderBy should fail` — `updateManyAndReturn({ orderBy })` rejects (Unknown argument orderBy) [providers: postgres,cockroach,sqlite] → non-ported
- [x] `distinct should fail` — `updateManyAndReturn({ distinct })` rejects (Unknown argument distinct) [providers: postgres,cockroach,sqlite] → non-ported
- [x] `select _count should fail` — select `_count` rejects (Unknown field _count for select) [providers: postgres,cockroach,sqlite] → passing: test/ports/prisma/functional/methods-updateManyAndReturn.test.ts
- [x] `include _count should fail` — include `_count` rejects (Unknown field _count for include) [providers: postgres,cockroach,sqlite] → test.fails: test/ports/prisma/functional/methods-updateManyAndReturn.test.ts

### packages/client/tests/functional/methods/updateManyAndReturn-unsupported/tests.ts
- [x] `should fail as updateManyAndReturn is not supported on tested providers` — `prisma.user` lacks `updateManyAndReturn` (@ts-expect-error + expectTypeOf not.toHaveProperty) [providers: sqlserver,mongodb,mysql] → non-ported

### packages/client/tests/functional/methods/upsert/native-atomic/tests.ts
- [x] `should only use ON CONFLICT when update arguments do not have any nested queries` — verifies upsert avoids ON CONFLICT for nested upsert/create/update/delete in update, but uses it with no nested mutation (via query-log checker) [providers: sqlite,postgres,cockroach] → non-ported
- [x] `should only use ON CONFLICT when there is only 1 unique field in the where clause` — two unique fields in where → no ON CONFLICT; single unique field → ON CONFLICT [providers: sqlite,postgres,cockroach] → non-ported
- [x] `should only use ON CONFLICT when the unique field defined in where clause has the same value as defined in the create arguments` — mismatched where/create name → no ON CONFLICT; matching → ON CONFLICT [providers: sqlite,postgres,cockroach] → non-ported
- [x] `should perform an upsert using ON CONFLICT` — insert then update by name; asserts values and native upsert used both times [providers: sqlite,postgres,cockroach] → ports/prisma/functional/methods-upsert-native-atomic.test.ts
- [x] `should perform an upsert using ON CONFLICT with id` — upsert by id then by name; asserts values and native upsert used [providers: sqlite,postgres,cockroach] → ports/prisma/functional/methods-upsert-native-atomic.test.ts
- [x] `should perform an upsert using ON CONFLICT with compound id` — compound `id1_id2` upsert creates then updates val; native upsert used [providers: sqlite,postgres,cockroach] → ports/prisma/functional/methods-upsert-native-atomic.test.ts
- [x] `should perform an upsert using ON CONFLICT with compound uniques` — compound `uniques` (field1,field2) upsert creates then updates val; native upsert used [providers: sqlite,postgres,cockroach] → ports/prisma/functional/methods-upsert-native-atomic.test.ts

### packages/client/tests/functional/methods/upsert/simple/tests.ts
- [x] `should create a record using upsert` — upsert on non-existent name creates it; count where name is 1 [providers: all] → ports/prisma/functional/methods-upsert-simple.test.ts
- [x] `should update a record using upsert` — upsert on existing name updates to name+'new'; old name count 0, new name count 1 [providers: all] → ports/prisma/functional/methods-upsert-simple.test.ts

### packages/client/tests/functional/mixed-string-uuid-datetime-list-inputs/tests.ts
- [x] `create with two strings` — creates a Post with `words: ['hello','world']`, asserts the created row and the findUnique read-back both equal the input array [providers: postgres,cockroach,mongodb] → ports/prisma/functional/mixed-string-uuid-datetime-list-inputs.test.ts
- [x] `create with a string that looks like a date` — creates rows with one and two ISO-date-looking strings, round-trips them unchanged [providers: postgres,cockroach,mongodb] → ports/prisma/functional/mixed-string-uuid-datetime-list-inputs.test.ts
- [x] `create with a string and a string that looks like a date` — creates rows mixing a plain string and a date-looking string in both orders, round-trips unchanged [providers: postgres,cockroach,mongodb] → ports/prisma/functional/mixed-string-uuid-datetime-list-inputs.test.ts
- [x] `create a string that looks like a uuid` — creates rows with one and two UUID-looking strings, round-trips unchanged [providers: postgres,cockroach,mongodb] → ports/prisma/functional/mixed-string-uuid-datetime-list-inputs.test.ts
- [x] `create with a string and a string that looks like a uuid` — mixes plain string with lower/upper-case UUID strings in different order, round-trips unchanged [providers: postgres,cockroach,mongodb] → ports/prisma/functional/mixed-string-uuid-datetime-list-inputs.test.ts
- [x] `create with a date and uuid` — creates rows combining date-looking and UUID-looking strings, round-trips unchanged [providers: postgres,cockroach,mongodb] → ports/prisma/functional/mixed-string-uuid-datetime-list-inputs.test.ts
- [x] `create with a string, date and uuid` — creates all permutations of [string, date, uuid] array, asserts each permutation round-trips unchanged [providers: postgres,cockroach,mongodb] → ports/prisma/functional/mixed-string-uuid-datetime-list-inputs.test.ts

### packages/client/tests/functional/multi-schema/tests.ts
- [x] `multischema > create` — creates a User with nested post, asserts result matches email + posts [providers: postgres,sqlserver] (mapTable axis: IDENTICAL_NAMES/DIFFERENT_NAMES/false) → ported: test/ports/prisma/functional/multi-schema.test.ts (postgres passing; IDENTICAL_NAMES read/update are test.fails; sqlserver non-ported — see ledgers)
- [x] `multischema > read` — findMany User by email and nested post title, asserts match [providers: postgres,sqlserver] → ported: test/ports/prisma/functional/multi-schema.test.ts (postgres passing; IDENTICAL_NAMES read/update are test.fails; sqlserver non-ported — see ledgers)
- [x] `multischema > update` — updateMany post and user, then findMany with new values asserts match [providers: postgres,sqlserver] → ported: test/ports/prisma/functional/multi-schema.test.ts (postgres passing; IDENTICAL_NAMES read/update are test.fails; sqlserver non-ported — see ledgers)
- [x] `multischema > delete` — deleteMany post and user, asserts both findMany return length 0 [providers: postgres,sqlserver] → ported: test/ports/prisma/functional/multi-schema.test.ts (postgres passing; IDENTICAL_NAMES read/update are test.fails; sqlserver non-ported — see ledgers)

### packages/client/tests/functional/multiple-types/tests.ts
- [x] `Bool field: true or false should succeed` — creates bool true/false rows, asserts $queryRaw result equals findMany (all-null other fields); skipped on D1/MySQL [providers: exclude:mongodb (skipTestIf D1||mysql)] → ports/prisma/functional/multiple-types.test.ts
- [x] `String field: true or false as string should succeed` — creates string 'true'/'false' rows, asserts $queryRaw equals findMany [providers: exclude:mongodb] → ports/prisma/functional/multiple-types.test.ts
- [x] `shows differences between queryRaw and findMany` — creates row with all scalar types, asserts queryRaw vs findMany differ for bool/dec on D1/MySQL and match otherwise [providers: exclude:mongodb] → non-ported
- [x] `a record with all fields set to null should succeed` — creates empty record, asserts queryRaw equals findMany with all nulls [providers: exclude:mongodb] → ports/prisma/functional/multiple-types.test.ts
- [x] `2 records, 1st with null, 2nd with values should succeed` — creates null + full record, asserts queryRaw shape and D1/MySQL divergence from findMany [providers: exclude:mongodb] → ports/prisma/functional/multiple-types.test.ts
- [x] `all fields are null` — creates empty record, asserts queryRaw equals findMany with all nulls [providers: exclude:mongodb] → ports/prisma/functional/multiple-types.test.ts

### packages/client/tests/functional/mysql-bit-type/tests.ts
- [ ] `bytes field > all bytes` — creates row with 8-byte uint64, asserts result.uint64 equals input bytes [providers: mysql-only]
- [ ] `bytes field > empty byte array` — creates row with empty byte array, asserts result padded to 8 zero bytes [providers: mysql-only]
- [ ] `bytes field > too many bytes` — creating with 9 bytes rejects with out-of-range/too-long error [providers: mysql-only]
- [ ] `boolean fields` — creates row bool1 true / bool2 false, asserts result matches [providers: mysql-only]
- [ ] `raw query` — `$queryRaw SELECT b'1' AS bit` returns Uint8Array [1] [providers: mysql-only]

### packages/client/tests/functional/naming-conflict/built-in-types-vs-enum/tests.ts
- [x] `allows to create enum with conflicting name` — creates enumHolder with value 'ONE', asserts value is 'ONE' and type is `'ONE'|'TWO'` [providers: postgres,mysql,mongodb,cockroach] (enumName axis: all builtInNames) → non-ported (whole enumName axis, 67 name-cases; per-case entries in non-ported.md)

### packages/client/tests/functional/naming-conflict/built-in-types-vs-model/tests.ts
- [x] `allows to use ${typeName} name for a model name` — creates model of conflicting builtin type name, findFirstOrThrow asserts row {id, isUserProvidedType:true} and non-any type [providers: all] (typeName axis: all builtInNames) → non-ported (whole typeName axis, 67 name-cases; per-case entries in non-ported.md)
- [x] `allows to use ${typeName} name for a model name (relation)` — findFirstOrThrow relationHolder including the model relation, asserts included model row and non-any type [providers: all] (typeName axis: all builtInNames) → non-ported (whole typeName axis, 67 name-cases; per-case entries in non-ported.md)

### packages/client/tests/functional/naming-conflict/model-vs-model/tests.ts
- [x] `allows to use models of conflicting names` — creates model with nested `other`, findFirstOrThrow with include asserts other row {id,name} and non-any type [providers: all] (conflictingModel axis: ModelUpdate…ModelGroupBy) → non-ported (whole conflictingModel axis, 12 cases; per-case entries in non-ported.md)

### packages/client/tests/functional/omit/test.ts
- [x] `non-existing true field in omit throw validation error` — findFirstOrThrow with unknown omit field `true` rejects with inline-snapshot validation error [providers: all] → non-ported
- [x] `non-existing false field in omit throw validation error` — findFirstOrThrow with unknown omit field `false` rejects with inline-snapshot validation error [providers: all] → non-ported
- [x] `omit + select throws validation error` — findFirstOrThrow with both select and omit rejects "use omit or select, not both" [providers: all] → non-ported
- [x] `deeply nested omit + select throws validation error` — nested posts select+omit rejects "use omit or select, not both" [providers: all] → non-ported
- [x] `excluding all fields of a model throws validation error` — omit all scalar fields rejects "at least one field must be included" [providers: all] → non-ported
- [x] `create` — create User with omit password, asserts no password property, type lacks password [providers: all] → non-ported
- [x] `createManyAndReturn` — createManyAndReturn with omit password, asserts row has no password and type lacks it; skipped on sqlserver/mongodb/mysql [providers: sqlite,postgres,cockroach (skipTestIf sqlserver,mongodb,mysql)] → non-ported
- [x] `findUnique` — findUnique with omit password, asserts no password [providers: all] → non-ported
- [x] `findFirst` — findFirst with omit password, asserts no password [providers: all] → non-ported
- [x] `findFirstOrThrow` — findFirstOrThrow with omit password, asserts no password [providers: all] → non-ported
- [x] `findUniqueOrThrow` — findUniqueOrThrow with omit password, asserts no password [providers: all] → non-ported
- [x] `update` — update email with omit password, asserts no password [providers: all] → non-ported
- [x] `upsert` — upsert with omit password, asserts no password [providers: all] → non-ported
- [x] `false value` — omit password:false returns password value ('cheese') [providers: all] → non-ported
- [x] `omit combined with include` — findFirstOrThrow include posts + omit password, asserts posts present and no password [providers: all] → non-ported
- [x] `omit nested in select` — select author with nested omit password, asserts author has no password [providers: all] → non-ported
- [x] `omit nested in include` — include author with nested omit password, asserts author has no password [providers: all] → non-ported
- [x] `excluding computed fields` — $extends result computed field, omit it, asserts absent while other fields present [providers: all] → non-ported
- [x] `excluding dependency of a computed field` — omit password (a computed field's `needs` dependency), asserts password absent but computed sanitizedPassword still resolves [providers: all] → non-ported

### packages/client/tests/functional/optimistic-concurrency-control/tests.ts
- [x] `updateMany` — 5 parallel OCC updateMany on occStamp, asserts final occStamp is 1 (documents non-atomic behavior); skipped on relationMode=prisma [providers: all (skipTestIf relationMode=prisma)] → non-ported
- [x] `update` — 5 parallel OCC update on occStamp, asserts final occStamp is 1; skipped on relationMode=prisma [providers: all (skipTestIf relationMode=prisma)] → non-ported
- [x] `deleteMany` — 5 parallel deleteMany where occStamp=0, asserts total deleted count is 1; only runs excluding mongodb/cockroach/sqlite [providers: postgres,mysql,sqlserver (testIf)] → ports/prisma/functional/optimistic-concurrency-control.test.ts
- [x] `upsert` — 5 parallel OCC upsert, asserts final occStamp is 1; excludes mysql [providers: exclude:mysql (testIf)] → non-ported
- [x] `update with upsert relation` — 5 parallel update with nested child upsert, asserts occStamp 1 and child count 1 [providers: all] → non-ported

### packages/client/tests/functional/order-by-null/tests.ts
- [x] `should return records sorted by name asc and null first` — findMany orderBy name asc nulls first, asserts nulls precede 'a','b' [providers: exclude:mongodb] → non-ported
- [x] `should return records sorted by name asc and null last` — findMany orderBy name asc nulls last, asserts 'a','b' precede nulls [providers: exclude:mongodb] → non-ported
- [x] `should return records sorted by name desc and null first` — findMany orderBy name desc nulls first, asserts nulls precede 'b','a' [providers: exclude:mongodb] → non-ported
- [x] `should return records sorted by name desc and null last` — findMany orderBy name desc nulls last, asserts 'b','a' precede nulls [providers: exclude:mongodb] → non-ported

### packages/client/tests/functional/postgres_raw_query_parameter_types/test.ts
- [ ] `$queryRaw works with different parameter types` — issues two identical-text $queryRaw with int vs decimal param, verifies prepared-statement cache respects param types (no type-mismatch error) [providers: postgres-only]

### packages/client/tests/functional/prisma-dot-dmmf/tests.ts
- [ ] `Prisma.dmmf in JS client > exports Prisma.dmmf (default)` — asserts Prisma.dmmf matches snapshot; only runs when generatorType is prisma-client-js (describeIf) [providers: all, skipDb]

### packages/client/tests/functional/prisma-promise/tests.ts
- [ ] `%s > repeated calls to .then` `[each]` — for each operation (create, createMany[non-sqlite], findMany, findFirst, findUnique, findUniqueOrThrow, findFirstOrThrow, update, updateMany, delete, deleteMany, aggregate, count, $queryRaw/$queryRawUnsafe/$executeRaw/$executeRawUnsafe[non-mongodb], $runCommandRaw[mongodb]), asserts two `.then()` calls give strictEqual result [providers: all]
- [ ] `%s > repeated calls to .catch` `[each]` — asserts two `.catch()` calls give strictEqual result [providers: all]
- [ ] `%s > repeated calls to .finally` `[each]` — asserts two `.finally()` calls give strictEqual result [providers: all]
- [ ] `%s > repeated mixed calls to .then, .catch, .finally` `[each]` — asserts mixed chaining orders give strictEqual result [providers: all]
- [ ] `%s > fluent promises should have promise properties` `[each]` — asserts 'then'/'finally'/'catch' present on the returned PrismaPromise [providers: all]

### packages/client/tests/functional/query-error-logging/tests.ts
- [ ] `findUniqueOrThrown when error thrown` — findUniqueOrThrow rejects with P2025 PrismaClientKnownRequestError; asserts exactly one error LogEvent captured via `$on('error')`, message contains "operation failed because it depends on... required but not found", target contains `user.findUniqueOrThrow` [providers: all]
- [ ] `findFirstOrThrow when error thrown` — findFirstOrThrow rejects with P2025; asserts one error LogEvent, same message, target contains `user.findFirstOrThrow` [providers: all]

### packages/client/tests/functional/query-validation/tests.ts
- [x] `include and select are used at the same time` — findMany with both select+include rejects with inline-snapshot error "Please either use include or select, but not both" [providers: all] → non-ported
- [x] `include used on scalar field` — findMany include on scalar `id` rejects: "Invalid scalar field id for include statement on model User" [providers: all] → non-ported
- [x] `undefined within array` — findMany where OR:[undefined] rejects: "Can not use undefined value within array" [providers: all] → non-ported
- [x] `unknown selection field` — findMany select notThere rejects: "Unknown field notThere for select statement on model User" [providers: all] → non-ported
- [x] `empty selection` — findMany select:{} rejects: "The select statement for type User must not be empty" [providers: all] → non-ported
- [x] `unknown argument` — findMany with notAnArgument rejects "Unknown argument"; branches snapshot on relationJoins previewFeature + provider support (extra relationLoadStrategy option) [providers: all] → non-ported
- [x] `unknown object field` — findMany where notAValidField rejects "Unknown argument notAValidField" listing UserWhereInput options [providers: all] → non-ported
- [x] `missing required argument: nested` — user.create data:{} rejects "Argument email is missing" [providers: all] → non-ported
- [x] `invalid argument type` — findUnique where email:123 rejects "Expected String, provided Int" [providers: all] → non-ported
- [x] `invalid field ref` — findFirst where name.gt=prisma.pet.fields.name rejects "Expected a referenced scalar field of model User, but found a field of model Pet" [providers: all] → non-ported
- [x] `union error` — findMany where email:123 rejects "Expected StringFilter or String, provided Int" [providers: all] → non-ported
- [x] `union error: different paths` — findMany where email.gt:123 rejects "Expected String or StringFieldRefInput, provided Int" [providers: all] → non-ported
- [x] `union error: invalid argument type vs required argument missing` — user.create with email:123 rejects "Expected String, provided Int" (issue 19707) [providers: all] → non-ported
- [x] `invalid argument value` — findMany where createdAt.gt:'yesterday' rejects "input contains invalid characters. Expected ISO-8601 DateTime" [providers: all] → non-ported
- [x] `missing one of the specific required fields` — findUnique where:{} rejects "needs at least one of id, email or organizationId arguments" [providers: all] → non-ported
- [x] `non-serializable value` — findMany where name:()=>'foo' rejects "We could not serialize [object Function] value" [providers: all] → non-ported

### packages/client/tests/functional/raw-queries/mongo-sequential-tx/tests.ts
- [ ] `mongo raw queries should work in a sequential transaction` — `$transaction([$runCommandRaw insert, findRaw, aggregateRaw])` returns `[{n:1,ok:1}, [{_id:10,field:'A'}], [{_id:10,field:'A'}]]` [providers: mongodb-only]

### packages/client/tests/functional/raw-queries/mysql-column-type/test.ts
- [ ] `columns with _bin collation return strings, not Uint8Array` — after altering char/varchar/text columns to utf8mb4_bin and creating a user, `$queryRaw` returns those columns as string 'hello' (not Uint8Array) [providers: mysql-only]

### packages/client/tests/functional/raw-queries/send-type-hints/tests.ts
- [ ] `Uint8Array ($queryRaw)` — INSERT binary via `$queryRaw` template (MySQL vs quoted-identifier branch), findUnique returns binary equal to Uint8Array [1,2,3] [providers: exclude:mongodb]
- [ ] `Uint8Array ($executeRaw)` — same insert via `$executeRaw` template, findUnique binary equals Uint8Array [1,2,3] [providers: exclude:mongodb]
- [ ] `Uint8Array ($queryRaw + Prisma.sql)` — insert via `$queryRaw(Prisma.sql...)`, binary round-trips [providers: exclude:mongodb]
- [ ] `Uint8Array ($executeRaw + Prisma.sql)` — insert via `$executeRaw(Prisma.sql...)`, binary round-trips [providers: exclude:mongodb]

### packages/client/tests/functional/raw-queries/typed-results-advanced-and-native-types/tests.ts
- [ ] `query model with multiple fields` — create testModel with json, string_list, bInt_list, date, time; `$queryRaw SELECT *` returns json object, string list, bigint list (asserted individually as -1234/1234), date normalized to midnight, time to 1970 epoch date [providers: postgres,cockroach]

### packages/client/tests/functional/raw-queries/typed-results/tests.ts
- [ ] `simple expression` — `$queryRaw SELECT 1 + 1` returns 2 [providers: exclude:mongodb]
- [ ] `query model with multiple types` — create testModel with all scalar types; `$queryRaw SELECT *` returns full shape; bool is 1 for js_d1/mysql else true, dec is number for js_d1 else Decimal; bInt is number for js_d1 else bigint 12345 [providers: exclude:mongodb]
- [ ] `query model with a BigInt = 2147483647 (i32)` — bInt round-trips as bigint (or number for js_d1) [providers: exclude:mongodb]
- [ ] `query model with a BigInt = -2147483647 (-i32)` — bInt round-trips as bigint (or number for js_d1) [providers: exclude:mongodb]
- [ ] `query model with a BigInt = MAX_SAFE_INTEGER` — bInt 9007199254740991 round-trips as bigint (or number for js_d1) [providers: exclude:mongodb]
- [ ] `query model with a BigInt = -MAX_SAFE_INTEGER` — bInt -9007199254740991 round-trips as bigint (or number for js_d1) [providers: exclude:mongodb]
- [ ] `when BigInt value is not a safe integer > query model with a BigInt = MAX_SAFE_INTEGER + MAX_SAFE_INTEGER > BigInt is natively supported` — [testIf isBigIntNativelySupported] create bInt=2*MAX_SAFE, result equals bigint 18014398509481982n [providers: exclude:mongodb]
- [ ] `when BigInt value is not a safe integer > query model with a BigInt = MAX_SAFE_INTEGER + MAX_SAFE_INTEGER > BigInt is not natively supported` — [testIf !isBigIntNativelySupported, js_d1] create rejects "Invalid Int64-encoded value received: 18014398509481982" [providers: exclude:mongodb]
- [ ] `when BigInt value is not a safe integer > query model with a BigInt = -(MAX_SAFE_INTEGER + MAX_SAFE_INTEGER) > BigInt is natively supported` — [describe.skip][testIf] create rejects with driver-adapter-specific out-of-range messages (libsql/neon/pg/planetscale branches) [providers: exclude:mongodb]
- [ ] `when BigInt value is not a safe integer > query model with a BigInt = -(MAX_SAFE_INTEGER + MAX_SAFE_INTEGER) > BigInt is not natively supported` — [describe.skip][testIf] create rejects "Invalid Int64-encoded value received: -18014398509481982" [providers: exclude:mongodb]

### packages/client/tests/functional/reconnect-failure/tests.ts
- [ ] `example` — with db dropped, first `user.findMany()` rejects; after `db.setupDb()`, findMany resolves to `[]` (skipDb, skipDefaultClientInstance, skip js_mssql, skip remote executor) [providers: exclude:mongodb]

### packages/client/tests/functional/reconnect/tests.ts
- [ ] `can disconnect and reconnect` — findMany, `$disconnect()`, `$connect()`, findMany again all succeed (skipDriverAdapter js_pg_cockroachdb) [providers: all]

### packages/client/tests/functional/referentialActions-setDefault/tests_1-to-1.ts
- [x] `1:n mandatory (explicit) > [create] > [create] creating a table with SetDefault is accepted` — createTemplate (users 1 & default, profile userId=1); findMany include profile matches user1→profile, defaultUser→null [providers: postgres,cockroach,sqlserver,sqlite,mysql (optOut mongodb; skip js_planetscale)] → passing: test/ports/prisma/functional/referential-actions-set-default-1to1.test.ts
- [x] `1:n mandatory (explicit) > [update] > with mysql > [update] changing existing user id to a new one triggers NoAction under the hood` — [describeIf mysql] user.update id 1→2 rejects FK constraint on (userId) [providers: mysql-only] → non-ported (mysql-only)
- [x] `1:n mandatory (explicit) > [update] > without mysql > [update] changing existing user id to a new one triggers SetDefault` — [describeIf !mysql] user.update id 1→2 succeeds; profile.userId set to defaultUserId [providers: postgres,cockroach,sqlserver,sqlite] → passing: test/ports/prisma/functional/referential-actions-set-default-1to1.test.ts
- [x] `1:n mandatory (explicit) > [update] > [update] removing user with default id and changing existing user id to a new one triggers SetDefault in profile, which throws` — delete defaultUser then update id 1→2 rejects with provider/adapter-specific FK constraint error [providers: postgres,cockroach,sqlserver,sqlite,mysql] → passing: test/ports/prisma/functional/referential-actions-set-default-1to1.test.ts
- [x] `1:n mandatory (explicit) > [delete] > with mysql > [delete] changing existing user id to a new one triggers NoAction under the hood` — [describeIf mysql] user.delete id 1 rejects FK constraint on (userId) [providers: mysql-only] → non-ported (mysql-only)
- [x] `1:n mandatory (explicit) > [delete] > without mysql > [delete] deleting existing user one triggers SetDefault` — [describeIf !mysql] delete user 1 succeeds; profile.userId set to defaultUserId [providers: postgres,cockroach,sqlserver,sqlite] → passing: test/ports/prisma/functional/referential-actions-set-default-1to1.test.ts
- [x] `1:n mandatory (explicit) > [delete] > [delete] removing user with default id and changing existing user id to a new one triggers SetDefault in profile, which throws` — delete defaultUser then delete user 1 rejects with provider/adapter-specific FK constraint error [providers: postgres,cockroach,sqlserver,sqlite,mysql] → passing: test/ports/prisma/functional/referential-actions-set-default-1to1.test.ts

### packages/client/tests/functional/referentialActions-setDefault/tests_1-to-n.ts
- [x] `1:n mandatory (explicit) > [create] > [create] creating a table with SetDefault is accepted` — createTemplate (users 1 & default, post userId=1); findMany include posts matches user1→[post], defaultUser→[] [providers: postgres,cockroach,sqlserver,sqlite,mysql (optOut mongodb; skip js_planetscale)] → passing: test/ports/prisma/functional/referential-actions-set-default-1ton.test.ts
- [x] `1:n mandatory (explicit) > [update] > with mysql > [update] changing existing user id to a new one triggers NoAction under the hood` — [describeIf mysql] user.update id 1→2 rejects FK constraint on (userId) [providers: mysql-only] → non-ported (mysql-only)
- [x] `1:n mandatory (explicit) > [update] > without mysql > [update] changing existing user id to a new one triggers SetDefault` — [describeIf !mysql] user.update id 1→2 succeeds; post.userId set to defaultUserId [providers: postgres,cockroach,sqlserver,sqlite] → passing: test/ports/prisma/functional/referential-actions-set-default-1ton.test.ts
- [x] `1:n mandatory (explicit) > [update] > [update] removing user with default id and changing existing user id to a new one triggers SetDefault in post, which throws` — delete defaultUser then update id 1→2 rejects with provider/adapter-specific FK constraint error [providers: postgres,cockroach,sqlserver,sqlite,mysql] → passing: test/ports/prisma/functional/referential-actions-set-default-1ton.test.ts
- [x] `1:n mandatory (explicit) > [delete] > with mysql > [delete] changing existing user id to a new one triggers NoAction under the hood` — [describeIf mysql] user.delete id 1 rejects FK constraint on (userId) [providers: mysql-only] → non-ported (mysql-only)
- [x] `1:n mandatory (explicit) > [delete] > without mysql > [delete] deleting existing user one triggers SetDefault` — [describeIf !mysql] delete user 1 succeeds; post.userId set to defaultUserId [providers: postgres,cockroach,sqlserver,sqlite] → passing: test/ports/prisma/functional/referential-actions-set-default-1ton.test.ts
- [x] `1:n mandatory (explicit) > [delete] > [delete] removing user with default id and changing existing user id to a new one triggers SetDefault in post, which throws` — delete defaultUser then delete user 1 rejects with provider/adapter-specific FK constraint error [providers: postgres,cockroach,sqlserver,sqlite,mysql] → passing: test/ports/prisma/functional/referential-actions-set-default-1ton.test.ts

### packages/client/tests/functional/referentialIntegrity-property-deprecated/tests.ts
- [ ] `relationMode with deprecated referentialIntegrity datasource property > [create] and [delete] should succeed` — create user with nested profile; findMany returns user {id:'1',enabled:null} and profile {id:'1',userId:'1',enabled:null}; deleteMany users cascades to delete profiles (both empty) [providers: sqlite-only (skip js_libsql)]

### packages/client/tests/functional/relation-load-strategy-unsupported/preview-feature-disabled.ts
- [ ] `relationLoadStrategy with no relationJoins preview feature > findMany` — with relationJoins preview off, relationLoadStrategy on findMany rejects (unknown argument) [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > findFirst` — same, on findFirst [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > findFirstOrThrow` — same, on findFirstOrThrow [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > findUnique` — same, on findUnique [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > findUniqueOrThrow` — same, on findUniqueOrThrow [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > create` — same, on create [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > update` — same, on update [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > delete` — same, on delete [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > upsert` — same, on upsert [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > aggregate` — same, on aggregate [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > groupBy` — same, on groupBy [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > createMany` — [testIf provider not in sqlite/sqlserver/mongodb] same, on createMany (snapshot with skipDuplicates option) [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > createMany (sqlserver, mongodb)` — [testIf provider in sqlserver/mongodb] same, on createMany (snapshot without skipDuplicates) [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > updateMany` — same, on updateMany [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > deleteMany` — same, on deleteMany [providers: all]
- [ ] `relationLoadStrategy with no relationJoins preview feature > count` — same, on count [providers: all]

### packages/client/tests/functional/relation-load-strategy-unsupported/unsupported-strategy-for-db.ts
- [ ] `using load strategy that is not supported for provider` — [testIf: relationJoins enabled but provider doesn't support joins] findMany with relationLoadStrategy:'query' + include rejects with unknown-argument inline snapshot [providers: all except postgres/cockroach/mysql at runtime]

### packages/client/tests/functional/relation-load-strategy/supported-queries.ts
- [ ] `relationLoadStrategy in supported queries > findMany` — nested user→posts→comments→author select returns expected shape; asserts query count (join≥1, query≥4) and that a relation join (LATERAL/JSON_OBJECT) is used iff strategy=join [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > findFirst` — findFirst with same nested select for author returns expected object; join used iff requested, query-count assertion [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > findFirstOrThrow` — same as findFirst via findFirstOrThrow; join-used-if-requested + query count [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > findUnique` — findUnique by login with nested select; join-used-if-requested + query count [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > findUniqueOrThrow` — findUniqueOrThrow variant; join-used-if-requested + query count [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > create` — create user with nested comment.connect; returns nested comment→post; query count (join≥6, query≥8 / mongodb 6) and join-if-requested [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > update` — update user login, select posts→comments; query count (join≥4, query≥6) + join-if-requested [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > delete` — delete user, returns nested posts→comments of deleted row; query count (join≥4, query≥6) + join-if-requested [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > upsert` — upsert existing user (update path), select comments→post; query count (join≥5, query≥7 / mongodb 6) + join-if-requested [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in supported queries > create with no relation selection` — create user selecting only scalar; asserts equal shape and that relation join is NOT used (no relations loaded) [providers: postgres,cockroach,mysql]

### packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts
- [ ] `relationLoadStrategy in unsupported positions > nested subquery in findMany using include` — relationLoadStrategy on a nested include rejects with "Unknown argument relationLoadStrategy" inline snapshot [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in unsupported positions > nested subquery in findMany using select` — relationLoadStrategy on a nested select rejects with unknown-argument snapshot [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in unsupported positions > aggregate` — relationLoadStrategy on aggregate rejects with unknown-argument snapshot [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in unsupported positions > groupBy` — relationLoadStrategy on groupBy rejects with unknown-argument snapshot [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in unsupported positions > createMany` — [testIf provider not in sqlite/sqlserver/mongodb] relationLoadStrategy on createMany rejects with unknown-argument snapshot [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in unsupported positions > updateMany` — relationLoadStrategy on updateMany rejects with unknown-argument snapshot [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in unsupported positions > deleteMany` — relationLoadStrategy on deleteMany rejects with unknown-argument snapshot [providers: postgres,cockroach,mysql]
- [ ] `relationLoadStrategy in unsupported positions > count` — relationLoadStrategy on count rejects with unknown-argument snapshot [providers: postgres,cockroach,mysql]

### packages/client/tests/functional/relationMode-17255-mixed-actions/tests.ts
- [ ] `original > [update] main with nested delete alice should succeed` — update Main id=1 with nested `alice.delete`; bob count unchanged, Main.aliceId becomes null (SetNull side), alice row 1 deleted, bob rows intact [providers: all]
- [ ] `original > [update] main with nested disconnect alice should succeed` — update Main id=1 with nested `alice.disconnect`; no deletion, Main.aliceId null, alice/bob rows intact [providers: all]

### packages/client/tests/functional/relationMode-17255-same-actions/tests.ts
- [ ] `not-original > onUpdate: Restrict, NoAction, SetNull > relationMode=foreignKeys [update] main with nested delete alice should fail` — [describeIf onUpdate in Restrict/NoAction/SetNull] update Main with nested `alice.delete` rejects (FK violation / required-relation error via ConditionalError), bob count unchanged, all rows unchanged [providers: all]
- [ ] `not-original > onDelete: DEFAULT > [update] main with nested delete alice should succeed` — [describeIf onDelete=DEFAULT] nested alice.delete succeeds, Main.aliceId set null, alice row 1 deleted, bob unchanged [providers: all]
- [ ] `not-original > onDelete: Cascade > [update] main with nested delete alice should succeed` — [describeIf onDelete=Cascade] nested alice.delete cascades: Main row 1 and bob row 1 also deleted (bob count −1) [providers: all]
- [ ] `not-original > onDelete: Cascade > [update] main with nested disconnect alice should succeed` — [describeIf onDelete=Cascade] nested alice.disconnect: no deletion, Main.aliceId null, alice/bob rows intact [providers: all]

### packages/client/tests/functional/relationMode-in-separate-gh-action/tests_1-to-1.ts
- [ ] `1:1 mandatory (explicit) > [create] > relationMode=prisma [create] child with non existing parent should succeed` — [testIf prisma] create profile with non-existing userId succeeds under prisma emulation [providers: all]
- [ ] `1:1 mandatory (explicit) > [create] > relationMode=foreignKeys [create] child with non existing parent should throw` — [testIf foreignKeys] create profile with non-existing userId throws FK violation (ConditionalError snapshot per provider) [providers: all]
- [ ] `1:1 mandatory (explicit) > [create] > [create] child with undefined parent should throw with type error` — create profile with userId:undefined rejects "Argument `user` is missing." [providers: all]
- [ ] `1:1 mandatory (explicit) > [create] > [create] nested child [create] should succeed` — create user with nested profile.create; both rows present with correct userId [providers: all]
- [ ] `1:1 mandatory (explicit) > [update] > [update] (user) optional boolean field should succeed` — update user.enabled=true; profiles unchanged [providers: all]
- [ ] `1:1 mandatory (explicit) > [update] > [update] (profile) optional boolean field should succeed` — update profile.enabled=true; users unchanged [providers: all]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [upsert] child id with non-existing id should succeed` — [describeIf !mongodb] upsert profile changing id to non-existing succeeds; rows reflect new id [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] child id with non-existing id should succeed` — [describeIf !mongodb] update profile id to non-existing succeeds [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] nested child [connect] child should succeed if the relationship didn't exist` — [describeIf !mongodb] connect existing profile to new user reassigns profile.userId [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] nested child [update] should succeed` — [describeIf !mongodb] nested profile.update changes profile id [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: DEFAULT, Cascade > [update] parent id with non-existing id should succeed` — [describeIf onUpdate DEFAULT/Cascade] update user id to non-existing cascades to profile.userId [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: DEFAULT, Cascade > [updateMany] parent id should succeed` — [describeIf onUpdate DEFAULT/Cascade] updateMany user id succeeds, profile.userId follows [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: Restrict, NoAction > [update] parent id with non-existing id should throw` — [describeIf onUpdate Restrict/NoAction] update user id throws FK/required-relation error; rows unchanged [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: Restrict, NoAction > [updateMany] parent id with non-existing id should throw` — [describeIf onUpdate Restrict/NoAction] updateMany user id throws same error [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: DEFAULT, Restrict, NoAction, SetNull > [update] parent id with existing id should throw` — [describeIf onUpdate in set] update user id to existing id throws unique/required-relation error [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: DEFAULT, Restrict, NoAction, SetNull > [updateMany] parent id with existing id should throw` — [describeIf onUpdate in set] updateMany user id to existing throws [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: DEFAULT, Restrict, NoAction, SetNull > [update] child id with existing id should throw` — [describeIf onUpdate in set] update profile id to existing profile id throws unique-constraint error [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: DEFAULT, Restrict, NoAction, SetNull > [update] nested child [disconnect] should throw` — [describeIf onUpdate in set] nested profile.disconnect on required relation throws required-relation error [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] nested child [connect] should succeed if the relationship already existed` — [describeIf !mongodb] connect profile to its already-connected user is a no-op success [providers: exclude:mongodb]
- [ ] `1:1 mandatory (explicit) > [delete] > [delete] child should succeed` — delete profile id=1; user 1 now has profile null, profile row removed [providers: all]
- [ ] `1:1 mandatory (explicit) > [delete] > [delete] child and then [delete] parent should succeed` — delete profile then its user; both removed, other pair intact [providers: all]
- [ ] `1:1 mandatory (explicit) > [delete] > onDelete: DEFAULT, Restrict, NoAction > [delete] parent should throw` — [describeIf onDelete DEFAULT/Restrict/NoAction] delete user with existing profile throws FK/required-relation; rows unchanged [providers: all]
- [ ] `1:1 mandatory (explicit) > [delete] > onDelete: DEFAULT, Restrict, NoAction > [deleteMany] parents should throw` — [describeIf onDelete DEFAULT/Restrict/NoAction] deleteMany users throws; rows unchanged [providers: all]
- [ ] `1:1 mandatory (explicit) > [delete] > onDelete: SetNull > [delete] parent should throw` — [describeIf onDelete SetNull][testIf foreignKeys] delete user throws FK violation (required userId) [providers: all]
- [ ] `1:1 mandatory (explicit) > [delete] > onDelete: SetNull > [deleteMany] parents should throw` — [describeIf onDelete SetNull][testIf foreignKeys] deleteMany users throws [providers: all]
- [ ] `1:1 mandatory (explicit) > [delete] > onDelete: SetNull > relationMode=prisma / SetNull: [delete] parent should throw` — [describeIf onDelete SetNull][testIf prisma][test.fails] documents that prisma-emulated SetNull does NOT throw (issue #15683) [providers: all]
- [ ] `1:1 mandatory (explicit) > [delete] > onDelete: SetNull > relationMode=prisma / SetNull: [deleteMany] parents should throw` — [describeIf onDelete SetNull][testIf prisma][test.fails] same, deleteMany does not throw under prisma emulation [providers: all]
- [ ] `1:1 mandatory (explicit) > [delete] > onDelete: Cascade > [delete] parent should succeed` — [describeIf onDelete Cascade] delete user cascades to profile; both gone [providers: all]

### packages/client/tests/functional/relationMode-in-separate-gh-action/tests_1-to-n.ts
- [ ] `1:n mandatory (explicit) > [create] > relationMode=prisma - [create] categoriesOnPostsModel with non-existing post and category id should succeed with prisma emulation` — [testIf prisma] create post with non-existing authorId succeeds under emulation [providers: all]
- [ ] `1:n mandatory (explicit) > [create] > relationMode=foreignKeys [create] child with non existing parent should throw` — [testIf foreignKeys] create post with non-existing authorId throws FK violation (per-provider snapshot) [providers: all]
- [ ] `1:n mandatory (explicit) > [create] > [create] child with undefined parent should throw with type error` — create post authorId:undefined rejects "Argument `author` is missing." [providers: all]
- [ ] `1:n mandatory (explicit) > [create] > [create] nested child [create] should succeed` — create user with nested post.create; post row present with authorId [providers: all]
- [ ] `1:n mandatory (explicit) > [create] > [create] nested child [createMany]` — create user with nested posts.createMany (2 rows) succeeds [providers: all]
- [ ] `1:n mandatory (explicit) > [update] > [update] optional boolean field should succeed` — update user.enabled=true; posts unchanged [providers: all]
- [ ] `1:n mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > onUpdate: DEFAULT, Cascade > [update] parent id with non-existing id should succeed` — [describeIf !mongodb, onUpdate DEFAULT/Cascade] update user id to new id cascades posts.authorId [providers: exclude:mongodb]
- [ ] `1:n mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] parent id with non-existing id should throw` — [describeIf !mongodb][test.todo] placeholder for non-DEFAULT/Cascade behavior [providers: exclude:mongodb]
- [ ] `1:n mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] parent id with existing id should throw` — [describeIf !mongodb] update user id to existing id throws unique/FK error (branches by onUpdate/provider) [providers: exclude:mongodb]
- [ ] `1:n mandatory (explicit) > [update] > mutate id tests (skipped only for MongoDB) > [update] child id with non-existing id should succeed` — [describeIf !mongodb] update post id to new id succeeds; authorId retained [providers: exclude:mongodb]
- [ ] `1:n mandatory (explicit) > [delete] > [delete] child should succeed` — delete one post; users intact, remaining posts correct [providers: all]
- [ ] `1:n mandatory (explicit) > [delete] > [delete] children and then [delete] parent should succeed` — delete both of user's posts then the user; succeeds [providers: all]
- [ ] `1:n mandatory (explicit) > [delete] > onDelete: DEFAULT, Restrict, NoAction, SetNull > [delete] parent should throw` — [describeIf onDelete in set][testIf onDelete=SetNull] delete user with posts throws FK/required-relation; rows unchanged [providers: all]
- [ ] `1:n mandatory (explicit) > [delete] > onDelete: DEFAULT, Restrict, NoAction, SetNull > [delete] a subset of children and then [delete] parent should throw` — [describeIf onDelete in set][testIf onDelete=SetNull] delete one child then parent still throws (remaining child blocks) [providers: all]
- [ ] `1:n mandatory (explicit) > [delete] > onDelete: NoAction > [delete] parent should throw` — [describeIf onDelete NoAction] delete user throws FK/required-relation [providers: all]
- [ ] `1:n mandatory (explicit) > [delete] > onDelete: NoAction > [deleteMany] parents should throw` — [describeIf onDelete NoAction] delete one child then delete parent throws; rows unchanged [providers: all]
- [ ] `1:n mandatory (explicit) > [delete] > onDelete: NoAction > relationMode=foreignKeys - [delete] parent and child in "wrong" order a transaction when FK is DEFERRABLE should succeed` — [describeIf onDelete NoAction][testIf foreignKeys && (postgres|sqlite)] with DEFERRABLE/deferred FK, mixed-order delete in one transaction succeeds [providers: postgres,sqlite]
- [ ] `1:n mandatory (explicit) > [delete] > onDelete: Cascade > [delete] parent should succeed` — [describeIf onDelete Cascade] delete user cascades to its posts [providers: all]
- [ ] `1:n mandatory (explicit) > [delete] > onDelete: Cascade > [delete] a subset of children and then [delete] parent should succeed` — [describeIf onDelete Cascade] delete one child then parent cascades remaining [providers: all]

### packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n-MongoDB.ts
- [ ] `m:n mandatory (explicit) - MongoDB > [create] > [create] category alone should succeed` — [describeIf mongodb & !map] create category alone; postIDs empty [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [create] > [create] post alone should succeed` — [describeIf mongodb & !map] create post alone; categoryIDs empty [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [create] > [create] create post [nested] [create] categories [nested] [create] category should succeed` — [describeIf mongodb & !map] nested create post→category links both sides' ID arrays [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [update] > [update] id (_id) should throw at runtime because id field is read-only/immutable` — [describeIf mongodb & !map] updating _id rejects "Unknown argument `id`"; data unchanged [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [update] > [update] (post) optional boolean field should succeed` — [describeIf mongodb & !map] update post.published=true; categories unchanged [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [update] > [update] (category): optional boolean field should succeed` — [describeIf mongodb & !map] update category.published=true; posts unchanged [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [delete] > onDelete: > [delete] post should succeed` — [describeIf mongodb & !map] delete post; categories' postIDs retained (no referential action on embedded m:n) [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [delete] > onDelete: > [delete] category should succeed` — [describeIf mongodb & !map] delete category; other categories intact [providers: mongodb-only]

### packages/client/tests/functional/relationMode-in-separate-gh-action/tests_m-to-n.ts
- [ ] `m:n mandatory (explicit) - SQL Databases > [create] > [create] category alone should succeed` — [describeIf !mongodb] create category alone [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [create] > [create] post alone should succeed` — [describeIf !mongodb] create post alone [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [create] > [create] categoriesOnPostsModel with non-existing post and category id should succeed with prisma emulation` — [describeIf !mongodb][testIf prisma] create join row with non-existing FKs succeeds under emulation [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [create] > [create] categoriesOnPostsModel with non-existing post and category id should throw with foreignKeys` — [describeIf !mongodb][testIf foreignKeys] create join row with non-existing FKs throws FK violation [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [create] > [create] create post [nested] [create] categories [nested] [create] category should succeed` — [describeIf !mongodb] nested create post→join→category creates all three rows [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > [update] (post) optional boolean field should succeed` — [describeIf !mongodb] update post.published; category/join unchanged [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > [update] (category): optional boolean field should succeed` — [describeIf !mongodb] update category.published; others unchanged [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > relationMode=foreignKeys - [update] categoriesOnPostsModel with non-existing postId should throw` — [describeIf !mongodb][testIf foreignKeys] update join row postId→99 throws FK violation [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > relationMode=prisma - [update] categoriesOnPostsModel with non-existing postId should succeed` — [describeIf !mongodb][testIf prisma] update join row postId→99 succeeds under emulation [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > relationMode=foreignKeys - [update] categoriesOnPostsModel with non-existing categoryId should throw` — [describeIf !mongodb][testIf foreignKeys] update join row categoryId→99 throws FK violation [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > relationMode=prisma - [update] categoriesOnPostsModel with non-existing categoryId should succeed` — [describeIf !mongodb][testIf prisma] update join row categoryId→99 succeeds under emulation [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > onUpdate: DEFAULT, Cascade > [update] post id should succeed` — [describeIf !mongodb, onUpdate DEFAULT/Cascade] update post id cascades join.postId [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > onUpdate: DEFAULT, Cascade > [update] category id should succeed` — [describeIf !mongodb, onUpdate DEFAULT/Cascade] update category id cascades join.categoryId [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > onUpdate: Restrict, NoAction > [update] post id should throw` — [describeIf !mongodb, onUpdate Restrict/NoAction] update post id throws FK/required-relation; unchanged [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > onUpdate: Restrict, NoAction > [update] category id should throw` — [describeIf !mongodb, onUpdate Restrict/NoAction] update category id throws; unchanged [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > onUpdate: SetNull, SetDefault > [update] post id should succeed` — [describeIf !mongodb, onUpdate SetNull/SetDefault] update post id; join.postId follows [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > onUpdate: SetNull, SetDefault > [update] category id should succeed` — [describeIf !mongodb, onUpdate SetNull/SetDefault] update category id; join.categoryId follows [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [update] > [update] categoriesOnPostsModel postId should succeed` — [describeIf !mongodb] update join row postId 1→2 succeeds; post/category unchanged [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [delete] > onDelete: DEFAULT, Restrict, NoAction > [delete] post should throw` — [describeIf !mongodb, onDelete in set] delete post referenced by join throws FK/required-relation [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [delete] > onDelete: DEFAULT, Restrict, NoAction > [delete] category should throw` — [describeIf !mongodb, onDelete in set] delete category referenced by join throws [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [delete] > onDelete: SetNull, SetDefault > [delete] post should throw` — [describeIf !mongodb, onDelete SetNull/SetDefault] delete post throws FK violation (required join FK) [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [delete] > onDelete: SetNull, SetDefault > [delete] category should throw` — [describeIf !mongodb, onDelete SetNull/SetDefault] delete category throws FK violation [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [delete] > onDelete: Cascade > [delete] post should succeed` — [describeIf !mongodb, onDelete Cascade] delete post cascades its join rows [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [delete] > onDelete: Cascade > [delete] category should succeed` — [describeIf !mongodb, onDelete Cascade] delete category cascades its join rows [providers: exclude:mongodb]
- [ ] `m:n mandatory (explicit) - SQL Databases > [delete] > [delete] categoriesOnPosts should succeed` — [describeIf !mongodb] delete a join row directly; post/category unaffected [providers: exclude:mongodb]

### packages/client/tests/functional/relationMode-m-n-mongodb-failing-with-at-map/tests_m-to-n-MongoDB.ts
- [ ] `m:n mandatory (explicit) - MongoDB > [create] > [create] category alone should succeed` — create category alone succeeds [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [create] > [create] post alone should succeed` — create post alone succeeds [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [create] > [create] create post [nested] [create] categories [nested] [create] category should succeed` — [test.fails] nested create post→category expected to fail with @map (issue #15776) [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [update] > [update] id (_id) should throw at runtime because id field is read-only/immutable` — [test.fails] updating _id; expects runtime "Unknown arg `id`" but fails under @map [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [update] > [update] (post) optional boolean field should succeed` — [test.fails] update post.published expected to fail with @map [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [update] > [update] (category): optional boolean field should succeed` — [test.fails] update category.published expected to fail with @map [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [delete] > onDelete: > [delete] post should succeed` — [test.fails] delete post expected to fail with @map [providers: mongodb-only]
- [ ] `m:n mandatory (explicit) - MongoDB > [delete] > onDelete: > [delete] category should succeed` — [test.fails] delete category expected to fail with @map [providers: mongodb-only]

### packages/client/tests/functional/runtime-import/tests.ts
- [ ] `runtime bundles in JS client > imports correct runtime` — reads generated client index.js; asserts it contains node runtime and not edge runtime (or vice versa) depending on clientMeta.runtime [providers: all; describeIf generatorType==='prisma-client-js']
- [ ] `runtime bundles in JS client > imported files have the expected annotations` — asserts generated client contains the Prisma "Do not edit" banner, `/* eslint-disable */`, and `// biome-ignore-all lint: generated file` [providers: all; describeIf generatorType==='prisma-client-js']

### packages/client/tests/functional/skip/test.ts
- [x] `skips arguments` — findMany with `where: Prisma.skip` returns all users (matches inline snapshot of both seeded users) [providers: all] → non-ported
- [x] `skips input fields` — findMany with `where: { name: Prisma.skip }` returns all users [providers: all] → non-ported
- [x] `skips relations in include` — findFirstOrThrow with `include: { posts: Prisma.skip }` returns result without `posts` property (runtime + type) [providers: all] → non-ported
- [x] `skips relations in select` — findFirstOrThrow with `select: { id, posts: Prisma.skip }` returns result without `posts` (runtime + type) [providers: all] → non-ported
- [x] `skips fields in omit` — findFirstOrThrow with `omit: { email: Prisma.skip }` keeps `email` on result (runtime + type) [providers: all] → non-ported
- [x] `skips fields in create` — post.create with `content: Prisma.skip` yields `content === null` [providers: all] → non-ported
- [x] `skips fields in nested create` — user.update with nested post create using `content: Prisma.skip` yields created post with `content === null` [providers: all] → non-ported
- [x] `skips fields in create with non-nullable field with default` — user.create with `name: Prisma.skip` falls back to default `'Test User'` [providers: all] → non-ported
- [x] `after extension > skips relations in include` — same as include skip but through `$extends({})` client [providers: all] → non-ported
- [x] `after extension > skips relations in select` — same as select skip but through `$extends({})` client [providers: all] → non-ported
- [x] `after extension > skips fields in omit` — omit skip keeps `email` through `$extends({})` client (runtime + type) [providers: all] → non-ported
- [x] `after query extension > skips fields in create with query extension` — create with `name: Prisma.skip` through `$allOperations` query extension falls back to default `'Test User'` [providers: all] → non-ported
- [x] `after query extension > skips input fields in findMany with query extension` — findMany with `where: { name: Prisma.skip }` through query extension returns >=2 users [providers: all] → non-ported
- [x] `after query extension > skips arguments in findMany with query extension` — findMany with `where: Prisma.skip` through query extension returns >=2 users [providers: all] → non-ported
- [x] `after query extension > skips relations in include with query extension` — findFirstOrThrow with `include: { posts: Prisma.skip }` through query extension has no `posts` property (runtime only) [providers: all] → non-ported
- [x] `after query extension > skips relations in select with query extension` — findFirstOrThrow with `select: { id, posts: Prisma.skip }` through query extension has no `posts` property (runtime only) [providers: all] → non-ported

### packages/client/tests/functional/strictUndefinedChecks/test.ts
- [x] `throws on undefined argument` — findMany with `where: undefined` rejects with "explicitly `undefined` values are not allowed" error (inline snapshot) [providers: all] → non-ported
- [x] `throws on undefined input field` — findMany with `where: { email: undefined }` rejects with undefined-not-allowed error for `where` [providers: all] → non-ported
- [x] `throws on undefined select field` — findFirst with `select: { id: true, posts: undefined }` rejects with undefined-not-allowed error for selection field `posts` [providers: all] → non-ported
- [x] `throws on undefined include field` — findFirst with `include: { posts: undefined }` rejects with undefined-not-allowed error for `posts` [providers: all] → non-ported
- [x] `throws on undefined omit field` — findFirst with `omit: { id: undefined }` rejects with undefined-not-allowed error for `id` [providers: all] → non-ported
- [x] `throws on nested include` — findFirst with nested `include.posts.include.author: undefined` rejects with undefined-not-allowed error for `author` [providers: all] → non-ported
- [x] `throws on nested select` — findFirst with nested `select.posts.select.author: undefined` rejects with undefined-not-allowed error for `author` [providers: all] → non-ported
- [x] `throws on nested omit` — findFirst with nested `select.posts.omit.id: undefined` rejects with undefined-not-allowed error for `id` [providers: all] → non-ported

### packages/client/tests/functional/string-filters/tests.ts
- [x] `startsWith matches prefix` — `value: { startsWith: 'foo' }` returns `['foo','foo bar baz']` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `startsWith with no match` — `startsWith: 'xyz'` returns 0 rows [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `startsWith with empty string matches all` — `startsWith: ''` returns all 6 rows [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `endsWith matches suffix` — `endsWith: 'baz'` returns `['baz','foo bar baz']` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `endsWith with no match` — `endsWith: 'xyz'` returns 0 rows [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `endsWith with empty string matches all` — `endsWith: ''` returns all 6 rows [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `contains matches substring` — `contains: 'bar'` returns `['bar','foo bar baz']` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `contains with no match` — `contains: 'xyz'` returns 0 rows [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `contains with empty string matches all` — `contains: ''` returns all 6 rows [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `combined startsWith + endsWith` — `startsWith:'foo', endsWith:'baz'` returns only `'foo bar baz'` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `combined startsWith + contains` — `startsWith:'foo', contains:'bar'` returns only `'foo bar baz'` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `combined contains + endsWith` — `contains:'bar', endsWith:'baz'` returns only `'foo bar baz'` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `NOT startsWith` — `NOT: { value: { startsWith:'foo' } }` returns `['','bar','baz','completely different']` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `NOT contains` — `NOT: { value: { contains:'bar' } }` returns `['','baz','completely different','foo']` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `NOT endsWith` — `NOT: { value: { endsWith:'baz' } }` returns `['','bar','completely different','foo']` [providers: all] → ports/prisma/functional/string-filters.test.ts
- [x] `mode: insensitive > contains case-insensitive` — with extra `FOO BAR BAZ`/`Foo` rows, `contains:'bar', mode:'insensitive'` returns `['FOO BAR BAZ','bar','foo bar baz']` [providers: postgres,cockroach,mongodb (describeIf)] → ports/prisma/functional/string-filters.test.ts
- [x] `mode: insensitive > startsWith case-insensitive` — `startsWith:'foo', mode:'insensitive'` returns `['FOO BAR BAZ','Foo','foo','foo bar baz']` [providers: postgres,cockroach,mongodb (describeIf)] → ports/prisma/functional/string-filters.test.ts
- [x] `mode: insensitive > endsWith case-insensitive` — `endsWith:'baz', mode:'insensitive'` returns `['FOO BAR BAZ','baz','foo bar baz']` [providers: postgres,cockroach,mongodb (describeIf)] → ports/prisma/functional/string-filters.test.ts

### packages/client/tests/functional/too-many-instances-of-prisma-client/tests.ts
- [ ] `should not console warn when spawning too many instances of PrismaClient` — spawns 15 clients and `$connect`s each; asserts no console.warn output (empty snapshot); 60s timeout [providers: all]

### packages/client/tests/functional/tracing-disabled/tests.ts
- [ ] `should perform a query and assert that no spans were generated` — with PrismaInstrumentation not registered, user.findMany produces 0 finished spans [providers: all]

### packages/client/tests/functional/tracing-filtered-spans/tests.ts
- [ ] `should filter out spans and their children based on name` — with PrismaInstrumentation `ignoreSpanTypes` (operation/compile/db_query patterns), `$connect`+findMany leaves only `prisma:client:connect`+`prisma:client:serialize` (empty for engineType 'client') [providers: all]

### packages/client/tests/functional/tracing-no-sampling/tests.ts
- [ ] `should perform a query and assert that no spans were generated` — with 0% TraceIdRatio sampler, user.findMany produces 0 spans and queries carry no `traceparent` comment (issue #19088) [providers: all; skipDefaultClientInstance, skipDriverAdapter js_d1]
- [ ] `should perform a query and assert that no spans were generated via itx` — same assertion within an interactive `$transaction` (0 spans, no traceparent in queries) [providers: all; skipDriverAdapter js_d1]

### packages/client/tests/functional/tracing/tests.ts
- [ ] `tracing on crud methods > create` — user.create emits operation span tree: client:compile(createOne), serialize, engine INSERT db_queries [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on crud methods > read` — user.findMany emits operation(findMany) tree with compile, serialize, engine SELECT/aggregate db_query [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on crud methods > update` — user.update emits operation(update) tree; expected db_queries vary by provider (UPDATE vs SELECT/UPDATE/SELECT with tx spans) [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on crud methods > delete` — user.delete emits operation(delete) tree; db_queries vary (DELETE vs SELECT/DELETE with tx for mysql/sqlserver/mongo) [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on crud methods > deleteMany()` — creates then deleteMany; emits operation(deleteMany) tree; db_queries vary by mongo/relationMode PRISMA/default [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on crud methods > count` — user.count emits operation(count) tree with aggregate compile, serialize, SELECT COUNT / mongo aggregate db_query [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on crud methods > aggregate` — user.aggregate `_max.id` emits operation(aggregate) tree with SELECT MAX / mongo aggregate db_query [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on transactions > $transaction` — array `$transaction([create, findMany])` emits `prisma:client:transaction` span with batched compile and per-operation children incl. itx start/commit db_queries [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on transactions > interactive transaction commit` — itx callback (create+findMany) emits transaction span with per-op compile/serialize/engine children and itxOperation commit+start [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on transactions > interactive transaction rollback` — itx callback that throws emits transaction span with itxOperation rollback+start [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing on $raw methods > $queryRaw` — `$queryRaw\`SELECT 1 + 1;\`` emits operation(queryRaw) with serialize + engine db_query 'SELECT 1 + 1;' [providers: exclude:mongodb (describeIf); skipDriverAdapter js_d1]
- [ ] `tracing on $raw methods > $executeRaw` — `$executeRaw\`SELECT 1 + 1;\`` emits operation(executeRaw) tree; early-returns (no-op) for sqlite and mongodb [providers: exclude:mongodb (describeIf); skipDriverAdapter js_d1]
- [ ] `tracing with custom span` — wraps user.create in custom `create-user` active span; asserts custom span has operation(create) child tree [providers: all; skipDriverAdapter js_d1]
- [ ] `tracing connect > should trace the implicit $connect call` — findMany on fresh client emits operation(findMany) tree containing a `prisma:client:connect` span [providers: all; describeIf !dataProxy; skipDriverAdapter js_d1]
- [ ] `tracing connect > should trace the explicit $connect call` — explicit `$connect()` emits a single `prisma:client:connect` root span [providers: all; describeIf !dataProxy; skipDriverAdapter js_d1]
- [ ] `tracing disconnect > should trace $disconnect` — `$disconnect()` emits `prisma:client:disconnect` span with no children [providers: all; describeIf !dataProxy; skipDriverAdapter js_d1]

### packages/client/tests/functional/type-declaration/tests.ts
- [ ] `does not contain reference to node types` — runtime `client.d.ts` does not contain `/// <reference types="node" />` [providers: sqlite-only (optOut all others)]
- [ ] `does not import other types` — runtime `client.d.ts` has no top-level `import type` lines [providers: sqlite-only (optOut all others)]

### packages/client/tests/functional/typed-sql/mysql-scalars-nullable/test.ts
- [ ] `int - output` — typed SQL `getInt` returns an Int column typed as `number | null` [providers: mysql-only]
- [ ] `int - input` — typed SQL `findInt` accepts a number param and matches the row [providers: mysql-only]
- [ ] `float - output` — typed SQL `getFloat` returns a Float column typed as `number | null` (Float32 precision tolerated) [providers: mysql-only]
- [ ] `float - input` — typed SQL `findFloat` accepts a float param and matches the row [providers: mysql-only]
- [ ] `double - output` — typed SQL `getDouble` returns a Double column typed as `number | null` [providers: mysql-only]
- [ ] `double - input` — typed SQL `findDouble` accepts a double param and matches the row [providers: mysql-only]
- [ ] `string - output` — typed SQL `getString` returns a String column typed as `string | null` [providers: mysql-only]
- [ ] `string - input` — typed SQL `findString` accepts a string param and matches the row [providers: mysql-only]
- [ ] `BigInt - output` — typed SQL `getBigInt` returns a BigInt column typed as `bigint | null` [providers: mysql-only]
- [ ] `BigInt - input` — typed SQL `findBigInt` accepts both number and bigint params and matches the row [providers: mysql-only]
- [ ] `DateTime - output` — typed SQL `getDateTime` returns a DateTime column typed as `Date | null` [providers: mysql-only]
- [ ] `DateTime - input` — typed SQL `findDateTime` accepts a Date param and matches the row [providers: mysql-only]
- [ ] `Date - output` — typed SQL `getDate` returns a Date column typed as `Date | null` [providers: mysql-only]
- [ ] `Date - input` — typed SQL `findDate` accepts a Date param and matches the row [providers: mysql-only]
- [ ] `Time - output` — typed SQL `getTime` returns a Time column typed as `Date | null` [providers: mysql-only]
- [ ] `Time - input` — typed SQL `findTime` accepts a Time Date param and matches the row [providers: mysql-only]
- [ ] `Decimal - output` — typed SQL `getDecimal` returns a Decimal column as `Prisma.Decimal | null` instance [providers: mysql-only]
- [ ] `Decimal - input` — typed SQL `findDecimal` accepts both Decimal and number params and matches the row [providers: mysql-only]
- [ ] `bytes - output` — typed SQL `getBytes` returns a Bytes column typed as `Uint8Array | null` [providers: mysql-only]
- [ ] `bytes - input` — typed SQL `findBytes` accepts a Uint8Array param and matches the row [providers: mysql-only]
- [ ] `json - output` — typed SQL `getJson` returns a Json column typed as JsonValue [providers: mysql-only]

### packages/client/tests/functional/typed-sql/mysql-scalars/test.ts
- [ ] `int - output` — typed SQL `getInt` returns an Int column round-tripped as a JS number [providers: mysql-only]
- [ ] `int - input` — typed SQL `findInt` accepts a number param and matches the row [providers: mysql-only]
- [ ] `float - output` — typed SQL `getFloat` returns a Float column as a number (allowing Float32 precision loss) [providers: mysql-only]
- [ ] `float - input` — typed SQL `findFloat` accepts a float param and matches the row [providers: mysql-only]
- [ ] `double - output` — typed SQL `getDouble` returns a Double column as a number [providers: mysql-only]
- [ ] `double - input` — typed SQL `findDouble` accepts a double param and matches the row [providers: mysql-only]
- [ ] `string - output` — typed SQL `getString` returns a String column round-tripped [providers: mysql-only]
- [ ] `string - input` — typed SQL `findString` accepts a string param and matches the row [providers: mysql-only]
- [ ] `BigInt - output` — typed SQL `getBigInt` returns a BigInt column as a bigint [providers: mysql-only]
- [ ] `BigInt - input` — typed SQL `findBigInt` accepts both number and bigint params and matches the row [providers: mysql-only]
- [ ] `DateTime - output` — typed SQL `getDateTime` returns a DateTime column as a Date [providers: mysql-only]
- [ ] `DateTime - input` — typed SQL `findDateTime` accepts a Date param and matches the row [providers: mysql-only]
- [ ] `Date - output` — typed SQL `getDate` returns a Date column as a Date [providers: mysql-only]
- [ ] `Date - input` — typed SQL `findDate` accepts a Date param and matches the row [providers: mysql-only]
- [ ] `Time - output` — typed SQL `getTime` returns a Time column as a Date [providers: mysql-only]
- [ ] `Time - input` — typed SQL `findTime` accepts a Time Date param and matches the row [providers: mysql-only]
- [ ] `Decimal - output` — typed SQL `getDecimal` returns a Decimal column as a Prisma.Decimal instance [providers: mysql-only]
- [ ] `Decimal - input` — typed SQL `findDecimal` accepts both Decimal and number params and matches the row [providers: mysql-only]
- [ ] `bytes - output` — typed SQL `getBytes` returns a Bytes column as a Uint8Array [providers: mysql-only]
- [ ] `bytes - input` — typed SQL `findBytes` accepts a Uint8Array param and matches the row [providers: mysql-only]
- [ ] `json - output` — typed SQL `getJson` returns a Json column typed as JsonValue [providers: mysql-only]

### packages/client/tests/functional/typed-sql/postgres-lists/test.ts
- [ ] `int - output` — typed SQL `getInt` returns an Int[] array column typed as `number[] | null` [providers: postgres-only]
- [ ] `int - input` — typed SQL `findInt` accepts a number[] param and matches the row [providers: postgres-only]
- [ ] `real - output` — typed SQL `getReal` returns a Real[] array column typed as `number[] | null` [providers: postgres-only]
- [ ] `real - input` — typed SQL `findReal` accepts a number[] param and matches the row [providers: postgres-only]
- [ ] `double - output` — typed SQL `getDouble` returns a Double[] array column typed as `number[] | null` [providers: postgres-only]
- [ ] `double - input` — typed SQL `findDouble` accepts a number[] param and matches the row [providers: postgres-only]
- [ ] `string - output` — typed SQL `getString` returns a String[] array column typed as `string[] | null` [providers: postgres-only]
- [ ] `string - input` — typed SQL `findString` accepts a string[] param and matches the row [providers: postgres-only]
- [ ] `BigInt - output` — typed SQL `getBigInt` returns a BigInt[] array column typed as `bigint[] | null` [providers: postgres-only]
- [ ] `BigInt - input` — typed SQL `findBigInt` accepts both number[] and bigint[] params and matches the row [providers: postgres-only]
- [ ] `DateTime - output` — typed SQL `getDateTime` returns a DateTime[] array column typed as `Date[] | null` [providers: postgres-only]
- [ ] `DateTime - input` — typed SQL `findDateTime` accepts a Date[] param and matches the row [providers: postgres-only]
- [ ] `Date - output` — typed SQL `getDate` returns a Date[] array column typed as `Date[] | null` [providers: postgres-only]
- [ ] `Date - input` — typed SQL `findDate` accepts a Date[] param and matches the row [providers: postgres-only]
- [ ] `Time - output` — typed SQL `getTime` returns a Time[] array column typed as `Date[] | null` [providers: postgres-only]
- [ ] `Time - input` — typed SQL `findTime` accepts a Time Date[] param and matches the row [providers: postgres-only]
- [ ] `Decimal - output` — typed SQL `getDecimal` returns a Decimal[] array (elements are Prisma.Decimal) typed as `Decimal[] | null` [providers: postgres-only]
- [ ] `Decimal - input` — typed SQL `findDecimal` accepts both Decimal[] and number[] params and matches the row [providers: postgres-only]
- [ ] `xml - output` — typed SQL `getXml` returns an Xml[] array column typed as `string[] | null` [providers: postgres-only]
- [ ] `uuid - output` — typed SQL `getUuid` returns a Uuid[] array column typed as `string[] | null` [providers: postgres-only]
- [ ] `uuid - input` — typed SQL `findUuid` accepts a string[] uuid param and matches the row [providers: postgres-only]
- [ ] `bytes - output` — typed SQL `getBytes` returns a Bytes[] array column typed as `Uint8Array[] | null` [providers: postgres-only]
- [ ] `bytes - input` — typed SQL `findBytes` accepts a Uint8Array[] param and matches the row [providers: postgres-only]
- [ ] `json - output` — typed SQL `getJson` returns a Json[] array column typed as `JsonValue[] | null` [providers: postgres-only]

### packages/client/tests/functional/typed-sql/postgres-scalars-nullable/test.ts
- [ ] `int - output` — typed SQL `getInt` returns an Int column typed as `number | null` [providers: postgres-only]
- [ ] `int - input` — typed SQL `findInt` accepts a number param and matches the row [providers: postgres-only]
- [ ] `real - output` — typed SQL `getReal` returns a Real column typed as `number | null` [providers: postgres-only]
- [ ] `real - input` — typed SQL `findReal` accepts a number param and matches the row [providers: postgres-only]
- [ ] `double - output` — typed SQL `getDouble` returns a Double column typed as `number | null` [providers: postgres-only]
- [ ] `double - input` — typed SQL `findDouble` accepts a double param and matches the row [providers: postgres-only]
- [ ] `string - output` — typed SQL `getString` returns a String column typed as `string | null` [providers: postgres-only]
- [ ] `string - input` — typed SQL `findString` accepts a string param and matches the row [providers: postgres-only]
- [ ] `enum - output` — typed SQL `getEnum` returns an enum column typed as `'ONE' | 'TWO' | null` / nullable DbEnums [providers: postgres-only]
- [ ] `enum - input` — typed SQL `findEnum` accepts an enum value param and matches the row [providers: postgres-only]
- [ ] `BigInt - output` — typed SQL `getBigInt` returns a BigInt column typed as `bigint | null` [providers: postgres-only]
- [ ] `BigInt - input` — typed SQL `findBigInt` accepts both number and bigint params and matches the row [providers: postgres-only]
- [ ] `DateTime - output` — typed SQL `getDateTime` returns a DateTime column typed as `Date | null` [providers: postgres-only]
- [ ] `DateTime - input` — typed SQL `findDateTime` accepts a Date param and matches the row [providers: postgres-only]
- [ ] `Date - output` — typed SQL `getDate` returns a Date column typed as `Date | null` [providers: postgres-only]
- [ ] `Date - input` — typed SQL `findDate` accepts a Date param and matches the row [providers: postgres-only]
- [ ] `Time - output` — typed SQL `getTime` returns a Time column typed as `Date | null` [providers: postgres-only]
- [ ] `Time - input` — typed SQL `findTime` accepts a Time Date param and matches the row [providers: postgres-only]
- [ ] `Decimal - output` — typed SQL `getDecimal` returns a Decimal column as `Prisma.Decimal | null` instance [providers: postgres-only]
- [ ] `Decimal - input` — typed SQL `findDecimal` accepts both Decimal and number params and matches the row [providers: postgres-only]
- [ ] `xml - output` — typed SQL `getXml` returns an Xml column typed as `string | null` [providers: postgres-only]
- [ ] `xml - input` — typed SQL `findXml` accepts an xml string param and returns the concatenated result [providers: postgres-only]
- [ ] `uuid - output` — typed SQL `getUuid` returns a Uuid column typed as `string | null` [providers: postgres-only]
- [ ] `uuid - input` — typed SQL `findUuid` accepts a uuid string param and matches the row [providers: postgres-only]
- [ ] `bytes - output` — typed SQL `getBytes` returns a Bytes column typed as `Uint8Array | null` [providers: postgres-only]
- [ ] `bytes - input` — typed SQL `findBytes` accepts a Uint8Array param and matches the row [providers: postgres-only]
- [ ] `json - output` — typed SQL `getJson` returns a Json column typed as JsonValue [providers: postgres-only]

### packages/client/tests/functional/typed-sql/postgres-scalars/test.ts
- [ ] `int - output` — typed SQL `getInt` returns an Int column round-tripped as a number [providers: postgres-only]
- [ ] `int - input` — typed SQL `findInt` accepts a number param and matches the row [providers: postgres-only]
- [ ] `real - output` — typed SQL `getReal` returns a Real column as a number [providers: postgres-only]
- [ ] `real - input` — typed SQL `findReal` accepts a number param and matches the row [providers: postgres-only]
- [ ] `double - output` — typed SQL `getDouble` returns a Double column as a number [providers: postgres-only]
- [ ] `double - input` — typed SQL `findDouble` accepts a double param and matches the row [providers: postgres-only]
- [ ] `string - output` — typed SQL `getString` returns a String column round-tripped [providers: postgres-only]
- [ ] `string - input` — typed SQL `findString` accepts a string param and matches the row [providers: postgres-only]
- [ ] `enum - output` — typed SQL `getEnum` returns an enum column typed as the DbEnums union / `'ONE' | 'TWO'` [providers: postgres-only]
- [ ] `enum - input` — typed SQL `findEnum` accepts an enum value param and matches the row [providers: postgres-only]
- [ ] `BigInt - output` — typed SQL `getBigInt` returns a BigInt column as a bigint [providers: postgres-only]
- [ ] `BigInt - input` — typed SQL `findBigInt` accepts both number and bigint params and matches the row [providers: postgres-only]
- [ ] `DateTime - output` — typed SQL `getDateTime` returns a DateTime column as a Date [providers: postgres-only]
- [ ] `DateTime - input` — typed SQL `findDateTime` accepts a Date param and matches the row [providers: postgres-only]
- [ ] `Date - output` — typed SQL `getDate` returns a Date column as a Date [providers: postgres-only]
- [ ] `Date - input` — typed SQL `findDate` accepts a Date param and matches the row [providers: postgres-only]
- [ ] `Time - output` — typed SQL `getTime` returns a Time column as a Date [providers: postgres-only]
- [ ] `Time - input` — typed SQL `findTime` accepts a Time Date param and matches the row [providers: postgres-only]
- [ ] `Decimal - output` — typed SQL `getDecimal` returns a Decimal column as a Prisma.Decimal instance [providers: postgres-only]
- [ ] `Decimal - input` — typed SQL `findDecimal` accepts both Decimal and number params and matches the row [providers: postgres-only]
- [ ] `xml - output` — typed SQL `getXml` returns an Xml column as a string [providers: postgres-only]
- [ ] `xml - input` — typed SQL `findXml` accepts an xml string param and returns the concatenated result [providers: postgres-only]
- [ ] `uuid - output` — typed SQL `getUuid` returns a Uuid column as a string [providers: postgres-only]
- [ ] `uuid - input` — typed SQL `findUuid` accepts a uuid string param and matches the row [providers: postgres-only]
- [ ] `bytes - output` — typed SQL `getBytes` returns a Bytes column as a Uint8Array [providers: postgres-only]
- [ ] `bytes - input` — typed SQL `findBytes` accepts a Uint8Array param and matches the row [providers: postgres-only]
- [ ] `json - output` — typed SQL `getJson` returns a Json column typed as JsonValue [providers: postgres-only]

### packages/client/tests/functional/typed-sql/sqlite-scalars-nullable/test.ts
- [ ] `int - output` — typed SQL `getInt` returns an Int column typed as `number | null` [providers: sqlite-only]
- [ ] `int - input` — typed SQL `findInt` accepts a number param and matches the row [providers: sqlite-only]
- [ ] `double - output` — typed SQL `getDouble` returns a Double column typed as `number | null` [providers: sqlite-only]
- [ ] `double - input` — typed SQL `findDouble` accepts a double param and matches the row [providers: sqlite-only]
- [ ] `string - output` — typed SQL `getString` returns a String column typed as `string | null` [providers: sqlite-only]
- [ ] `string - input` — typed SQL `findString` accepts a string param and matches the row [providers: sqlite-only]
- [ ] `BigInt - output` — typed SQL `getBigInt` returns a BigInt column typed as `bigint | null` [providers: sqlite-only]
- [ ] `BigInt - input` — typed SQL `findBigInt` accepts both number and bigint params and matches the row [providers: sqlite-only]
- [ ] `DateTime - output` — typed SQL `getDateTime` returns a DateTime column typed as `Date | null` [providers: sqlite-only]
- [ ] `DateTime - input` — typed SQL `findDateTime` accepts a Date param and matches the row [providers: sqlite-only]
- [ ] `Decimal - output` — typed SQL `getDecimal` returns a Decimal column as `Prisma.Decimal | null` instance [providers: sqlite-only]
- [ ] `Decimal - input` — typed SQL `findDecimal` accepts both Decimal and number params and matches the row [providers: sqlite-only]
- [ ] `bytes - output` — typed SQL `getBytes` returns a Bytes column typed as `Uint8Array | null` [providers: sqlite-only]
- [ ] `bytes - input` — typed SQL `findBytes` accepts a Uint8Array param and matches the row [providers: sqlite-only]
- [ ] `json - output` — typed SQL `getJson` returns a Json column typed as JsonValue [providers: sqlite-only]
- [ ] `json - input` — typed SQL `findJson` accepts a json param and matches the row [providers: sqlite-only]
- [ ] `forced nullable param` — typed SQL `nullableParam` accepts a forced `number | null` param and returns bigint value 0n [providers: sqlite-only]
- [ ] `forced nullable column` — typed SQL `nullableColumn` returns a forced-nullable `value?` column typed as `bigint | null` [providers: sqlite-only]

### packages/client/tests/functional/typed-sql/sqlite-scalars/test.ts
- [ ] `int - output` — typed SQL `getInt` returns an Int column round-tripped as a number [providers: sqlite-only]
- [ ] `int - input` — typed SQL `findInt` accepts a number param and matches the row [providers: sqlite-only]
- [ ] `double - output` — typed SQL `getDouble` returns a Double column as a number [providers: sqlite-only]
- [ ] `double - input` — typed SQL `findDouble` accepts a double param and matches the row [providers: sqlite-only]
- [ ] `string - output` — typed SQL `getString` returns a String column round-tripped [providers: sqlite-only]
- [ ] `string - input` — typed SQL `findString` accepts a string param and matches the row [providers: sqlite-only]
- [ ] `BigInt - output` — typed SQL `getBigInt` returns a BigInt column as a bigint [providers: sqlite-only]
- [ ] `BigInt - input` — typed SQL `findBigInt` accepts both number and bigint params and matches the row [providers: sqlite-only]
- [ ] `DateTime - output` — typed SQL `getDateTime` returns a DateTime column as a Date [providers: sqlite-only]
- [ ] `DateTime - input` — typed SQL `findDateTime` accepts a Date param and matches the row [providers: sqlite-only]
- [ ] `Decimal - output` — typed SQL `getDecimal` returns a Decimal column as a Prisma.Decimal instance [providers: sqlite-only]
- [ ] `Decimal - input` — typed SQL `findDecimal` accepts both Decimal and number params and matches the row [providers: sqlite-only]
- [ ] `bytes - output` — typed SQL `getBytes` returns a Bytes column as a Uint8Array [providers: sqlite-only]
- [ ] `bytes - input` — typed SQL `findBytes` accepts a Uint8Array param and matches the row [providers: sqlite-only]
- [ ] `json - output` — typed SQL `getJson` returns a Json column typed as JsonValue [providers: sqlite-only]
- [ ] `json - input` — typed SQL `findJson` accepts a json param and matches the row [providers: sqlite-only]

### packages/client/tests/functional/typescript/tests.ts
- [ ] `typescript > No test suites found` — no-op guard test emitted only when zero generated suite files are found (early return) [providers: n/a]
- [ ] `typescript > %s` `[each]` — for each generated `.generated/**/*.ts` suite file, runs the TS compiler semantic diagnostics and `assert.fail`s if any type error's path falls within that suite's directory [providers: n/a]

### packages/client/tests/functional/unixepoch-ms-datetime/tests.ts
- [x] `can retrieve a unixepoch-ms date time with a find unique query` — creates an event, then findUnique by compound uuid_createdAt; found matches created (createdAt is a Date) [providers: sqlite-only] → non-ported
- [x] `can retrieve a unixepoch-ms date time with a find unique query when it was stored directly as a millis number` — inserts a raw row with createdAt as millis number, findUnique by uuid+Date returns that createdAt [providers: sqlite-only] → non-ported
- [x] `can retrieve a unixepoch-ms date time with a raw query` — creates an event, then `$queryRaw` selecting by createdAt Date returns the created row [providers: sqlite-only] → non-ported
- [x] `can retrieve a unixepoch-ms date time with a raw query by a millis number` — creates an event, then `$queryRaw` selecting by createdAt.getTime() millis returns the created row [providers: sqlite-only] → non-ported
- [x] `can retrieve a unixepoch-ms date time with a find many query` — creates an event, findMany by uuid+createdAt returns exactly `[created]` [providers: sqlite-only] → non-ported
- [x] `can retrieve a unixepoch-ms date time with compactable find unique queries` — two identical findUnique calls run concurrently (compacted into one) both resolve to created [providers: sqlite-only] → non-ported
- [x] `findUnique() returns valid Date when createdAt is stored as unix millis directly` — raw-inserts millis, findFirst returns createdAt that is a Date instance and not NaN [providers: sqlite-only] → non-ported
- [x] `aggregate() returns valid Date when unix millis are stored directly` — raw-inserts millis, aggregate _min/_max createdAt are valid non-NaN Date instances [providers: sqlite-only] → non-ported
- [x] `manually created INTEGER DateTime column returns valid Date values` — drops/recreates Event with INTEGER createdAt default `unixepoch('now')*1000`, then create/findUnique/aggregate all return valid non-NaN Date values [providers: sqlite-only] → non-ported

### packages/client/tests/functional/unsupported-action/tests.ts
- [ ] `unsupported method` — calling `prisma.user.aggregateRaw()` on a SQL provider rejects with an inline-snapshotted "does not match any query" Prisma error [providers: exclude:mongodb]

### packages/client/tests/functional/upsert-relation-mode-prisma/test.ts
- [ ] `calling upsert two times in a row does nothing` — runs upsert twice with same where/create/update; both times returns node with identifier 1 and value 5 (idempotent under relationMode=prisma) [providers: all]

### packages/client/tests/functional/validator/tests.ts
- [x] `validation via non-extended client` — `testIf(generatorType==='prisma-client-js')`; asserts `Prisma.validator` (with type param and with client/model/action/field forms) returns correctly-typed passthrough objects and rejects wrong keys via `@ts-expect-error`; runtime `expect(...).toEqual` on returned values [providers: postgres-only] → non-ported
- [x] `validation via extended client` — `testIf(generatorType==='prisma-client-js')`; same validator assertions against a `$extends` result-extended client (computed `prop`), verifying select/data/create forms and type/runtime equality [providers: postgres-only] → non-ported

### packages/client/tests/functional/views/tests.ts
- [x] `should simple query a view` — findFirst on the UserInfo view returns a row whose id equals the seeded user id [providers: all] → non-ported
- [x] `should query a view with where` — findMany on view filtered by email returns the seeded user [providers: all] → non-ported
- [x] `should query views with a related column` — findFirst selecting the related `bio` column returns the seeded profile bio [providers: all] → non-ported
- [x] `should require orderBy when take is provided in non-aggregation method` — findMany with `take:1` but no orderBy rejects with inline-snapshotted "orderBy is required because take was provided" error [providers: all] → non-ported
- [x] `should require orderBy when skip is provided in non-aggregation method` — findMany with `skip:1` but no orderBy rejects with inline-snapshotted "orderBy required because skip" error [providers: all] → non-ported
- [x] `should require orderBy when take is provided in groupBy` — groupBy with `take:1` no orderBy rejects with inline-snapshotted orderBy-required error [providers: all] → non-ported
- [x] `should require orderBy when skip is provided in groupBy` — groupBy with `skip:1` no orderBy rejects with inline-snapshotted orderBy-required error [providers: all] → non-ported

**Total: 540 tests**
