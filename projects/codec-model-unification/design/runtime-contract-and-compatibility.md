# Design — Runtime contract and compatibility

**Audience:** future implementers (especially of [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) and reviewers concerned with how this project fits with downstream extension work. Companion to [codec-interface-and-brand.md](codec-interface-and-brand.md) and [authoring-ergonomics.md](authoring-ergonomics.md).

**What this doc covers:** the per-instance materialization contract we declare without implementing, how the design fits the CipherStash extension work, the explicit out-of-scope extension points, and the rebase strategy off [PR #374](https://github.com/prisma/prisma-next/pull/374).

---

## Decision

This project ships a **declared but unimplemented** runtime materialization contract for `init`:

> When the runtime side of `init` is implemented (in [TML-2330](https://linear.app/prisma-company/issue/TML-2330)):
>
> 1. **One call per `storage.types` instance.** For each named entry, the runtime calls `codec.init(entry.typeParams, instance)` exactly once at context-builder time.
> 2. **`name` is the `storage.types` key.** Stable, contract-level identity.
> 3. **`usedAt` lists every column referencing the instance.** Single-element is the common case; multi-element when columns share an instance.
> 4. **Encode/decode dispatch via the named instance.** A column with `typeRef: 'Foo'` (or inline params resolved to an anonymous instance) routes through the helper returned by `init` for that instance.

We ship the signature, the keying convention (`storage.types` instance), the documentation, and the brand mechanism that codecs need *now* to be forward-compatible. We do **not** wire the context builder to call `init` per instance, nor route encode/decode through the helper, nor add caching/lifecycle management — those are [TML-2330](https://linear.app/prisma-company/issue/TML-2330).

We also **resolve open question 1** in the spec: inline-`typeParams` columns produce **anonymous instances** with deterministic names (one entry in `usedAt`). Sharing requires explicit opt-in via `storage.types`.

This satisfies [AC-6](../spec.md#ac-6-initparams-instancemeta-signature-is-locked) and underwrites the forward-compatibility claims in [Requirements satisfied](../spec.md#requirements-satisfied) (CipherStash G1, G16).

---

## Why declare without implementing

### Locking the shape is cheap

The only cost is one extra `instance` parameter in `init`'s type. The runtime today doesn't call `init` at all — the optional field exists but is unused. Adding `instance` doesn't break anything; it ships free.

### Locking the shape is high-leverage

If we shipped `init(params)` and CipherStash later asked for `(table, column)`, the migration is messy:

- Existing codecs need to migrate.
- `init` semantics change (single call per codec? per column? per use?).
- Downstream caching strategies change.

Declaring `init(params, instanceMeta)` upfront sidesteps all of that.

### Not implementing is a feature

The runtime side has its own design surface (error handling, resource lifecycle, async helper construction). Shipping it here would balloon the PR. Shipping just the signature lets the runtime work proceed independently and keeps this PR reviewable.

---

## Anonymous vs named instances

[Open question 1](../spec.md#open-questions). Resolved here.

### The problem

A column can carry parameters two ways:

```typescript
// Inline
{ codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length: 1536 } }

// Named (via storage.types)
{ typeRef: 'Embedding1536' }
```

For named: `instance.name` is `'Embedding1536'` — no ambiguity. For inline: what's the name?

### Resolution

Inline `typeParams` produce an **anonymous instance** with a deterministic name:

```typescript
name = `<anon:${table}.${column}>`;
```

`usedAt` for an anonymous instance has exactly one entry — the column it came from. Two columns with structurally identical inline `typeParams` produce two distinct anonymous instances; deduplication is the user's job — to share, use `storage.types`.

### Why this resolution

- **No surprise.** Sharing requires explicit opt-in, matching how the rest of the IR works.
- **Clean `usedAt` semantics.** A consumer that needs sharing semantics (CipherStash deriving one key for many columns) sees exactly the columns the user intended.
- **Inline ergonomics preserved.** No forced promotion to `storage.types` for one-off columns.

---

## CipherStash compatibility

[assets/cipherstash-ext-framework-gaps.md](../assets/cipherstash-ext-framework-gaps.md) lists 16 framework gaps that held back a CipherStash extension. Three intersect this project; the rest are referenced in [Explicit out-of-scope extension points](#explicit-out-of-scope-extension-points).

### G1 — Codecs receive no per-call column metadata

**CipherStash's need:** an encryption codec needs to know which `(table, column)` it's serving so it can derive a column-scoped encryption key. Today the codec sees only `(value)` on encode and `(wire)` on decode.

**Our overlap:** the `init(params, instanceMeta)` signature is exactly the right shape. A CipherStash codec's `init` derives a key from `params` (the schema parameters) and `instance.usedAt` (the bound columns); the helper returned by `init` closes over the key. Subsequent `encode`/`decode` calls go through the helper, which carries the column context.

**What this project ships:** the signature, the keying convention, the documentation, the brand mechanism so CipherStash's parameterized columns also resolve correctly in the no-emit path.

**What [TML-2330](https://linear.app/prisma-company/issue/TML-2330) ships:** the runtime context-builder rewiring that calls `init` per instance and routes dispatch through the helper.

### G16 — `JsonValue` constraint for `encryptedJson<T>` is unconstrained

**CipherStash's need:** a way to author a JSON-encrypting column whose `T` is constrained to a user-supplied schema-derivable shape, with that shape flowing through to the column type.

**Our overlap:** `jsonCodec(schema)` does this for the unencrypted case. CipherStash's `encryptedJson` follows the same pattern: a `ParameterizedCodec` whose `Brand` projects `StandardSchemaV1.InferOutput<S>` as the output type. They get no-emit-path-correct typing for free.

**What this project ships:** `jsonCodec` and the `StandardSchemaV1`-based brand pattern; CipherStash adopts the pattern in their pack.

**What's CipherStash-side:** their codec adds the encryption layer; the schema-inference layer is ours.

### G6 — `preferParam` codec trait

**CipherStash's need:** a codec trait signaling the planner to lift literals to query parameters (encrypted literals must be parameterized).

**Our overlap:** orthogonal — `preferParam` is a new codec slot, not a parameterization shape. The interface split makes adding it cleaner: it goes on base `Codec` (since both parameterized and non-parameterized codecs may want it). Out of scope here; flagged as a clean follow-up.

---

## Explicit out-of-scope extension points

The following CipherStash gaps describe additions to the codec interface or surrounding framework. None are blocked by this project's design; each is left as a clean addition for a follow-up.

| Gap | Description | Why out of scope |
|---|---|---|
| **G4** | `bulkEncode` for network-backed codecs (one network round-trip per `Promise.all` wave). | New slot on `ParameterizedCodec` (or base `Codec`). The interface split makes it straightforward to add later. |
| **G10** | `AbortSignal` plumbed into `encode`/`decode`. | Touches the runtime more than the interface. The brand mechanism doesn't depend on encode/decode shape, so this addition is clean. |
| **G9** | Trait-gated wire redaction (omit wire payload from error envelopes for codecs carrying `redactWire`). | Trait-only addition; tracked as [TML-2329](https://linear.app/prisma-company/issue/TML-2329). |
| **G6** | `preferParam` planner hint. | See [CipherStash compatibility](#cipherstash-compatibility). |
| **G2, G3** | Migration-planner inputs (`(table, column)` plumbing on the migration plane). | Same architectural pattern as G1, different plane. Addressed when the migration planner gets its own pass. |
| **G11–G15** | Publishing, type-level testing, bundle composition. | Outside the codec interface entirely. |

---

## The `storage.types` / `typeRef` converging seam

`storage.types` and `typeRef` already exist in the IR. This project doesn't change them but makes them load-bearing in two new ways.

### As the runtime keying surface (declared)

`init` is keyed by `storage.types` instance; inline-`typeParams` columns produce anonymous instances (see [Anonymous vs named instances](#anonymous-vs-named-instances)). The runtime contract is stated in terms of `storage.types`, not raw column metadata, because:

- It's the existing contract-level identity.
- It supports cross-column sharing cleanly.
- It already round-trips through emit (`contract.json` carries `storage.types`).

### As the type-resolution seam in the no-emit path

`FieldOutputType` resolves `typeRef` through `storage.types` first, then applies the brand. So a column with `typeRef: 'Embedding1536'` and a column with inline `typeParams: { length: 1536 }` both resolve to `Vector<1536>`. The user experience is unified; the contract chooses sharing semantics.

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

- **During the project**: rebase on top of `origin/worktree/op-registry-ts` if #374 receives review-driven changes.
- **Once #374 merges to `main`**: rebase this branch onto `origin/main`. The parameterization fields removed from base `Codec` (M5) line up naturally with #374's merged state.
- **During the rebase**: the brand mechanism is additive on top of #374's expression types; no semantic conflict expected. The interface-removal at M5 may have small textual conflicts; resolve in favor of the post-M5 shape.

### What we will not do

- Develop this project against an older base lacking #374's `Expression<T>` machinery.
- Block landing M1/M2 on #374 merging — the branches can co-exist.

---

## Cross-references

- Spec: [spec.md — Decision](../spec.md#decision), [How it works §6](../spec.md#how-it-works), [AC-6](../spec.md#ac-6-initparams-instancemeta-signature-is-locked), [Non-goals](../spec.md#non-goals).
- Plan: [plan.md M1, M5](../plan.md#m1--codec-interface-split--brand-mechanism).
- Mechanism: [codec-interface-and-brand.md#init-signature](codec-interface-and-brand.md#init-signature).
- Authoring impact: [authoring-ergonomics.md](authoring-ergonomics.md).
- CipherStash analysis: [assets/cipherstash-ext-framework-gaps.md](../assets/cipherstash-ext-framework-gaps.md).
- Follow-ups: [TML-2329](https://linear.app/prisma-company/issue/TML-2329) (G9), [TML-2330](https://linear.app/prisma-company/issue/TML-2330) (G1, G4).
- PR #374: <https://github.com/prisma/prisma-next/pull/374>.
