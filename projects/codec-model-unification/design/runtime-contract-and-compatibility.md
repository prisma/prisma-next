# Design — Runtime contract and compatibility

**Audience:** future implementers (especially of [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) and reviewers concerned with how this project fits with downstream extension work. Companion to [higher-order-codecs.md](higher-order-codecs.md) and [authoring-ergonomics.md](authoring-ergonomics.md).

**What this doc covers:** the per-instance materialization contract we declare without implementing, the [Case C — CipherStash column-scoped encryption](#case-c--cipherstash-column-scoped-encryption) study that drives the contract's shape, the explicit out-of-scope extension points, and the rebase strategy off [PR #374](https://github.com/prisma/prisma-next/pull/374).

---

## Decision

This project ships a **declared but unimplemented** runtime materialization contract for parameterized codecs:

> When the runtime side ships (in [TML-2330](https://linear.app/prisma-company/issue/TML-2330)):
>
> 1. **One factory call per `storage.types` instance.** For each named entry, the runtime calls `descriptor.factory(entry.typeParams)(ctx)` exactly once at context-builder time. Anonymous instances (synthesized for inline column factory calls) follow the same rule with `usedAt` of length one.
> 2. **`ctx.name` is the instance name.** `'Embedding1536'` for named entries, `'<anon:Document.embedding>'` for inline.
> 3. **`ctx.usedAt` lists every column referencing the instance.** Single-element is the common case; multi-element when columns share a `storage.types` entry.
> 4. **Encode/decode dispatch via the named instance.** A column with `typeRef: 'Foo'` (or inline params resolved to an anonymous instance) routes through the `Codec` returned by the factory call for that instance.
> 5. **`paramsSchema` runs before the factory** at contract load to validate JSON-sourced `typeParams`.

We ship the curried factory shape, the `ParameterizedCodecDescriptor` shape, the keying convention (`storage.types` instance), and the documentation. We do **not** wire the runtime context-builder to call factories per instance, route encode/decode through the returned codec, or add caching/lifecycle management — those are [TML-2330](https://linear.app/prisma-company/issue/TML-2330).

We also **resolve open question 3** in the spec: inline factory calls produce **anonymous instances** with deterministic names (one entry in `usedAt`). Sharing requires explicit opt-in via `storage.types`.

This satisfies [AC-6](../spec.md#ac-6-cipherstash-forward-compat-surface-is-locked). It is the design response to [Case C](../spec.md#case-c--cipherstash-column-scoped-encryption); see [the case study below](#case-c--cipherstash-column-scoped-encryption) for what an authoring extension looks like today and what it depends on from [TML-2330](https://linear.app/prisma-company/issue/TML-2330).

---

## Why declare without implementing

### Locking the shape is cheap

The factory shape `(params) => (ctx) => Codec` is a TypeScript signature plus a small descriptor. The runtime today doesn't call factories at all (today's `init?(params)` is wired but never invoked with `(table, column)` context). Adding `ctx` is free — no consumer breaks because no consumer reads it yet.

### Locking the shape is high-leverage

If we shipped `(params) => Codec` and CipherStash later asked for `(table, column)`, the migration is messy:

- Existing factory functions need to migrate their signatures.
- Lifecycle semantics change (single call per codec? per column? per use?).
- Downstream caching strategies change.

Declaring the curried `(params) => (ctx) => Codec` upfront sidesteps all of that. CipherStash and other extensions author against the final shape today.

### Not implementing is a feature

The runtime side has its own design surface (error handling, resource lifecycle, async helper construction, retries). Shipping it here would balloon the PR. Shipping just the factory shape lets the runtime work proceed independently and keeps this PR reviewable.

---

## Anonymous vs named instances

[Open question 3](../spec.md#open-questions). Resolved here.

### The problem

A column can carry parameters two ways:

```typescript
// Inline (factory called directly at the column site)
.column('embedding', vector(1536))

// Named (factory called for the storage.types entry; column references by typeRef)
storage.types: { Embedding1536: vector(1536) }
.column('embedding', { typeRef: 'Embedding1536' })
```

For named: `ctx.name` is `'Embedding1536'` — no ambiguity. For inline: what's the name?

### Resolution

Inline factory calls produce an **anonymous instance** with a deterministic name:

```typescript
ctx.name = `<anon:${table}.${column}>`;
```

`ctx.usedAt` for an anonymous instance has exactly one entry — the column it came from. Two columns with structurally identical inline factory calls produce two distinct anonymous instances; deduplication is the user's job — to share, use `storage.types`.

### Why this resolution

- **No surprise.** Sharing requires explicit opt-in, matching how the rest of the IR works.
- **Clean `usedAt` semantics.** A consumer that needs sharing semantics (CipherStash deriving one key for many columns) sees exactly the columns the user intended.
- **Inline ergonomics preserved.** No forced promotion to `storage.types` for one-off columns.

---

## Case C — CipherStash column-scoped encryption

This is the case that pins `ctx`'s shape and the runtime materialization contract. The CipherStash extension wants to author an encryption codec whose ciphertext is keyed by `(table, column)` plus contract-level config. The factory's `ctx` carries exactly that. Case C ties together CipherStash gaps **G1** (column metadata) and **G16** (`encryptedJson<T>` schema-typed) from [assets/cipherstash-ext-framework-gaps.md](../assets/cipherstash-ext-framework-gaps.md). From [spec.md § Case C](../spec.md#case-c--cipherstash-column-scoped-encryption).

### What the codec author writes today (signature complete, runtime deferred)

```typescript
// 1. Param shape: which key id, which mode.
const cipherTextParams = type({
  keyId: 'string',
  mode:  "'deterministic' | 'randomized'",
});

// 2. The curried factory — ctx is load-bearing.
export function cipherStashText(params: typeof cipherTextParams.infer): (ctx: Ctx) =>
  Codec<'cipherstash/text@1', ['equality'], string, string> {
  return (ctx) => {
    // Derive a column-scoped key once, here. ctx.usedAt enumerates the
    // (table, column) pairs that share this storage.types entry.
    const key = deriveColumnKey({
      keyId:   params.keyId,
      mode:    params.mode,
      columns: ctx.usedAt,                                   // ← the load-bearing piece
      // …contract-level config, accessed via the runtime's pack-config plumbing…
    });

    return {
      id: 'cipherstash/text@1',
      targetTypes: ['eql_v2_encrypted'],
      traits: ['equality'],                                  // mode === 'deterministic' allows equality
      typeParams: params,
      encode: (value: string) => seal(value, key),
      decode: (wire:  string) => open(wire, key),
      encodeJson: (value) => value,
      decodeJson: (json) => json as string,
    };
  };
}

// 3. The descriptor.
export const cipherStashTextCodec: ParameterizedCodecDescriptor<typeof cipherTextParams.infer> = {
  codecId: 'cipherstash/text@1',
  paramsSchema: cipherTextParams,
  renderOutputType: () => 'string',
  factory: cipherStashText,
};

// 4. User schema — shared key across both columns via storage.types.
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

`User.email` and `Invite.email` share a single factory call: when the runtime side lands, the contract-loader invokes `cipherStashText({ keyId: 'email-key', mode: 'deterministic' })(ctx)` once with `ctx.usedAt = [{ table: 'User', column: 'email' }, { table: 'Invite', column: 'email' }]`. One key, both columns.

The compound subcase **`encryptedJson<S>(schema, params)`** combines this case with [Case J](authoring-ergonomics.md#case-j--json-with-schema): the factory's TS return is `Codec<…, InferOutput<S>>` (schema-typed plaintext), while its body derives a column-scoped key. CipherStash gets a JSON-typed encrypted column without the framework knowing anything about JSON or encryption.

### What this case pins

- **`ctx` shape:** `{ name, usedAt: ReadonlyArray<{ table, column }> }`. Without `usedAt`, key derivation can't bind to columns.
- **Keying by `storage.types` instance:** shared keys for shared types (`typeRef`), distinct keys for distinct types. Anonymous instances for inline params keep one-off ergonomics.
- **The factory runs at runtime load too.** Closures (the `key`, the `seal`/`open` bindings) survive contract serialization because we re-call the factory; we never serialize closures.
- **Encryption invisible at the type level:** the factory's return is `Codec<…, string>` (plaintext), even though the wire is ciphertext. The compound `encryptedJson<S>` case proves the typed-output and `ctx`-based key derivation compose.
- **The signature must be locked before the runtime ships,** so CipherStash and other extension authors don't have to migrate when the runtime catches up.

### What this project ships vs. defers

| Surface | This project | Deferred to [TML-2330](https://linear.app/prisma-company/issue/TML-2330) |
|---|---|---|
| `(params) => (ctx) => Codec` factory shape | ✓ locked | — |
| `ctx.name`, `ctx.usedAt` semantics | ✓ documented | — |
| `ParameterizedCodecDescriptor` shape | ✓ locked | — |
| `storage.types`-instance keying | ✓ documented | — |
| Resolution for `cipherStashText`-typed columns in the no-emit path | ✓ correct | — |
| Runtime calling the factory once per instance | — | ✓ |
| `paramsSchema` validation at contract load | — | ✓ |
| Encode/decode routed through the returned `Codec` | — | ✓ |
| Helper lifecycle (caching, async construction, errors) | — | ✓ |
| `preferParam` planner hint (CipherStash G6) | — | follow-up |

---

## Explicit out-of-scope extension points

The following CipherStash gaps describe additions to the codec interface or surrounding framework. None are blocked by this project's design; each is left as a clean addition for a follow-up.

| Gap | Description | Why out of scope |
|---|---|---|
| **G4** | `bulkEncode` for network-backed codecs (one network round-trip per `Promise.all` wave). | New slot on `Codec` (or the descriptor). The factory-based shape makes adding it later straightforward. |
| **G10** | `AbortSignal` plumbed into `encode`/`decode`. | Touches the runtime more than the interface. The factory shape doesn't depend on encode/decode signatures, so this addition is clean. |
| **G9** | Trait-gated wire redaction (omit wire payload from error envelopes for codecs carrying `redactWire`). | Trait-only addition; tracked as [TML-2329](https://linear.app/prisma-company/issue/TML-2329). |
| **G6** | `preferParam` planner hint (codec signals the planner to lift literals to query parameters; encrypted literals must be parameterized). | New slot orthogonal to parameterization — goes on base `Codec` since both kinds of codec may want it. The factory shape makes adding it later clean. |
| **G2, G3** | Migration-planner inputs (`(table, column)` plumbing on the migration plane). | Same architectural pattern as G1, different plane. Addressed when the migration planner gets its own pass. |
| **G11–G15** | Publishing, type-level testing, bundle composition. | Outside the codec interface entirely. |

---

## The `storage.types` / `typeRef` converging seam

`storage.types` and `typeRef` already exist in the IR. This project doesn't change them but makes them load-bearing in two new ways.

### As the runtime keying surface (declared)

Factory invocation is keyed by `storage.types` instance; inline columns produce anonymous instances (see [Anonymous vs named instances](#anonymous-vs-named-instances)). The runtime contract is stated in terms of `storage.types`, not raw column metadata, because:

- It's the existing contract-level identity.
- It supports cross-column sharing cleanly.
- It already round-trips through emit (`contract.json` carries `storage.types`).

### As the type-resolution seam in the no-emit path

`FieldOutputType` resolves `typeRef` through `storage.types` first, then reads the factory's TS return type. So a column with `typeRef: 'Embedding1536'` and a column with inline `vector(1536)` both resolve to `Vector<1536>`. The user experience is unified; the contract chooses sharing semantics.

### What we don't change

- The IR shape of `storage.types`.
- The PSL surface for declaring named types.
- The migration planner's awareness of `storage.types`.

These remain as they are; the runtime contract and the type resolver lean on the existing structure.

---

## Rebase strategy

This project is currently branched from `origin/worktree/op-registry-ts` ([PR #374](https://github.com/prisma/prisma-next/pull/374)).

### Why we branched off #374

- #374 establishes "function is the signature" for SQL operations ([ADR 204](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md)). This project applies the same principle to parameterized codecs; the patterns are consistent and the descriptor shape mirrors `SqlOperationDescriptor`.
- The codec-typed expression machinery in #374 reads `CodecTypes` for `output` types — the same place this project's factory-return-type mechanism plugs into.
- Branching off #374 lets us co-evolve without merge churn.

### Rebase plan

- **During the project**: rebase on top of `origin/worktree/op-registry-ts` if #374 receives review-driven changes.
- **Once #374 merges to `main`**: rebase this branch onto `origin/main`.
- **During the rebase**: the higher-order-codec mechanism is additive on top of #374's expression types; no semantic conflict expected. Removal of optional `paramsSchema?` / `init?` from the SQL `Codec` interface (M1) may have small textual conflicts; resolve in favor of the post-M1 shape.

### What we will not do

- Develop this project against an older base lacking #374's `Expression<T>` machinery.
- Block landing M1/M2 on #374 merging — the branches can co-exist.

---

## Cross-references

- Spec: [spec.md — Decision](../spec.md#decision), [How it works §5, §6](../spec.md#how-it-works), [AC-6](../spec.md#ac-6-cipherstash-forward-compat-surface-is-locked), [Non-goals](../spec.md#non-goals).
- Plan: [plan.md M1, M5](../plan.md#m1--higher-order-codec-shape).
- Mechanism: [higher-order-codecs.md](higher-order-codecs.md).
- Authoring impact: [authoring-ergonomics.md](authoring-ergonomics.md).
- CipherStash analysis: [assets/cipherstash-ext-framework-gaps.md](../assets/cipherstash-ext-framework-gaps.md).
- Follow-ups: [TML-2329](https://linear.app/prisma-company/issue/TML-2329) (G9), [TML-2330](https://linear.app/prisma-company/issue/TML-2330) (G1, G4).
- ADR 204: [docs/architecture docs/adrs/ADR 204 - Operations as TypeScript functions.md](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Operations%20as%20TypeScript%20functions.md) — "function is the signature" precedent.
- PR #374: <https://github.com/prisma/prisma-next/pull/374>.
