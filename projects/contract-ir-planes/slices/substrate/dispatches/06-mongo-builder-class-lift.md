# Dispatch 6 — Mongo authoring builder lift to class instances

**Branch:** `tml-2584-s1a-substrate` (already checked out)
**Model tier:** `composer-2.5-fast` (Composer-2.5)
**Sizing:** **S** — three files, all-additive use of an existing IR class, plus a helper deletion. No design judgment.

---

## Intent

Eliminate the `mongoNamespaceKindForDts` helper at [`packages/2-mongo-family/3-tooling/emitter/src/index.ts:8-13`](packages/2-mongo-family/3-tooling/emitter/src/index.ts#L8-L13) by fixing its root cause: the Mongo contract-ts builder currently constructs **plain object literals** for namespaces ([`packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts:1515`](packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts#L1515)) so the non-enumerable `kind` property defined on the IR class never gets attached. The emitter then has to guess `'mongo-namespace'` when the input lacks `kind`. The structural cure: flip the builder to construct `new MongoStorage(...)`, mirroring the SQL pattern that already exists.

This is the same shape as the existing SQL builder at [`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:551`](packages/2-sql/2-authoring/contract-ts/src/build-contract.ts#L551):

```ts
const storage = new SqlStorage({ ...storageWithoutHash, storageHash } as SqlStorageInput);
```

Apply the analogous shape to the Mongo builder.

---

## Files

## R2 redirect (2026-05-21)

R1 correctly halted on the fixture-byte-stability gate. The TS-builder flip alone misses the PSL authoring path: the Mongo PSL interpreter at `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts:1139` constructs the same plain-literal namespace envelope (`storage: { ...storageWithoutHash, storageHash }`), so PSL-authored example fixtures (which are what `pnpm fixtures:check` exercises for the Mongo demos: `examples/mongo-blog-leaderboard`, `examples/mongo-demo`, `examples/retail-store`) still flow plain literals into the emitter. The emitter then produces `kind: undefined` instead of `kind: 'mongo-namespace'` in `contract.d.ts`. The structural cure: same `new MongoStorage(...)` flip applied to the PSL interpreter too.

R2 keeps R1's three file changes (TS builder, emitter, contract-schema) and adds a fourth: the PSL interpreter. The deeper `executeContractEmit`-discards-deserialize-output observation R1 surfaced is filed as a follow-up ticket (not in scope for this dispatch).

**Modify (4 files):**

1. **`packages/2-mongo-family/2-authoring/contract-ts/src/contract-builder.ts`** (around line 1515)

   Current shape:

   ```ts
   const storageBody = {
     namespaces: {
       [UNBOUND_NAMESPACE_ID]: {
         id: UNBOUND_NAMESPACE_ID,
         collections,
       },
     },
   };

   const storage = {
     ...storageBody,
     storageHash: computeStorageHash({
       target: definition.target.targetId,
       targetFamily: definition.family.familyId,
       storage: storageBody,
     }),
     // Plain-literal namespace bodies under MongoStorageShape carry `kind` only
     // as a type-side requirement; surfacing it on the runtime object here would
     // alter the storage hash. Class-instance construction (which carries kind
     // non-enumerably) is the structural cure and is tracked for follow-up.
   } as unknown as MongoStorageShape<string>;
   ```

   Replace with (sketch — adjust types as needed):

   ```ts
   const storageBody = {
     namespaces: {
       [UNBOUND_NAMESPACE_ID]: {
         id: UNBOUND_NAMESPACE_ID,
         collections,
       },
     },
   };

   const storageHash = computeStorageHash({
     target: definition.target.targetId,
     targetFamily: definition.family.familyId,
     storage: storageBody,
   });

   const storage = new MongoStorage({
     storageHash,
     ...storageBody,
   }) as unknown as MongoStorageShape<string>;
   ```

   Remove the stale comment about the deferred cure (the cure is now landed). Import `MongoStorage` from `@prisma-next/mongo-contract` (or whichever public export surface). If `MongoStorageShape<string>` is type-only and doesn't accept the class instance via plain structural assignment, keep the cast — but narrow it as far as possible.

   **Storage-hash invariant:** the hash MUST be byte-identical before and after this change. The constructor materializes `kind` non-enumerably (`Object.defineProperty(this, 'kind', { value: 'mongo-namespace', enumerable: false })`), so `JSON.stringify(storage)` produces the same bytes either way. **If `pnpm fixtures:check` reports drift, halt — that means a class-internal field is sneaking into JSON output and we need to handle it before this dispatch can land.**

2. **`packages/2-mongo-family/3-tooling/emitter/src/index.ts`** (lines 6-13, 65)

   - **Delete** the `mongoNamespaceKindForDts` helper (lines 8-13) and the `MONGO_NAMESPACE_KIND` constant (line 6) — both become unreferenced.
   - **Replace** line 65 `const nsKind = mongoNamespaceKindForDts(ns);` with `const nsKind = ns.kind;` (or inline `ns.kind` directly into the template literal on line 67).
   - The `ns` type passed to `generateMongoNamespacesType` comes from `MongoStorage['namespaces']`. After change #1, `MongoStorage` always carries `MongoNamespace` instances with `kind` materialized non-enumerably; reading `ns.kind` returns the string. **Verify** the static type for `MongoNamespace['kind']` is `string` (it should be, per the post-S1.A narrowing of `Namespace.kind`).

3. **`packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`** (around line 1139, the `storage: { ...storageWithoutHash, storageHash }` site)

   The PSL interpreter currently constructs the storage envelope as a plain object literal, bypassing `MongoStorage`'s constructor (which would otherwise materialize `kind` non-enumerably on each namespace via `MongoNamespacePayload`). Apply the same flip as the TS builder:

   ```ts
   // before (plain literal)
   storage: { ...storageWithoutHash, storageHash },

   // after (class instance — same as the TS builder pattern)
   storage: new MongoStorage({ storageHash, ...storageWithoutHash }) as unknown as ...,
   ```

   Import `MongoStorage` from `@prisma-next/mongo-contract` (same import surface as the TS builder uses). The exact cast target should match what the PSL interpreter declares at the assignment site — read the surrounding type context, mirror the SQL PSL interpreter's pattern if one exists for SQL. If the PSL interpreter has a different return-type shape that doesn't accommodate `MongoStorage` directly, **halt and report** — that's a wider type-surface concern that should not be hacked around.

   **Storage-hash invariant** is the same as the TS builder: `kind` is non-enumerable on the constructed instance, so `JSON.stringify` produces the same bytes; `pnpm fixtures:check` for `contract.json` should stay green. The fix is specifically to surface `kind` so the `.d.ts` emitter reads the right value.

4. **`packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts`** (line 360, inside `createMongoNamespaceEnvelopeSchema`)

   **Decision required, verify with a small spike first:** can `'kind?': 'string'` flip to `kind: 'string'` here?

   The validator runs against the **wire shape** (post `JSON.parse`). On the wire, `kind` is **non-enumerable** on the constructed `MongoStorage` instance, so `JSON.stringify(storage)` does NOT emit `kind`, so the parsed wire shape does NOT have a `kind` key.

   Therefore tightening the validator to `kind: 'string'` would **reject every Mongo contract that round-trips through JSON**, breaking `pnpm fixtures:check` and the round-trip serialization tests.

   **Action:** **leave `'kind?': 'string'` as-is** in this dispatch. The validator is gated on wire-shape contents, not on the runtime IR class shape. Tightening it requires also making `kind` enumerable on the IR class — which would shift the storage hash and is out of scope. Update the JSDoc above the validator to note: "`'kind?': 'string'` because `kind` is non-enumerable on `MongoNamespacePayload` and therefore absent from the wire shape; the type-side narrowing is enforced by the IR class, not by this validator."

   **If the spike shows otherwise — e.g. `kind` IS enumerable on the wire for some construction path — halt and report.** Don't tighten without verifying both fixture stability AND the round-trip serialization tests stay green.

---

## Done-when gates (run all; all must PASS before commit)

```bash
# 1. Module + type resolution
pnpm typecheck

# 2. Mongo authoring path round-trip
pnpm --filter @prisma-next/mongo-contract-ts test

# 3. Mongo contract (validator, IR) tests
pnpm --filter @prisma-next/mongo-contract test

# 4. Mongo emitter tests (the helper consumer; this is where regression most likely surfaces)
pnpm --filter @prisma-next/mongo-emitter test

# 5. Layering
pnpm lint:deps

# 6. ON-DISK BYTE-STABILITY (load-bearing — if this drifts, the storage hash changed)
pnpm fixtures:check

# 7. Aggregate package tests
pnpm test:packages
```

**Gate 6 is the load-bearing one.** Any drift means the construction change altered the JSON envelope, which means our assumption that `kind` is non-enumerable is wrong somewhere. Investigate before pushing.

Pre-existing flakes in `adapter-postgres` integration / `cipherstash` / `cli-telemetry` are unrelated and have been confirmed pre-existing on `origin/main`.

---

## Verification of the helper deletion

Run after the changes:

```bash
git grep -n 'mongoNamespaceKindForDts\|MONGO_NAMESPACE_KIND' -- '*.ts'
```

Expected: **zero matches.** The helper and constant are fully retired.

Also:

```bash
git grep -n 'kind: undefined\|ns\.kind ??\|ns\.kind ||' -- 'packages/2-mongo-family/**'
```

Expected: zero `kind` fallbacks; every read site uses `ns.kind` directly because the IR class guarantees it.

---

## Commit + push

Single commit on `tml-2584-s1a-substrate`. Signed-off (DCO required).

Suggested message:

```
fix(mongo): construct MongoStorage class instances in the contract-ts builder

The builder previously constructed plain object literals for namespaces,
bypassing the MongoNamespacePayload constructor's non-enumerable kind
materialization. The Mongo emitter then needed a fallback helper to
guess 'mongo-namespace' when the plain-literal input lacked kind.

Flips the builder to `new MongoStorage(...)`, mirroring the SQL pattern
in @prisma-next/sql-contract-ts. The constructor materializes kind
non-enumerably, so JSON.stringify emits the same bytes (fixture
byte-stability preserved) but the runtime IR exposes kind reliably.

Deletes the mongoNamespaceKindForDts helper (now unreferenced) and the
MONGO_NAMESPACE_KIND constant. Updates the mongo contract-schema JSDoc
to note that the optional `kind?` on the validator is intentional —
wire-shape gated, not IR-shape gated.

Closes the Mongo portion of TML-2648; SQLite analogue still pending.
```

After commit:

```bash
git push origin tml-2584-s1a-substrate
```

---

## Refusal triggers (HALT and report, do not work around)

- **`pnpm fixtures:check` fails** — investigate the hash drift; do NOT force the fixture regen. If a class-internal property is leaking into JSON, that's a separate fix.
- **Round-trip serialization tests fail** — the IR class is materializing something that round-trips don't expect. Halt.
- **`new MongoStorage(...)` is not the right export surface** (e.g. it expects `MongoStorageInput` with a wrapper somewhere) — report the actual export and recommend the right factory. Don't synthesize a new factory.
- **Type-level surgery is required on `MongoStorageShape<string>`** beyond the existing cast — report; that's a downstream shape concern outside this dispatch.
- **The `MongoNamespace` IR class doesn't expose `kind` as `string` on its public type** — report. The S1.A narrowing should have made this guarantee, but if a gap exists this dispatch surfaces it.

---

## Out of scope

- **SQLite analogue.** TML-2648 retains the SQLite portion; this dispatch only closes the Mongo half.
- **Tightening the Mongo validator's `kind?` to `kind`.** See note in file #3 — would require making `kind` enumerable on the IR class, which would break byte-stability.
- **Touching the `hydrate?` redundancy on `AuthoringEntityTypeDescriptor`.** Separate concern; will be addressed in its own dispatch.
- **PR description update.** Orchestrator will reflect this in the PR body after the dispatch lands.
- **Retro entry / Linear update.** Orchestrator updates TML-2648 (Mongo struck through, SQLite remains) and adds the retro note after the dispatch lands.

---

## When you report back

1. Commit SHA and confirmation it was pushed.
2. Seven gates' PASS/FAIL.
3. The two grep verifications (must show zero hits).
4. Anything you noticed about the IR class / type surface (e.g. did `MongoStorageShape<string>` accept the class instance without cast? was there a hidden field on the IR class?).
5. Any refusal triggers fired.
