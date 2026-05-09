# ADR 211 — Extension operator surface: namespaced replacement operators when codec output cannot back built-in trait semantics

## Status

Accepted. May 8, 2026.

Extensions whose codec output cannot back the wire semantics of a framework built-in operator MUST (i) declare zero of the relevant traits on the codec, AND (ii) ship namespaced replacement operators that do not shadow framework built-in names. Trait-gating at the model accessor closes the wrong-SQL footgun by construction; namespaced replacements give users a discoverable, loud surface for the operator semantics the codec actually supports. Resolves the cipherstash + EQL `eql_v2_encrypted` case (randomized nonces) and applies generally to any future extension wrapping a randomized, opaque, or non-comparable wire format.

## Context

[ADR 202](./ADR%20202%20-%20Codec%20trait%20system.md) introduced traits as a vocabulary for codec capabilities — `equality`, `order`, `boolean`, `numeric`, `textual`. The framework ships built-in query operators (`eq`, `neq`, `lt`, `gt`, `like`, `ilike`, …) whose lowering is gated on the corresponding trait being declared by the column's codec. [ADR 206](./ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md) made operations TypeScript functions whose `self` hint drives both runtime dispatch in the ORM column accessor and type-level reachability in the model-accessor type machinery (`packages/3-extensions/sql-orm-client/src/model-accessor.ts:141-143`); the same `self` value is consumed by both planes, which prevents drift but means the type-level surface is fully derived from trait + operator-registry data.

For most codecs, a trait declaration is just an opt-in. `pg/text@1` declares `equality`; `email.eq(value)` lowers to `"col" = $1`; everything works. The framework's built-in operator handlers were authored against the wire semantics most codecs share — `=` on the wire produces equality on the values, `LIKE` on the wire produces SQL-pattern matching on the strings, and so on.

But some codecs wrap wire formats whose `=` semantics do not match the framework's default lowering:

- **Randomized nonces.** [EQL](https://github.com/cipherstash/encrypt-query-language) `eql_v2_encrypted` payloads carry a per-encryption nonce, so two encryptions of the same plaintext do not byte-compare. A `"col" = $1::eql_v2_encrypted` query would always return zero matches.
- **Opaque blobs.** A pure ciphertext column whose runtime semantics aren't comparable in SQL at all — `=` is meaningless.
- **Non-comparable encodings.** A future extension might wrap a wire format whose `=` is well-defined for the storage layer but doesn't match user expectations of equality on the underlying value.

If such a codec declares the relevant trait, the framework's trait-gated synthesis attaches the built-in operator to the column's accessor, and `email.eq(value)` lowers to wrong SQL. The user gets back zero rows on a query they expected to match — silently, with no error.

Cipherstash hit this in May 2026 (TML-2373). The first attempt at delivering encrypted equality was to declare `equality` on the codec and override the framework's `eq` lowering for cipherstash columns via a multi-self operator-registry extension; that extension was prototyped against `@prisma-next/operations` and explicitly rejected as a framework expansion that would erode the framework-vs-extension boundary. The decision recorded in this ADR is the resolution.

## Problem

For codecs whose wire format cannot back a built-in operator's lowering:

1. Declaring the relevant trait is a wrong-SQL footgun — the framework synthesizes a built-in handler that produces incorrect output.
2. Omitting the trait but registering a same-named replacement operator (e.g., `eq`) is rejected at the framework level — the framework does not allow extensions to shadow built-in operator names.
3. Going without any equality / LIKE / ordering surface at all is unacceptable — the user-facing intent (search by encrypted value) is core to the extension's value.

We need a pattern that gives the user a working surface for the operator semantics the codec **does** support, while making it impossible for the user to reach the framework's wrong-SQL lowering by accident.

## Constraints

- The framework will not add multi-self / operator-overriding mechanisms. No extension may shadow a built-in operator name.
- The pattern must be ergonomic enough to use, but loud enough that users notice they're working with a non-standard surface.
- The pattern must be enforceable at the type level — wrong-SQL footguns that only fire at runtime are unacceptable.

## Decision

Extensions whose codec output cannot back a built-in operator's wire semantics MUST do **both** of the following:

1. **Declare zero of the relevant traits** on the codec. Specifically, omit any trait whose framework-built-in operator the codec cannot back. Most extensions in this category will declare the empty traits set entirely — the codec carries a wire format whose `=`, `<`, `LIKE`, etc. all diverge from the underlying value semantics.
2. **Ship namespaced replacement operators** registered under the extension's own method names that do **not** shadow framework built-ins. The convention is to prefix the method name with the extension's identifier — `cipherstashEq`, `cipherstashIlike`, `pgvectorCosineDistance` (where the wire-format-divergence applies) — so the user-facing call site reads as a clearly-extension call.

The combination produces a type-level loud failure for the wrong-SQL footgun: the framework's trait-gated synthesis at `packages/3-extensions/sql-orm-client/src/model-accessor.ts:141-143` skips operators whose required-trait set isn't a subset of the column codec's declared traits, so `email.eq(...)` is a type error on a column whose codec declares `traits: []`. The user is forced to reach for the namespaced operator, which the extension lowers to the codec-correct SQL.

The framework's built-in operator handlers remain reachable on every other codec that does declare the relevant trait. The pattern is local to the extension that opts into it — no framework changes; no shadowing.

## Worked example: cipherstash + EQL

```ts
// packages/3-extensions/cipherstash/src/core/codec-runtime.ts

export const CIPHERSTASH_STRING_TRAITS = [] as const;

export function createCipherstashStringCodec(sdk: CipherstashSdk) {
  return codec({
    typeId: 'cipherstash/string@1',
    targetTypes: ['eql_v2_encrypted'],
    traits: CIPHERSTASH_STRING_TRAITS,
    encode: async (envelope, ctx) => {
      // ciphertext was stamped onto the handle by bulk-encrypt middleware
      return getInternalHandle(envelope).ciphertext;
    },
    decode: async (wire, ctx) => {
      return EncryptedString.fromInternal({
        ciphertext: wire,
        table: ctx?.column?.table,
        column: ctx?.column?.name,
        sdk,
      });
    },
    renderOutputType: () => 'EncryptedString',
  });
}
```

```ts
// packages/3-extensions/cipherstash/src/core/operators.ts

export const cipherstashEq = (
  self: CodecExpression<'cipherstash/string@1', boolean, CT>,
  plaintext: string,
) =>
  buildOperation({
    method: 'cipherstashEq',
    self,
    args: [stampRouting(toExpr(EncryptedString.from(plaintext), 'cipherstash/string@1'))],
    returns: 'pg/bool@1',
    lowering: { template: 'eql_v2.eq({{self}}, {{0}})' },
  });

export const cipherstashIlike = (
  self: CodecExpression<'cipherstash/string@1', boolean, CT>,
  pattern: string,
) =>
  buildOperation({
    method: 'cipherstashIlike',
    self,
    args: [stampRouting(toExpr(EncryptedString.from(pattern), 'cipherstash/string@1'))],
    returns: 'pg/bool@1',
    lowering: { template: 'eql_v2.ilike({{self}}, {{0}})' },
  });
```

User-facing surface:

```ts
// works — cipherstash-namespaced, lowers via the extension's EQL operator
db.from(User)
  .where(({ email }) => email.cipherstashEq('alice@example.com'))
  .execute();

// type error — equality trait is not declared on the codec, so the
// model accessor does not synthesize email.eq at the type level. The
// user is told at the type level that this is the wrong surface.
db.from(User)
  .where(({ email }) => email.eq('alice@example.com'))
  // ~~ Property 'eq' does not exist on type ...
  .execute();
```

The combination is regression-pinned by `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts` (asserts `traits === []` at three coordinated declaration sites and asserts they agree with each other) — a future change re-introducing the trait without re-routing through the namespaced operator surface trips the test.

## Operator naming convention

Namespaced operator method names should be `<extensionId><CapitalizedFrameworkOp>` — `cipherstashEq`, `cipherstashIlike`, `pgvectorCosineDistance`, `postgisStIntersects`. The convention:

- Avoids collisions with framework built-ins by construction (the framework reserves un-prefixed method names).
- Reads at the call site as an extension call, signalling to the user that the lowering is non-standard.
- Allows multiple extensions wrapping the same wire-format niche (e.g. `cipherstashEq` and a hypothetical `vaultEq`) to coexist on the same query.

The framework does not enforce this convention syntactically — it enforces only the no-shadowing rule. Extension authors are expected to follow it for ergonomic consistency.

## Type-level visibility

Namespaced replacement operators MUST also project type-visibility through a `QueryOperationTypes` export so the framework's model-accessor type machinery and the SQL query builder can synthesize them at the type level. Without this projection the runtime registration is invisible to TypeScript and consumers bridge the gap with ad-hoc casts at every call site, which (i) defeats the type-level loud-failure property this ADR's runtime half exists to deliver — a missing operator at the type level is indistinguishable from a missing operator at runtime, both yielding `Property 'cipherstashEq' does not exist`-style messages — and (ii) accumulates as a documented surface gap that's easy to forget as more codecs adopt the pattern.

The convention mirrors the runtime registration:

- Declare both `OperationTypes` (codec-keyed, read by the model accessor for `db.<model>.where(...)` filter shapes) and `QueryOperationTypes` (flat, read by the SQL builder's `Functions<QC>` for `(f, fns) => fns.<extensionOp>(...)` callbacks) under a stable subpath. The convention is `@prisma-next/extension-<id>/operation-types`. See [`packages/3-extensions/pgvector/src/types/operation-types.ts`](../../../packages/3-extensions/pgvector/src/types/operation-types.ts) and [`packages/3-extensions/cipherstash/src/types/operation-types.ts`](../../../packages/3-extensions/cipherstash/src/types/operation-types.ts) for the canonical shape.
- Wire `types.operationTypes` and `types.queryOperationTypes` import declarations on the extension's pack-meta. The contract emitter reads these at emit time and threads the import + intersection composition through to the consuming application's generated `contract.d.ts` automatically — so an application that declares a cipherstash-using contract gets `cipherstashEq` / `cipherstashIlike` projected onto `cipherstash/string@1` columns without authoring any wiring of its own.
- The `self: { codecId: '<storage-codec>' }` shape gates each operator to columns of the matching codec at the type level. Composing with the framework's existing model-accessor synthesis means the `<extensionOp>` is discoverable on the right columns and absent from the wrong ones — the same loud-failure property the runtime half delivers, projected into the type system.

Cipherstash and pgvector are the canonical examples of the pattern. Cipherstash carried a documented runtime-only gap (TML-2435) until this requirement landed alongside the namespaced-operator runtime work in May 2026 (the gap is closed; the cast wrapper that bridged it has been removed from the example app).

The runtime + trait-declaration pattern this ADR mandates and the type-visibility requirement above are companion mechanisms — extensions that ship one without the other re-open the discoverability hole that motivated the namespaced replacement pattern in the first place.

## Non-goals

- **Disallowing extensions from declaring traits at all.** Extensions whose codec output **does** back the relevant operator's wire semantics SHOULD declare the trait — that's the opt-in path and continues to work as ADR 202 specifies. This ADR addresses the case where wire semantics diverge.
- **Re-litigating the framework's no-shadowing rule.** Extensions cannot register operators under built-in method names. This ADR records the consequence of that rule for the wire-divergent case, not the rule itself.
- **Codec-specific `eq` lowering.** A per-codec hook that lets an extension override the framework's `eq` lowering for its column type was considered and rejected (see § Alternatives).

## Consequences

### Positive

- **Wrong-SQL footgun closed by construction.** A codec declaring zero traits cannot route through a built-in trait-gated lowering. The user gets a type error on the wrong surface, not zero rows on a query they expected to match.
- **Documented pattern for future extensions.** Any extension wrapping a randomized, opaque, or non-comparable wire format follows the same recipe — empty traits + namespaced replacement operators. Future Vault, homomorphic-encryption, or opaque-blob extensions don't have to re-discover the boundary.
- **Framework-vs-extension boundary preserved.** No framework expansion; no multi-self dispatch; no per-codec built-in-operator overrides; no shadowing. The framework's built-in operators stay reachable exactly where they're correct.
- **Explicit at the call site.** `email.cipherstashEq(...)` reads as an extension call. Code reviewers and future contributors see immediately that the lowering is non-standard.

### Trade-offs

- **`QueryOperationTypes` is now an authoring obligation.** Extensions ship the type-side projection alongside the runtime registration, with a small mechanical cost: a new `src/types/operation-types.ts` declaration, a `/operation-types` subpath, a `types.{operationTypes,queryOperationTypes}` block on the pack-meta. The cost is paid once per extension; the consuming application gets type-visibility for free.
- **API surface duplication for similar semantics.** `cipherstashEq` and `pg/text`'s built-in `eq` mean structurally similar things but live in different namespaces. This is the intended trade — collapsing them into one would re-open the wrong-SQL footgun.
- **Naming-convention discipline.** The framework doesn't enforce `<extensionId><Op>` syntactically — extension authors are responsible for following the convention. A pull-request reviewer is the backstop.

## Alternatives considered

### Multi-self operator dispatch

Allow extensions to register handlers under built-in operator names, dispatched on the column's codec at runtime. Rejected. The mechanism erodes the framework-vs-extension boundary — extensions could shadow framework built-ins arbitrarily, runtime ambiguity arises when two extensions register handlers for the same `(method, self)` tuple, and the type-level dispatch story would need to mirror the runtime dispatch (currently they share `self`, by ADR 206; multi-self breaks that invariance). Prototyped against `@prisma-next/operations` in May 2026 and reverted byte-identical.

### Per-codec built-in-operator override hook

Add a framework SPI that lets extensions register a custom lowering for a specific built-in operator on their codec — e.g. cipherstash declares `equality`, and the framework consults a per-codec `eqLowering` hook before falling back to its default `=`. Rejected for similar reasons. The mechanism keeps the user-facing surface (`email.eq(...)`) but introduces ergonomic ambiguity (the user can't tell whether a call site uses the framework's lowering or an extension's), and the per-codec hook turns into a back-channel for arbitrary lowering overrides over time. The current decision keeps the divergence visible at the call site, which is more honest.

### Strict gating with no replacement surface

Extensions whose codec output cannot back a built-in operator declare zero traits and ship no replacement operators. The user simply doesn't have an equality / LIKE / ordering surface for that codec. Rejected. The user-facing intent (search by encrypted value) is the entire point of the extension; a codec without a search surface is unusable. The replacement-operator half of this ADR exists specifically to deliver that surface.

## References

- [ADR 202 — Codec trait system](./ADR%20202%20-%20Codec%20trait%20system.md) — defines the trait vocabulary this ADR builds on.
- [ADR 203 — Trait-targeted operation arguments](./ADR%20203%20-%20Trait-targeted%20operation%20arguments.md) — defines the codec-identity / trait-set targeting vocabulary used by the `self` hint.
- [ADR 206 — Operations as TypeScript functions](./ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md) — defines the operation-authoring surface and the `self` hint that drives model-accessor synthesis.
- [Extension-Packs-Naming-and-Layout](../../reference/Extension-Packs-Naming-and-Layout.md) — extension authoring conventions, including the `QueryOperationTypes` export that gives namespaced replacement operators type-level visibility.
- [Cipherstash extension DEVELOPING.md](../../../packages/3-extensions/cipherstash/DEVELOPING.md) — the canonical worked example of this pattern.
