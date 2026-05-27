# Open-questions research

Companion to `mongo-surface-area.md`. Answers the four open questions in
the project spec with concrete evidence so delivery can start without
operator re-litigation. Verdicts: ✅ confirms / ⚠️ updates / 🛑 escalate.

---

## Q1 — BSON v7 class-shape changes

**Question.** Retaining the `bson` re-export means class-shape changes
propagate to users without our awareness.

**Working position.** Benign — if a meaningful break in `Binary` /
`Decimal128` / `Long` / `ObjectId` / `Timestamp` surfaces during
implementation, the implementer stops and re-enters design discussion
per invariant I12; otherwise we document any user-visible class-shape
changes in migration notes.

**Evidence.** BSON v7.0.0 release notes
(`https://github.com/mongodb/js-bson/releases/tag/v7.0.0`, published
2025-11-05). Class-shape changes touching our five re-exported classes:

- `ObjectId`: **constructor no longer accepts a number.** `new ObjectId(numericTimestamp)` is removed; users must call `ObjectId.createFromTime()` instead.
- `Binary`: subtype 2 constant *deprecated* (not removed). Class shape unchanged.
- `Decimal128`, `Long`, `Timestamp`: no class-specific changes listed.

Other v7 changes (Node ≥ 20.19.0 floor, BigInt literal engine
requirement, `globalThis.crypto` for randomness, react-native polyfill
removal, additive `bsonType` symbol) do not touch class shapes.

Audit of `new ObjectId(...)` call sites in this repo (`rg "new ObjectId\("` across `packages/`, `examples/`, `test/`): every site is `new ObjectId()` (no-arg) or `new ObjectId(stringValue)` (hex string). Zero numeric calls. Sample: `packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts:23` (`new ObjectId(value)` where `value: string`), `packages/3-mongo-target/2-mongo-adapter/test/codecs.test.ts:19` (`new ObjectId('507f1f77bcf86cd799439011')`).

**Verdict — ✅ confirms working position.** No code in our source or
tests is affected by the one real class-shape change. The
`ObjectId(number)` removal is worth a one-line entry in the user-facing
migration notes because user code that we don't own may use it, but the
"PN owns the type surface" framing remains intact.

---

## Q2 — `collection.drop()` no-throw-on-`NamespaceNotFound`

**Question.** Does any caller depend on `drop()` throwing when the
collection is missing?

**Working position.** Benign — `command-executor.ts:58` does not catch
the throw, so the shift is "throw → propagate up" to "return false → ignored." Audit during implementation; if a caller relied on the
throw, a small explicit guard lands in the same PR.

**Evidence.** Single call site: `packages/3-mongo-target/2-mongo-adapter/src/core/command-executor.ts:57-59`:

```ts
async dropCollection(cmd: DropCollectionCommand): Promise<void> {
  await this.db.collection(cmd.collection).drop();
}
```

Returns `Promise<void>` — the boolean return value is discarded under
both v6 and v7. Caller chain: `MongoCommandExecutor.dropCollection` is
invoked through the visitor at `packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts:146` (`await step.command.accept(commandExecutor)`), inside a `for` loop with no `try`/`catch` around the step (`mongo-runner.ts:145-147`). Idempotency check at `mongo-runner.ts:121-128` short-circuits drops whose postcheck already says "collection absent", so the runner only reaches `drop()` when the planner believes the collection still exists.

Tests: `packages/3-mongo-target/2-mongo-adapter/test/command-executor.test.ts:145-154` asserts "drops an existing collection" only — no test asserts on the throw behaviour for missing collections. No test in `packages/3-mongo-target/**/test/**` or `test/integration/test/mongo/**` matches `NamespaceNotFound`, `ns not found`, or the v6 throw on `drop()`.

**Verdict — ✅ confirms working position.** Behavioural shift is from
"loud failure on a path we don't normally reach" to "silent success on a
path we don't normally reach." No caller and no test depends on the
throw; no PR change required beyond awareness.

---

## Q3 — Cursor `batchSize` default removal

**Question.** Does the v7 removal of the driver's default
`batchSize: 1000` for `getMore` materially affect our cursor usage?

**Working position.** Defer — perf shift to more `getMore` round-trips,
not a correctness concern. Configure an explicit `batchSize` only if
the perf impact surfaces in test / integration after the bump lands.

**Evidence.** Cursor-returning calls in `packages/2-mongo-family/**` and `packages/3-mongo-target/**` source (non-test):

- `driver-mongo/src/mongo-driver.ts:147-151` — `collection.aggregate(pipeline)` then `yield* cursor`. User-facing aggregate path. Result-set size: arbitrary (any user query). Fully consumed.
- `adapter-mongo/src/core/marker-ledger.ts:62-67` — `executeAggregate` ending in `.toArray()`. One marker doc per space; result-set size O(1). Fully consumed.
- `adapter-mongo/src/core/introspect-schema.ts:93` — `db.listCollections().toArray()`. One row per collection; result-set size: tens to low hundreds. Fully consumed.
- `adapter-mongo/src/core/introspect-schema.ts:105` and `adapter-mongo/src/core/command-executor.ts:77` — `listIndexes().toArray()`. Indexes per collection; typically < 20. Fully consumed.
- `adapter-mongo/src/core/command-executor.ts:87` — second `db.listCollections().toArray()`. Same shape as #3.

None of these sets explicit `batchSize`. Five of the six are infrequent migration-path calls returning small result-sets that fit in the initial 101-doc batch; the v6 default of 1000-doc `getMore` was never engaged on them.

**Working-position framing correction.** The v7 release notes explicitly state the change is to *reduce* round-trips, not increase them — without the driver-supplied 1000-doc cap, the server packs up to 16 MB per `getMore`, which for small docs is many more docs per round-trip than the v6 default of 1000. Quote: "*if a cursor fetches many small documents, the driver's default of 1000 can result in many round-trips to fetch all documents, when the server could fit all documents inside a single getMore if no batchSize were set*". So our user-facing aggregate path at `mongo-driver.ts:149` is more likely to see a **perf improvement** than a regression.

**Verdict — ⚠️ updates working position (framing only, not conclusion).**
Defer is correct. But the rationale "perf shift to more `getMore`
round-trips" is the opposite of what the v7 change does. Update the
spec / plan rationale to read "perf shift, more docs per `getMore`
round-trip (typically fewer round-trips)" and keep the defer.

---

## Q4 — `MongoClient.connect()` fail-fast handshake

**Question.** Does any test depend on v6's lazy connect-error behaviour
(error surfaces on first command, not on `connect()`)?

**Working position.** Defer — maintenance item; address only if a test
breaks during the bump.

**Evidence.** All `client.connect()` call sites in the repo (~30
matches) are tests / examples / fixtures that connect to a
`mongodb-memory-server` instance (`replSet.getUri()`,
`mongod.getUri()`) with no credentials. Auth-mechanism testing surface:
`rg "loadBalanced|MONGODB-AWS|authMechanism|MONGODB-CR"` across
`packages/`, `test/`, `examples/` returns zero hits in MongoDB
contexts. No test constructs a `MongoClient` with deliberately bad
credentials to assert on a lazy command-time error.

The Postgres-only test at `test/integration/test/cli.db-init.e2e.errors.test.ts:82-128` ("connect failure → structured error with `--json`") exercises `withDevDatabase` (`@prisma/dev` PG dev DB) and a Postgres bad-port URL; it does not touch MongoDB.

Our wrapper-level connect tests (`packages/3-extensions/mongo/test/mongo.test.ts:223,230,409`, `mongo.e2e.test.ts:115`) assert on our wrapper's "already connected" / "client closed" states, not on driver-level lazy-vs-eager error timing. They mock `driverFromConnection`, so the v7 behavioural change can't reach them.

The one v6-vs-v7 user-visible delta is at `packages/3-mongo-target/3-mongo-driver/src/exports/control.ts:38-62` — `MongoControlDriver.create()` already wraps `client.connect()` in `try`/`catch` and surfaces a structured `errorRuntime('Database connection failed', …)`. v7's fail-fast just shifts *when* the same error is thrown; the wrapper's behaviour is unchanged from the caller's perspective.

**Verdict — ✅ confirms working position.** No test depends on lazy
connect-error timing. Defer is correct; no implementer brief item
needed beyond awareness.
