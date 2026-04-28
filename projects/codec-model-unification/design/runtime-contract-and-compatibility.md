# Design — Runtime contract and compatibility

**Audience:** future implementers (especially of [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) and reviewers concerned with how this project fits with downstream extension work. Companion to [codec-interface-and-brand.md](codec-interface-and-brand.md) and [authoring-ergonomics.md](authoring-ergonomics.md).

**What this doc covers:** the per-instance materialization contract we declare without implementing, the [Case C — CipherStash column-scoped encryption](#case-c--cipherstash-column-scoped-encryption) study that drives the contract's shape, the explicit out-of-scope extension points, and the rebase strategy off [PR #374](https://github.com/prisma/prisma-next/pull/374).

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

This satisfies [AC-6](../spec.md#ac-6-initparams-instancemeta-signature-is-locked). It is the design response to [Case C](../spec.md#case-c--cipherstash-column-scoped-encryption); see [the case study below](#case-c--cipherstash-column-scoped-encryption) for what an authoring extension looks like today and what it depends on from [TML-2330](https://linear.app/prisma-company/issue/TML-2330).

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

## Case C — CipherStash column-scoped encryption

This is the case that pins the `init(params, instanceMeta)` signature. The CipherStash extension wants to author an encryption codec whose ciphertext is keyed by `(table, column)` plus contract-level config. The framework today doesn't give the codec column context anywhere, so the only place that fits is `init`. This case ties together CipherStash gaps **G1** (column metadata) and **G16** (`encryptedJson<T>` schema-typed) from [assets/cipherstash-ext-framework-gaps.md](../assets/cipherstash-ext-framework-gaps.md). From [spec.md § Case C](../spec.md#case-c--cipherstash-column-scoped-encryption).

### What the codec author writes today (signature complete, runtime deferred)

```typescript
// 1. Parameter shape: which key id, which mode, which schema (compound case).
const cipherTextParams = type({
  keyId:   'string',
  mode:    "'deterministic' | 'randomized'",
});

// 2. Brand: ciphertext is opaque at the wire, but the column's *plaintext* type
//    is what users see. Encryption is invisible at the type level.
interface CipherTextBrand extends CodecBrand<typeof cipherTextParams.infer> {
  readonly Input:  typeof cipherTextParams.infer;
  readonly Output: string;  // plaintext
}

// 3. The codec.
export const cipherStashTextCodec = parameterizedCodec({
  id: 'cipherstash/text@1',
  targetTypes: ['eql_v2_encrypted'],
  traits: ['equality'],   // mode === 'deterministic' allows equality
  paramsSchema: cipherTextParams,
  renderOutputType: () => 'string',
  Brand: undefined as unknown as CipherTextBrand,

  // 4. init is the *whole point* of Case C.
  init: (params, instance) => {
    // Derive a column-scoped key once, here. instance.usedAt enumerates the
    // (table, column) pairs that share this storage.types entry.
    const key = deriveColumnKey({
      keyId:   params.keyId,
      mode:    params.mode,
      columns: instance.usedAt,        // ← the load-bearing piece
      // …contract-level config…
    });

    return {
      encrypt: (value: string) => seal(value, key),
      decrypt: (wire: string)  => open(wire, key),
    };
  },

  // 5. encode/decode today: the runtime *doesn't* yet route through init's
  //    return value — that's TML-2330. Authors that want to ship before then
  //    fall back to a degenerate mode (e.g. failing if init was needed but the
  //    runtime didn't call it) or wait for TML-2330.
  encode: (value: string) => /* will use the helper post-TML-2330 */ value,
  decode: (wire:  string) => /* will use the helper post-TML-2330 */ wire,
});

// 6. Authoring at the column.
export const cipherStashText = columnFor(cipherStashTextCodec);

// 7. User schema (shared key across both columns via storage.types).
const contract = {
  storage: {
    types: {
      EmailCipher: cipherStashText({ keyId: 'email-key', mode: 'deterministic' }),
    },
    tables: {
      User:    { columns: { email: { typeRef: 'EmailCipher' } } },
      Invite:  { columns: { email: { typeRef: 'EmailCipher' } } },
    },
  },
} as const;
```

`User.email` and `Invite.email` share an `init` call: when the runtime side lands, `init` runs once for `EmailCipher` with `instance.usedAt = [{ table: 'User', column: 'email' }, { table: 'Invite', column: 'email' }]`.

The compound subcase **`encryptedJson<T>(schema)`** combines this case with [Case J](authoring-ergonomics.md#case-j--json-with-schema): the brand projects `StandardSchemaV1.InferOutput<S>` as the plaintext type, while `init` derives a column-scoped key. CipherStash gets a JSON-typed encrypted column without the framework knowing anything about JSON or encryption.

### What this case pins

- `init`'s second arg is `(params, instance: { name, usedAt })`. Without `usedAt`, key derivation can't bind to columns.
- Keying by `storage.types` instance: shared keys for shared types (`typeRef`), distinct keys for distinct types. Anonymous instances for inline params keep one-off ergonomics.
- The brand mechanism applies even when the codec output type is the *plaintext* type — encryption invisible at the type level.
- The signature must be locked **before** the runtime side ships, so CipherStash and other extension authors don't have to migrate when the runtime catches up.

### What this project ships vs. defers

| Surface | This project | Deferred to [TML-2330](https://linear.app/prisma-company/issue/TML-2330) |
|---|---|---|
| `init(params, instance)` signature | ✓ locked | — |
| `instance.name`, `instance.usedAt` semantics | ✓ documented | — |
| `storage.types`-instance keying | ✓ documented | — |
| Brand resolution for `cipherStashTextCodec`-typed columns | ✓ no-emit path correct | — |
| Runtime calling `init` once per instance | — | ✓ |
| Encode/decode routed through `init`'s helper | — | ✓ |
| Helper lifecycle (caching, async construction, errors) | — | ✓ |
| `preferParam` planner hint (CipherStash G6) | — | follow-up |

---

## Explicit out-of-scope extension points

The following CipherStash gaps describe additions to the codec interface or surrounding framework. None are blocked by this project's design; each is left as a clean addition for a follow-up.

| Gap | Description | Why out of scope |
|---|---|---|
| **G4** | `bulkEncode` for network-backed codecs (one network round-trip per `Promise.all` wave). | New slot on `ParameterizedCodec` (or base `Codec`). The interface split makes it straightforward to add later. |
| **G10** | `AbortSignal` plumbed into `encode`/`decode`. | Touches the runtime more than the interface. The brand mechanism doesn't depend on encode/decode shape, so this addition is clean. |
| **G9** | Trait-gated wire redaction (omit wire payload from error envelopes for codecs carrying `redactWire`). | Trait-only addition; tracked as [TML-2329](https://linear.app/prisma-company/issue/TML-2329). |
| **G6** | `preferParam` planner hint (codec signals the planner to lift literals to query parameters; encrypted literals must be parameterized). | New slot orthogonal to parameterization — goes on base `Codec` since both kinds of codec may want it. The interface split makes adding it later clean. |
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
