# Code review — enums-as-domain-concept

## Subagent IDs

- **Implementer:** fresh spawn per dispatch (harness exposes no subagent-resume; continuity via committed code + slice artifacts). D1: `a30a0055ecb4b958e`. D2: `a384518cd39ad8685`.
- **Reviewer:** _(spawned after dispatch 2 — batched IR-substrate review)_

## Scoreboard (slice: enum-contract-substrate, TML-2850)

| Dispatch | Outcome | Status |
| --- | --- | --- |
| 1 — domain enum IR + `ValueSetRef` | domain IR represents enums + field refs; constructs; typecheck | ✅ landed `465f68679` — **reviewed (batched), SATISFIED** |
| 2 — storage value-set IR | storage IR represents value-sets + column refs | ✅ landed `22bd30b8b` — **reviewed (batched), SATISFIED** |
| 3 — `enumType`/`member` authoring + lowering | new shape authored end-to-end; literal tuples preserved | ✅ `aa71c4d27` + `4f3c9a616` — **SATISFIED** (design reviewed; cast ratchet fixed, delta −1; typeRef-absence test added) |
| 4 — serializer + validators + round-trip | round-trips; validates; `fixtures:check` clean | ✅ landed `d8132889f` — **SATISFIED (slice-closing)**: serializer hydration correct + coexists; validators accept/reject correctly; round-trip exercises the real serializer (both planes); cast ratchet green (delta −1); `fixtures:check` verified clean end-to-end (zero diff). Slice ready for PR. |

## Findings log

**Round 1 (batched D1+D2 IR-substrate review) — no blocking findings.**

- **[low] New bare `as` cast in `build-sql-namespace.ts:61`** — `new StorageValueSet(v as StorageValueSetInput)` is a bare cast in production code. The repo's `no-bare-cast` plugin flags it, but at **info level (`i`), not error** — `pnpm --filter @prisma-next/sql-contract lint` and `pnpm lint` both PASS. The new line exactly mirrors the immediately-adjacent pre-existing `v as StorageTableInput` cast (line 52) inside the same `Object.fromEntries` narrowing, and lines 23/52 already carried the same warning before this slice. Recommendation: when D3/D4 next touch this file, consider converting both sibling casts to `blindCast` for consistency; not worth a standalone round, since lint is green and the cast is genuine union narrowing after the `instanceof` branch. Not a regression in cast count for any tracked-as-error surface.

## Orchestrator notes

- **Additive/dark slice (option A):** native enum path + PSL `enum` + all fixtures stay unchanged. A fixture diff is a defect, not output.
- **Review-cadence calibration:** dispatches 1+2 (pure-additive IR type defs; D2 is the first consumer of `ValueSetRef`) reviewed together after D2; D3/D4 reviewed individually. Recorded here so it's visible, not silent.
- **D1 placement decision (resolved at dispatch time):** `ValueSetRef` lives in foundation `@prisma-next/contract` (`value-set-ref.ts`), **not** framework-components — foundation is the inner layer and cannot import the outer core; `sql-contract` depends on foundation, so both planes reach it. The brief's framework-components instruction had a layering bug; the implementer caught it. Plan updated.
- **fixtures:check — resolved (not environmental):** the example apps invoke the *built, repo-local* `prisma-next` CLI, which lands on `PATH` only when `pnpm i` is re-run **after** `pnpm build`. So the additivity gate is the sequence **`pnpm build` → `pnpm i` → `pnpm fixtures:check`** (per operator). Folded into the dispatch-4 slice-DoD gate; the D1/D2 IR changes are non-emitting so they pass by construction, but D4 runs it for real. (Candidate for the close-out retro → durable docs, since it's reusable repo knowledge.)
- **`element-coordinates.test.ts` failure (D2) — to verify, not trust:** implementer reports it as a pre-existing stale-dist mismatch in `framework-components` (compiled `elementCoordinates` iterates `Object.entries(ns)`; source refactored to `ns.entries`), failing at dispatch-1 HEAD before D2's changes; neither dispatch touched the walker. **Load-bearing for this slice** — the new `valueSet` slot lives under `ns.entries`, so the coordinate walker must pick it up after a real build. Reviewer to confirm via verify-on-main (force-build framework-components, re-run the test): is it stale-dist, and does a fresh `pnpm build` clear it?
- Hand-driven run; no `trace.jsonl` instrumented.

## Round notes

### Round 1 — batched D1+D2 IR-substrate review → SATISFIED

**Shape soundness (dispatches 3–4 build cleanly).** All four substrate shapes are correct and will not force rework:

- `ValueSetRef` (foundation `value-set-ref.ts`) matches the `ForeignKeyReference` carrier convention exactly: `{ namespaceId, name, spaceId? }` with **presence of `spaceId` as the cross-space discriminator** (no tag field), and `namespaceId` admitting the `__unbound__` sentinel. It adds a `kind: 'enum' | 'value-set'` discriminator for *which plane* the referent lives in — a correct extension, since unlike a pure FK (always storage→storage tables) this carrier is reused on both the domain field (`'enum'`) and the storage column (`'value-set'`). It is a plain interface with **zero imports** — the right shape for foundation, because it must be referenceable from the domain plane (a plain type tree) and foundation cannot import the `SqlNode` base that `ForeignKeyReference` extends.
- `ContractEnum` carries `codecId` (explicit, required) + ordered `members: readonly {name,value}[]`. Order is asserted by the D1 tests. Good.
- `StorageValueSet` follows the frozen-node pattern correctly: `extends SqlNode`, `freezeNode(this)` in the constructor, `override readonly kind = 'value-set' as const` **enumerable** (overriding the base non-enumerable `'sql'`). This is exactly the per-leaf-enumerable-kind convention the `sql-node.ts` doc prescribes for a node that will be walked by a future polymorphic consumer — so the discriminator survives into the JSON envelope for hydration dispatch (D4). `values` is defensively copied + frozen.
- Slot placement: domain `enum` is a **direct slot** on `ApplicationDomainNamespace` (parallel to `models`/`valueObjects`); storage `valueSet` sits **under `SqlNamespace.entries`** (alongside `table`). This honors the two-namespace-representation edge case the slice spec flagged — the implementer did not mirror one onto the other.

**Additive discipline — confirmed.** Every new field is optional (`enum?`, `valueSet?` on field/column, `valueSet?` slot under entries) and non-emitting. The native path is untouched: no change to `PostgresEnumType`, the storage `type` slot, or PSL lowering. The `build-sql-namespace.ts` change is correctly scoped to *construction*: it normalises input-shape `StorageValueSetInput` → `StorageValueSet` only when the `valueSet` slot is present, and the unbound-singleton fast path now guards on `!hasValueSets` so a namespace that *has* value-sets correctly becomes a bound namespace rather than collapsing to the empty singleton. An empty/valueset-free unbound namespace still returns `SqlUnboundNamespace.instance` unchanged — existing namespaces are not silently altered. No fixture-affecting code paths were touched.

**Coordinate-walker intent — confirmed first-class.** `elementCoordinates` (framework-components `src/ir/storage.ts`) walks each namespace's `entries` slot maps **structurally**: for every entity-kind key under `entries` whose value is an object, it yields one `EntityCoordinate` per entity name — `{ plane:'storage', entityKind, entityName }` — with no family-specific slot vocabulary. Because the new `valueSet` lives under `entries`, the walker yields `entityKind:'valueSet'` coordinates automatically, with **zero walker change**. The `namespace.ts` invariant doc explicitly promises this. Value-sets are first-class entities by construction.

**Repo rules — clean.** No `any`, no `@ts-expect-error`/`@ts-nocheck`, no file-extension imports in the new files. Exports wired correctly (`@prisma-next/contract/types` for `ValueSetRef`/`ContractEnum`/`ContractField`; `@prisma-next/sql-contract/types` for `StorageValueSet`/`StorageValueSetInput`). `pnpm --filter @prisma-next/contract --filter @prisma-next/sql-contract typecheck` clean; foundation tests 178 pass; sql-contract tests 157 pass (post-build). `pnpm lint:deps` reports no layering violations across 1035 modules — the foundation placement of `ValueSetRef` is honest. `pnpm lint` PASSES (the one new bare cast is info-level only — see Findings).

**Verify-on-main result — stale-dist CONFIRMED, pre-existing, not this slice's regression.** Reproduced the failure first: at HEAD `22bd30b8b`, `pnpm --filter @prisma-next/sql-contract test` failed `element-coordinates.test.ts` with received `{ entityKind:'entries', entityName:'table' }` — the signature of a **stale compiled** `elementCoordinates` that iterates `Object.entries(ns)` one level too shallow (treating `ns.entries` as a single key) instead of descending into `ns.entries`. Then force-built framework-components (`pnpm --filter @prisma-next/framework-components build`) and re-ran: **157/157 pass, failure cleared.** Confirmed the walker source was last changed in merged commit `693308923` (TML-2808) — *neither* `465f68679` *nor* `22bd30b8b` touches `framework-components/src/ir/storage.ts`. The failure is a local build-hygiene artifact (dist not rebuilt after that earlier PR), not introduced by this slice. Note: framework-components' *own* `element-coordinates.test.ts` already passes because it imports from `../src/`, not dist; only the *consumer* (`sql-contract`) test exercises the stale dist.

**Verdict: SATISFIED.** IR substrate is sound to build on, genuinely additive/dark, rule-clean, and the coordinate-walker failure is confirmed pre-existing stale-dist (cleared by a fresh build), not a regression.

### Round 3 — dispatch 3 (`enumType`/`member` authoring + lowering, `aa71c4d27`) → ANOTHER ROUND NEEDED

**Emitted-structure trace — CLEAN, no stray `typeRef` (the orchestrator's primary concern is resolved).** The implementer's report that `field.namedType(handle)` "sets the field's `typeRef`" is loose wording, not a defect. Traced an authored field end-to-end:

- `namedTypeField(handle)` stores the handle in `ScalarFieldState.typeRef` (authoring-builder state only — this is the DSL's generic carrier slot, not the emitted `StorageColumn.typeRef`).
- `resolveModelNode` (contract-lowering.ts:578) detects the handle via `isEnumTypeHandle` and lifts it onto `FieldNode.enumTypeHandle` — a **new** `FieldNode` slot, separate from the descriptor.
- `resolveFieldDescriptor` (contract-lowering.ts:88) returns `{ codecId, nativeType }` for an enum handle and **deliberately omits `typeRef`**. So `FieldNode.descriptor.typeRef` is `undefined`.
- `buildStorageColumn` (build-contract.ts:209-210) spreads `...ifDefined('typeRef', field.descriptor.typeRef)` → omitted (undefined), then `...ifDefined('valueSet', storageValueSetRef)` → present. **Result: the emitted column carries a clean `valueSet` ref and no `typeRef`.** The native-enum mechanism is not half-reused. ✅

- Domain enum entry: emitted under `domain.namespaces[default].enum['Role']` = `{ codecId: handle.codecId, members: ordered }`, `codecId` threaded from the passed codec, members in declaration order. ✅ (tests lines 172-188, 287-293)
- Storage value-set entry: emitted under `storage.namespaces[default].entries.valueSet['Role']` = `{ kind:'value-set', values: ordered }`. ✅ (tests lines 190-202, 297)
- Discriminators: domain field `valueSet.kind === 'enum'`; storage column `valueSet.kind === 'value-set'`; both `namespaceId` = default ns, `name` = enum name. ✅ (tests lines 204-250, 301-313)

Minor test-coverage gap (not blocking): no test pins the *absence* of `typeRef` on an enum column. The code trace proves it can't be set, but a one-line `expect(roleColumn?.typeRef).toBeUndefined()` would lock the invariant for dispatch 4. Recommend adding when D4 touches this surface; not worth a round on its own.

**Literal-type propagation (OQ-crux) — SOUND.** `enumType`'s typed overload uses `const Members extends readonly [EnumMember, ...EnumMember[]]` and maps through `MembersToValues` / `MembersToNames` / `MembersAccessorMap`. The runtime `values as never` casts are invisible to callers because the declared overload return type governs the public type. Type-tests pin every hop on the handle: `.values` is `readonly ['user','admin']` (line 71), `.names` is `readonly ['User','Admin']` (line 75), `.members.User` is `'user'` (line 79), and invalid-member access is a type error (line 84). The literal tuple correctly lives on the **authoring handle** — the emitted `Contract<SqlStorage>` IR type widens storage `values` to `readonly string[]` by design, so there's no "end-to-end to the contract type" hop to test; the spec's done-condition (`expectTypeOf(Role.values)` is the literal tuple) is the right target and is met. No untested widening hop within scope.

**OQ1 (`enumType` as standalone function) — CLEAN + forward-compatible.** Lives in `contract-ts/src/enum-type.ts`, exported from `exports/contract-builder.ts`. It is a free function that takes the codec as an explicit argument (target-agnostic by construction) and does not touch the entity-contribution registry or `composed-authoring-helpers.ts`. Nothing is restructured; wiring it into a family-/framework-level contribution later is purely additive (move the export, keep the signature). Defensible placement; does not foreclose the spec's eventual target-agnostic goal.

**OQ4 (`field.namedType` overload) — purely additive.** The `EnumTypeHandle` overload is appended as the 4th of four `namedTypeField` overloads. An `EnumTypeHandle` (symbol-branded, no `kind` field) is not structurally assignable to the `string`, `StorageTypeInstance` (`kind:'codec-instance'` required), or `PostgresEnumStorageEntry` overloads, so overload resolution routes enum handles only to the new overload and leaves every existing caller unchanged. Confirmed via the shape of `StorageTypeInstance`/`PostgresEnumStorageEntry`. The runtime implementation's `isEnumTypeHandle` branch is functionally identical to the fallthrough (both `new ScalarFieldBuilder({ kind:'scalar', typeRef, nullable:false })`) — dead branch, harmless; flag as cleanup, not blocking.

**Well-formedness guards — actually throw.** Empty member list, duplicate name, duplicate value each throw at construction (enum-type.ts:64-86); tests assert all three (lines 142-156). ✅

**DARK discipline — confirmed.** `git show aa71c4d27` touches no `contract.json` / `contract.d.ts` / `expected.contract.json` / `*.psl` file. Native path (`PostgresEnumType`, storage `type` slot, `processEnumDeclarations`, PSL `enum`) untouched. Every new field/slot is optional and non-emitting. Package tests: 302 pass (30 files). typecheck clean.

**MUST-FIX — cast ratchet fails CI.** `pnpm lint:casts` (CI lint job, `.github/workflows/ci.yml:116`, merge-blocking) **exits 1** on this branch: `current=1284 merge-base=1278 delta=+6`. The script fails the build when the bare-`as` count rises versus merge-base. The net-new production casts are all in `enum-type.ts`:

- `enum-type.ts:26` — `(value ?? name) as Value`
- `enum-type.ts:204` — `values as never`
- `enum-type.ts:205` — `names as never`
- `enum-type.ts:206` — `membersAccessor as never`
- `enum-type.ts:222` — `value as Record<symbol, unknown>`

Each is flagged by the `no-bare-cast` plugin at info level (so `pnpm lint` stays green — that's the signal the implementer trusted), but the **ratchet** is the actual blocker and it is red. Per repo rule `no-bare-casts.mdc` / CLAUDE.md, production casts must use `blindCast<T,"Reason">` / `castAs<T>` or be eliminated. Fix options:
- Lines 204-206 (`as never`): these widen the frozen runtime arrays/object to the declared generic return type. Prefer `castAs<Values>(values)` etc. (or `blindCast` with a one-word reason), narrowing per-property — already per-property, good.
- Line 26 (`as Value`): `value ?? name` is `Value | Name`; since the no-arg overload fixes `Value = Name`, `castAs<Value>` is the minimal narrow.
- Line 222 (`as Record<symbol, unknown>`): the brand check can be written without a cast — e.g. read the symbol via an `in` narrow, or `castAs`. A bare `as` is the rule violation regardless.

This is the only blocker. Everything else (emitted structure, literal propagation, OQ1/OQ4, DARK, guards, tests) is satisfied.

### Round 4 — dispatch 4 (serializer + validators + round-trip, `d8132889f`) → SATISFIED (slice-closing)

The D4 code surface is three files: `sql-contract-serializer-base.ts` (+33), `validators.ts` (+41), and the new `value-set-roundtrip.test.ts` (+239). All four judge items pass.

**1. Serializer hydration — correct + coexists.** `hydrateSqlNamespaceEntry` now walks a `valueSet` slot alongside the existing `table` slot. The `table` block is untouched (only an inline `(entriesRaw as …)` was lifted into a named `rawEntries` local — net-zero behaviour, picked up by the ratchet); the target `type` slot is still explicitly deferred to target overrides (comment preserved). The new walk handles both shapes the spec requires: an already-constructed `StorageValueSet` instance passes through via `instanceof`, and a raw-JSON entry is reconstructed with `new StorageValueSet(...)` — which calls `freezeNode(this)` (confirmed in `storage-value-set.ts:40`), so the round-tripped node is a frozen IR node, not a plain object. The `kind:'value-set'` discriminator is enumerable on the class, survives `JSON.stringify`, and is re-asserted after hydration (test lines 78/88). Casts are `blindCast` from the canonical `@prisma-next/utils/casts` — no net-new bare `as`.

**2. Validators — accept + reject correctly.** `StorageValueSetSchema` ({kind:'value-set', values:string[]}), `ContractEnumSchema` ({+:reject, codecId, members:[{name,value}]}), and the inline `ValueSetRefSchema`/column-`valueSet?` shapes are correct. Wiring is additive: `valueSet?` slot on `createNamespaceEntrySchema.entries`, `enum?` slot on domain namespaces in `createSqlContractSchema`, and a `valueSet?` field appended to both `'+': 'reject'` schemas (`StorageColumnSchema`, `ModelFieldSchema`) so a contract carrying the new field is **not** ejected. I ran an adversarial specificity probe directly against the exported schemas: `StorageValueSetSchema` accepts a valid value-set, rejects missing `values`, rejects `values` not-an-array, rejects a wrong `kind`; `ContractEnumSchema` rejects a member missing `value`. All five reject/accept for the right reason (not an unrelated throw). Note: `StorageValueSetSchema` has no `'+': 'reject'` (extra keys tolerated) while `ContractEnumSchema` does — a minor asymmetry, not a defect; the spec requires the missing-required-key rejections, which work.

**3. Round-trip test — real serializer, both planes.** The test constructs a contract via the **real** `enumType`/`member` + `defineContract` authoring path, then round-trips through the **real** `SqlContractSerializer` (`new SqlContractSerializer()` → `JSON.parse(JSON.stringify(...))` → `deserializeContract`) — not a hand-built mock. It asserts: frozen-node reconstruction (`toBeInstanceOf(StorageValueSet)`), discriminator integrity (`kind === 'value-set'`), value-order preservation, double-round-trip stability, the **storage column** `valueSet` ref (`kind:'value-set'`), the **domain field** `valueSet` ref (`kind:'enum'`), and the **domain `enum`** entry as plain data (`{codecId, members:[…]}` via `toEqual`). The domain enum is plain data with no IR node, so JSON survival is the right (and exercised) check. 13/13 round-trip+validator tests pass.

**4. Repo rules — clean.** `lint:casts` green: `current=1277 merge-base=1278 delta=-1` (the round-3 +6 was fixed in `4f3c9a616`; D4 added zero bare casts). No `any` (the one grep hit is the word "any" in a JSDoc comment), no `@ts-expect-error`/`@ts-nocheck`, no file-extension imports. `pnpm lint` for both packages exits success (only pre-existing info-level cast diagnostics, none in D4 files). `typecheck` clean for foundation-contract + sql-contract + family-sql. Tests: sql-contract 157/157, family-sql 347/347.

#### Verify-on-main — the additivity gate, run for real (build budget spent)

**Base-ref correction (important for anyone re-reading the git range).** The local `main` ref is stale (`c159cd423`). The branch's true base against `origin/main` is `f8e89b3a5`; the slice's code commits are `465f68679..d8132889f`. The merge-base-vs-stale-`main` range includes a large pile of already-merged work (TML-2500, supabase, TML-2683, TML-2808, …) — those are **not** part of this slice. The clean slice surface is 25 files under `packages/{1-framework/0-foundation/contract, 2-sql/1-core/contract, 2-sql/2-authoring/contract-ts, 2-sql/9-family}` plus the project docs. **Zero** `contract.*` / `expected.contract.json` / `*.psl` files are in the slice diff.

**The `sql-builder` emit "hash failure" — reproduced as a stale-build artifact, confirmed NOT a slice regression.** On a stale partial build I reproduced an emit failure, but it surfaced as `PN-CLI-4999 "Failed to load config"` (the config imports built workspace `*/control` entrypoints whose dist was stale), not the `headRef.hash` message the implementer quoted — both are the same class of problem: the example apps invoke the *built, repo-local* CLI and need a current build. I then spent the build budget on the documented additivity sequence:

- `pnpm build` → **66/66 tasks green**.
- `pnpm i` (re-link the repo-local CLI onto `PATH`).
- `pnpm --filter @prisma-next/sql-builder run emit` → **`"ok": true`**, and the regenerated `contract.json`/`contract.d.ts` are **byte-identical** to the committed fixture (zero `git diff`).
- `pnpm fixtures:check` (full) → every example/app/extension emitted `"ok": true`, `migrations:regen` ran, and the working tree came back **clean** — zero diff across all `contract.*` / `expected.contract.json`, zero migration drift.

So the failure the implementer flagged is a local build-hygiene artifact (same family as the D1/D2 stale-dist `element-coordinates` finding), cleared by a clean `pnpm build` → `pnpm i`. It is **not** caused by this slice — the slice touches no fixture, no emitter, no migration, and no hash code.

**Additivity assessment — "zero contract diff" is a valid proof here, and I confirmed it holds beyond the implementer's claim.** Two independent legs: (a) the slice's git diff changes no emitted fixture, no `.psl`, and no emit/migration/hash code path — only additive optional slots (`enum?`, `valueSet?` on field/column, the `valueSet?` entries slot) and a new `enumType` API that no committed fixture invokes; (b) I re-emitted for real and every fixture regenerated identically. The new fields are optional and `undefined` for any non-enum fixture, so they are omitted from JSON and cannot perturb a contract that does not author an enum; the validators only *additionally* accept the new optional fields, and the two `'+': 'reject'` schemas were extended to allow them, so no existing contract's validation outcome changes. The earlier emit partial-failure does not weaken the proof — it was a build-state artifact, and once the build was correct the gate ran green.

**Verdict: SATISFIED.** Serializer hydration is correct and coexists with `table`/`type`; validators accept the enum+value-set contract and reject the malformed cases for the right reasons; the round-trip test exercises the real serializer across both planes including frozen-node reconstruction, discriminator integrity, and ref integrity; repo rules pass with a net-negative cast delta; and the additivity story is solid — I independently ran the full `pnpm build` → `pnpm i` → `pnpm fixtures:check` sequence green with zero fixture diff, and confirmed the implementer's emit failure is a pre-existing build-hygiene artifact, not this slice's regression. The slice is done and ready to open a PR.

**Non-blocking carry-forwards (cleanup, not rounds):**
- `StorageValueSetSchema` lacks `'+': 'reject'` while its sibling `ContractEnumSchema` has it. Harmless (required-key rejection still fires), but adding `'+': 'reject'` for symmetry is cheap when this surface is next touched.
- The round-3 note about pinning `typeRef`-absence on an enum column was addressed in `4f3c9a616`; no action.
