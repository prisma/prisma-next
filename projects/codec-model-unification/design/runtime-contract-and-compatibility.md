# Design — Runtime contract and compatibility

**Audience:** future implementers (especially of [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) and reviewers concerned with how this project fits with downstream extension work. Companion to [codec-interface-and-brand.md](codec-interface-and-brand.md) and [authoring-ergonomics.md](authoring-ergonomics.md).

**What this doc covers:** the per-instance materialization contract we declare without implementing; how this project keeps the door open for the work in [assets/cipherstash-ext-framework-gaps.md](../assets/cipherstash-ext-framework-gaps.md); explicit out-of-scope extension points; and the rebase strategy off [PR #374](https://github.com/prisma/prisma-next/pull/374).

---

## Background

This project's primary deliverable is a small, well-scoped fix to the no-emit type resolution path. But the codec interface is also the contact point for several adjacent extension concerns the team is actively considering — most prominently CipherStash's encryption-codec needs. We don't want the interface change shipped here to foreclose those concerns or force a redesign later.

The core decision in this doc: **declare the per-instance materialization contract now** (the `init(params, instanceMeta)` signature, the `storage.types`-instance keying), but **defer the runtime rewiring** to a follow-up. Future work consumes a stable surface; this project stays focused.

---

## The runtime materialization contract (declared, not implemented)

### What we declare

A parameterized codec that opts into per-instance state implements `init`:

```typescript
readonly init?: (
  params: TParams,
  instance: {
    readonly name: string;
    readonly usedAt: ReadonlyArray<{ readonly table: string; readonly column: string }>;
  },
) => THelper;
```

The framework promises (when the runtime side of this contract is implemented):

1. **One call per `StorageTypeInstance`.** For each named entry in `storage.types`, the runtime calls `codec.init(entry.typeParams, instance)` exactly once at context-builder time.
2. **`name` is the `storage.types` key.** Stable, contract-level identity.
3. **`usedAt` lists every column referencing the instance.** Empty array is impossible (an unused `storage.types` entry is a contract validator error). Single-element is the common case.
4. **Encode/decode dispatch via the named instance.** `encode(value, ctx)` for a column with `typeRef: 'Foo'` (or inline params resolved to an anonymous instance — see below) routes through the helper returned by `init` for that instance.

### What we don't implement

- The context-builder side that actually calls `init` once per instance.
- The dispatch side that routes encode/decode through the helper.
- Any caching/memoization or lifecycle management of the helper.

These belong to [TML-2330](https://linear.app/prisma-company/issue/TML-2330), staged after this project lands.

### Why this is enough now

- **Forward-compatible with CipherStash.** Their codec needs `(table, column)` at `init` to derive a key. With the signature locked in, they can author against the right interface today even though the runtime won't dispatch through it until TML-2330.
- **Forward-compatible with simpler use cases.** Codecs that want to precompile a regex or precompute a constant from params get a place to do it.
- **Doesn't constrain the runtime implementation.** Whether TML-2330 chooses an eager `init`-per-instance materialization, a lazy first-use pattern, or some hybrid, the signature accommodates them all.

---

## Why declare without implementing

### Locking the shape is cheap

The only cost is one extra `instance` parameter in `init`'s type. The runtime today doesn't call `init` at all (the optional field exists but is unused). Adding `instance` doesn't break anything; it's free to ship.

### Locking the shape is high-leverage

If we shipped `init(params)` and CipherStash later asked for `(table, column)`, the migration path is messy:

- Existing codecs need to migrate.
- `init` semantics change (single call per codec? per column? per use?).
- Downstream caching strategies change.

By declaring `init(params, instanceMeta)` upfront, we sidestep all of that.

### Not implementing is a feature

This project is the no-emit-path fix plus surface cleanup. Wiring up the runtime context builder is a much larger change with its own design considerations (error handling, resource lifecycle, async helper construction). Shipping it here would balloon the scope. Shipping just the *signature* lets the runtime work proceed independently and keeps this PR reviewable.

---

## Anonymous vs named instances

Open question 1 in [spec.md](../spec.md#open-questions). Resolved here.

### The problem

A column can carry parameters two ways:

```typescript
// Inline
{ codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length: 1536 } }

// Named (via storage.types)
{ typeRef: 'Embedding1536' }
```

For named: the `instance.name` is `'Embedding1536'`, no ambiguity. For inline: what's the name?

### Resolution

The runtime materializes an **anonymous instance** for every column with inline `typeParams`. Its `name` is a deterministic derivation:

```typescript
name = `<anon-${table}.${column}>`;
```

`usedAt` for an anonymous instance has exactly one entry — the column it came from. Two columns with structurally identical inline `typeParams` produce two distinct anonymous instances (deduplication is the user's job; if they want sharing they use `storage.types`).

### Why this resolution

- **No surprise.** Sharing requires explicit opt-in via `storage.types`, matching how the rest of the IR works.
- **`usedAt`-list semantics are clean.** A consumer that needs sharing semantics (CipherStash deriving one key for many columns) sees exactly the columns the user intended.
- **Permits inline `typeParams` to remain ergonomic.** No forced promotion to `storage.types` for one-off columns.

The pack-author guidance in [authoring-ergonomics.md](authoring-ergonomics.md#pack-author-guidance-preview) recommends `storage.types` when shared `init` work is desirable.

---

## CipherStash compatibility

[assets/cipherstash-ext-framework-gaps.md](../assets/cipherstash-ext-framework-gaps.md) lists 16 framework gaps that held back a CipherStash extension implementation. Three intersect this project directly; the rest are referenced for completeness in [Explicit out-of-scope extension points](#explicit-out-of-scope-extension-points).

### G1 — Codecs receive no per-call column metadata

**CipherStash's need:** an encryption codec needs to know which `(table, column)` it's serving so it can derive a column-scoped encryption key. Today the codec sees only `(value)` on encode and `(wire)` on decode.

**Our overlap:** the `init(params, instanceMeta)` signature in FR8 is exactly the right shape. A CipherStash codec's `init` derives a key from `params` (the schema parameters) and `instance.usedAt` (the bound columns); the helper returned by `init` closes over the key. Subsequent `encode`/`decode` calls go through the helper, which carries the column context.

**What this project ships:** the signature, the documentation, the brand mechanism so CipherStash's parameterized columns also resolve correctly in the no-emit path.

**What TML-2330 ships:** the runtime context-builder rewiring that actually calls `init` per instance and routes dispatch through the helper.

### G16 — `JsonValue` constraint for `encryptedJson<T>` is unconstrained

**CipherStash's need:** a way to author a JSON-encrypting column whose `T` is constrained to a user-supplied schema-derivable shape, and have that shape flow through to the column type.

**Our overlap:** the `jsonCodec(schema)` helper does exactly this for the unencrypted case. CipherStash's `encryptedJson` codec follows the same pattern: a `ParameterizedCodec` whose `Brand` projects `StandardSchemaV1.InferOutput<S>` as the output type. They get the no-emit-path-correct typing for free.

**What this project ships:** `jsonCodec` and the `StandardSchemaV1`-based brand pattern; CipherStash adopts the pattern in their pack.

**What's CipherStash-side:** their codec adds the encryption layer; the schema-inference layer is ours.

### G6 — `preferParam` codec trait

**CipherStash's need:** a way for a codec to signal the planner "lift my literals to query parameters" (because encrypted literals must be parameterized for security).

**Our overlap:** orthogonal — `preferParam` is a new codec slot, not a parameterization shape. But the interface split makes adding it cleaner: it goes on base `Codec` (since both parameterized and non-parameterized codecs might want it). Out of scope here; flagged as a clean follow-up.

---

## Explicit out-of-scope extension points

The following CipherStash gaps describe additions to the codec interface or surrounding framework. None of them are blocked by this project's design; each is left as a clean addition for a follow-up.

### G4 — Bulk encode for network-backed codecs

A `bulkEncode?: (values: ReadonlyArray<…>) => Promise<…>` slot on `ParameterizedCodec` (or base `Codec`). Lets the runtime batch `Promise.all` waves into one network round-trip. Out of scope here; the interface split makes adding it later straightforward.

### G10 — `AbortSignal` plumbed to encode/decode

A second arg `(value, ctx: { signal?: AbortSignal })` on `encode`/`decode`. Touches the runtime more than the interface; out of scope. The brand mechanism doesn't depend on encode/decode shape, so this addition is clean.

### G9 — Trait-gated wire redaction

A `redactWire?: true` trait on the codec; the runtime omits the wire payload from error envelopes for codecs carrying the trait. Tracked as [TML-2329](https://linear.app/prisma-company/issue/TML-2329). Trait-only addition, doesn't touch parameterization.

### G6 — `preferParam`

See above under CipherStash compatibility.

### G2, G3 — Migration-planner inputs

`(table, column)` plumbing on the *migration plane* — the migration planner currently can't see the same context the runtime would. Same architectural pattern as G1 but a different plane. Out of scope here; addressed when the migration planner gets its own pass.

### G11–G15 — Publishing, type-level testing, bundle composition

All sit outside the codec interface entirely. Out of scope.

---

## The `storage.types` / `typeRef` converging seam

`storage.types` and `typeRef` already exist in the IR. This project doesn't change them, but it makes them load-bearing in two new ways.

### As the runtime keying surface (declared)

`init` is keyed by `storage.types` instance. Inline-`typeParams` columns produce anonymous instances (see above). The runtime contract is stated in terms of `storage.types`, not raw column metadata, because:

- It's the existing contract-level identity.
- It supports cross-column sharing cleanly.
- It already round-trips through emit (the existing `contract.json` carries `storage.types`).

### As the type-resolution seam in the no-emit path

`FieldOutputType` resolves `typeRef` through `storage.types` first, then applies the brand. So a column with `typeRef: 'Embedding1536'` and a column with inline `typeParams: { length: 1536 }` resolve to the same `Vector<1536>`. The user experience is unified; the contract chooses sharing semantics.

### What we don't change

- The IR shape of `storage.types`.
- The PSL surface for declaring named types.
- The migration planner's awareness of `storage.types`.

These remain as they are; the runtime contract and the type resolver lean on the existing structure.

---

## Rebase strategy

This project is currently branched from `origin/worktree/op-registry-ts` ([PR #374](https://github.com/prisma/prisma-next/pull/374)).

### Why we branched off #374

- #374 establishes patterns for TS-as-authoring-surface (`Expression<T>`, codec-typed expressions, the operations registry).
- The codec-typed expression machinery in #374 reads `CodecTypes` for `output` types — the same place this project's brand mechanism plugs into.
- Branching off #374 lets us co-evolve the brand-aware path without merge churn.

### Rebase plan

- During the project: rebase on top of `origin/worktree/op-registry-ts` if #374 receives review-driven changes.
- Once #374 merges to `main`: rebase this branch onto `origin/main`. The parameterization fields removed from base `Codec` (FR7) line up naturally with #374's merged state.
- During the rebase: the brand mechanism is additive on top of #374's expression types; no semantic conflict expected. The interface-removal (FR7) may have small textual conflicts with whatever shape #374 leaves the SQL `Codec` extension in; resolve in favor of the post-FR7 shape.

### What we will not do

- We will not develop this project against an older base lacking #374's `Expression<T>` machinery — the codec brand and #374's expression typing are too closely related.
- We will not block landing M1/M2 on #374 merging; the branches can co-exist.

---

## Cross-references

- Spec: [spec.md FR8, Non-goals](../spec.md#non-goals).
- Plan: [plan.md M1.2 (init signature), M6 (close-out)](../plan.md#m1--brand-mechanism--parameterizedcodec).
- Codec mechanism: [codec-interface-and-brand.md](codec-interface-and-brand.md).
- Authoring impact: [authoring-ergonomics.md](authoring-ergonomics.md).
- CipherStash analysis: [assets/cipherstash-ext-framework-gaps.md](../assets/cipherstash-ext-framework-gaps.md).
- Follow-ups: [TML-2329](https://linear.app/prisma-company/issue/TML-2329) (G9), [TML-2330](https://linear.app/prisma-company/issue/TML-2330) (G1, G4).
- PR #374: <https://github.com/prisma/prisma-next/pull/374>.
