# ADR 126 — PSL top-level block SPI

**Status:** Accepted
**Date:** 2026-06-08

---

## Context

PSL has a fixed set of top-level block keywords (`model`, `type`, `types`, `namespace`, `enum`). Extensions that want to introduce new top-level constructs — Postgres RLS policies, roles, views — had no mechanism to do so. Every new construct required a core change, which conflicts with the thin-core, fat-targets principle (see [ADR 005](ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)).

## Problem

- PSL syntax is closed to extension; packs can only decorate core entities via attributes.
- An earlier implementation (PR #718) gave each extension an imperative `parseFn` / `validateFn` / `emitFn` triple. That approach re-implements parsing the framework already does, is opaque to inspection and analysis, and forces defensive machinery to handle arbitrary extension-supplied code paths.
- PSL's grammar is closed and uniform: a top-level block is a keyword + name + body of `x = y` assignments and double-quoted values. The framework already handles all of that for built-in block types. Contributed parser functions that re-implement a subset of that are unnecessary.

## Decision

An extension registers an **`AuthoringPslBlockDescriptor`** — a data descriptor, not code — for each top-level keyword it contributes. The descriptor declares: the keyword, a `discriminator` string, whether the block has a name, and a `parameters` map of typed value-kind descriptors.

The framework owns **one generic parser, one generic validator, and one generic printer** that interpret any declared block from its descriptor. No parsing or printing code runs from the extension.

```ts
import type { AuthoringPslBlockDescriptor } from '@prisma-next/framework-components/authoring';

const policySelectDescriptor: AuthoringPslBlockDescriptor = {
  kind: 'pslBlock',
  keyword: 'policy_select',
  discriminator: 'postgres-policy-select',
  name: { required: true },
  parameters: {
    target: { kind: 'ref',    refKind: 'model',             scope: 'same-namespace', required: true },
    as:     { kind: 'option', values: ['permissive', 'restrictive'],                 required: false },
    roles:  { kind: 'list',   of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },           required: false },
    using:  { kind: 'value',  codecId: 'String',                                     required: true },
  },
};
```

The descriptor is registered on `AuthoringContributions.pslBlockDescriptors`. Each descriptor must have a matching `AuthoringContributions.entityTypes` factory with the same discriminator — the parsed AST node lowers to an IR class instance through that factory.

## Details

### Parameter value-kind vocabulary

Four kinds; the split is principled, not incidental:

| Kind | What it is | Backing machinery |
|---|---|---|
| **`ref`** | an identifier that resolves to a declared entity | resolved against the `(spaceId, namespaceId, entityKind, entityName)` coordinate model; `scope` ∈ `same-namespace` / `same-space` / `cross-space` |
| **`value`** | a codec-typed value — the codec owns PSL parse and print | the existing codec/type system, same as field types and `@default` literals; opaque content (SQL predicates, JSON blobs) stays opaque to the framework |
| **`option`** | one of a fixed set of literal tokens | an inline closed token list on the descriptor — authoring-time constraint only; not a codec, not persisted data, not a domain enum |
| **`list`** | a bracketed list of any of the above | combinator |

### `value` rides the codec JSON medium

A `value` parameter uses a `codecId`, exactly as a field's type and a `@default` literal's type do. The codec's `encodeJson` / `decodeJson` hooks (combined with `JSON.parse` / `JSON.stringify`) carry the value through the PSL text ↔ literal ↔ encoded form pipeline. This gives structural parity across the three places PSL carries a typed value (field types, defaults, block parameters) and makes custom types available as parameter values with no additional work.

### `option` is not a domain enum

`as = permissive` is configuration of the policy node, not user data. It is never realised as a stored value-set or check constraint. Modelling it as an enum would couple it to the enums-as-domain machinery (see [PR #748](https://github.com/prisma/prisma-next/pull/748)); it stays a lightweight inline authoring constraint.

### Per-block-kind schemas, no conditional logic

Where a parameter's validity depends on context, the answer is separate block keywords with fixed parameter sets — not conditional rules inside a descriptor. Postgres RLS uses `policy_select` / `policy_insert` / `policy_update` / `policy_delete` rather than one `policy` block with an `operation` parameter. The command is encoded in the keyword; an invalid parameter combination is structurally impossible.

### Framework behaviour at parse time

On encountering an unknown top-level keyword, the framework looks it up in the `pslBlockDescriptors` registry. If a descriptor claims the keyword, the generic parser reads the block into a `PslExtensionBlock` node — name plus a `parameters` map of `PslExtensionBlockParamValue` values keyed by parameter name. No extension code runs.

The validator then checks (at load/parse time, with spans):
- unknown parameters (keys not in the descriptor's `parameters` map)
- missing required parameters
- `option` value outside the declared `values` array
- `value` text rejected by the codec's `decodeJson` / `JSON.parse`
- `ref` identifier that does not resolve within the declared scope

The printer reconstructs any declared block from its descriptor + AST node.

### The parsed node lowers to IR

The `PslExtensionBlock` node lowers to a Contract IR class instance via the matching `entityTypes` factory, keyed by the shared `discriminator`. Every extension-contributed PSL block requires a matching factory; the framework enforces this at load time (`assertPslBlocksHaveFactories`).

### Load-time validation

Duplicate keywords, duplicate discriminators, a block registered without a matching `entityTypes` factory, and malformed descriptors all fail at load time with clear diagnostics naming the contributing extension.

### Parsed extension blocks in the AST

Parsed extension blocks are stored in `PslNamespace.entries[discriminator][name]` — the same ADR 224 coordinate structure the IR uses. The built-in accessor helpers (`models`, `enums`, `compositeTypes`) derive from `entries`; extension kinds are reached via `entries[discriminator]` or the `namespacePslExtensionBlocks` helper.

## Consequences

- The extension ships zero parse/print code. A descriptor that correctly declares its parameters is fully parseable, validatable, printable, and round-trippable without any additional implementation.
- The framework's single generic parser/validator/printer handles all declared blocks. New block shapes are additive: a new `parameters` entry with a new kind cannot break existing blocks.
- Extensibility at the PSL layer aligns with the IR: the three architectural layers (IR class, lowering factory, PSL parse/print) are all addressed by the shared `discriminator`. See [ADR 225 — Three-layer extensibility for pack-contributed entity kinds](ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md).
- Descriptors are inspectable data: they can be validated, documented, and reasoned about without executing extension code.

## References

- [ADR 005 — Thin Core Fat Targets](ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 104 — PSL extension namespacing & syntax](ADR%20104%20-%20PSL%20extension%20namespacing%20%26%20syntax.md)
- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- [ADR 224 — Namespace concretions address entities by coordinate](ADR%20224%20-%20Namespace%20concretions%20address%20entities%20by%20coordinate.md)
- [ADR 225 — Three-layer extensibility for pack-contributed entity kinds](ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md)
