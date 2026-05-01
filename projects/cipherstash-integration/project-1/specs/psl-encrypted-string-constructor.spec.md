# Summary

Register `cipherstash.EncryptedString(equality: Bool, freeTextSearch: Bool)` as a namespaced PSL constructor (same shape and machinery as `pgvector.Vector(length: Int)`) so users can author cipherstash-encrypted columns directly in PSL. Both inline-at-field-position usage and `types {}`-block named-type aliases are supported. PSL-source and TypeScript-source contracts produce byte-identical `contract.json` IR, enforced by a parity integration test.

# Description

Project 1's authoring surface ships **both** a TypeScript-contract factory (`encryptedString({ equality, freeTextSearch })`) and a PSL constructor (`cipherstash.EncryptedString(equality: true, freeTextSearch: true)`). This task spec covers the PSL side.

The constructor shape — rather than an attribute shape (`@cipherstash.encrypted(...)`) — was selected because PSL has no language-level mechanism to make legal attribute arguments depend on the field's scalar type. An attribute form would let users write `Int @cipherstash.encrypted(freeTextSearch: true)` (nonsensical) and rely on a custom cross-cutting validator to reject it. The constructor form makes the storage-type and configuration coupling explicit at the grammar level — `cipherstash.EncryptedString(...)` accepts only string-relevant search modes by definition. See the umbrella spec's design rationale for the full argument; that decision is locked.

This spec covers `EncryptedString` only. Other constructors (`EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`) are Project 2 — each lands together with its codec round-trip tests, search operator tests, and migration tests, per the umbrella's "ship only what's tested end-to-end" principle.

# Requirements

## Functional Requirements

### Constructor registration

The cipherstash extension's authoring contributions register `EncryptedString` as a namespaced constructor under the `cipherstash` namespace. Same registration shape `pgvector.Vector` uses (see `packages/3-extensions/pgvector/src/core/authoring.ts` for precedent). The constructor accepts:

- `equality: Bool` — optional, defaults to `false`. Enables the `eq` operator path.
- `freeTextSearch: Bool` — optional, defaults to `false`. Enables the `ilike` operator path.

Constructor argument schema validation rejects:

- Unknown argument names (e.g. `cipherstash.EncryptedString(orderAndRange: true)` — that mode does not apply to strings).
- Wrong types (e.g. `cipherstash.EncryptedString(equality: "yes")`).
- Positional arguments (the constructor is named-args-only — same convention as `pgvector.Vector(length: 1536)` actually uses positional, but cipherstash's two booleans benefit from named-args clarity since neither has obvious primacy).

### Inline usage

```prisma
model User {
  id        Int    @id @default(autoincrement())
  email     cipherstash.EncryptedString(equality: true, freeTextSearch: true)
  username  cipherstash.EncryptedString(equality: true)?
  notes     cipherstash.EncryptedString({})
}
```

The constructor expression appears in the field's type position (where `String` / `Int` / etc. would normally appear). Nullability (`?`) is grammatically appended after the constructor expression, same as for built-in scalars.

### Named-type-alias usage

```prisma
types {
  SearchableEmail = cipherstash.EncryptedString(equality: true, freeTextSearch: true)
  EqualityName    = cipherstash.EncryptedString(equality: true)
}

model User {
  id       Int             @id @default(autoincrement())
  email    SearchableEmail
  username EqualityName?
}
```

Named aliases work automatically once the constructor is registered — same mechanism `pgvector.Vector` aliases through (`Embedding1536 = pgvector.Vector(1536)`). No additional implementation work for the alias path.

### Lowering to `ColumnTypeDescriptor`

The PSL interpreter lowers a cipherstash constructor expression to a `ColumnTypeDescriptor` carrying:

- `codecId: 'cipherstash/string@1'`
- `nativeType: 'eql_v2_encrypted'`
- `typeParams: { equality, freeTextSearch }`
- `nullable: <derived from PSL `?`>`

The same `ColumnTypeDescriptor` shape the TS factory `encryptedString({ equality, freeTextSearch })` produces. The post-#402 `RuntimeParameterizedCodecDescriptor` (registered in [envelope-codec-extension.spec.md](envelope-codec-extension.spec.md)) validates `typeParams` at registration time using its arktype schema — the PSL interpreter doesn't re-validate beyond grammar/argument-schema checking.

### PSL→TS parity

Same parity-test convention as pgvector: a fixture directory under `test/integration/test/authoring/parity/cipherstash-encrypted-string/` containing `schema.prisma`, `contract.ts`, `expected.contract.json`, `packs.ts`. The integration test:

1. Emits `contract.json` from `schema.prisma`.
2. Emits `contract.json` from `contract.ts`.
3. Asserts both equal `expected.contract.json` byte-for-byte.

Three argument shapes covered (storage-only, equality-only, equality+freeTextSearch), with a nullable variant of each.

## Non-Functional Requirements

- **No regression in existing PSL parsing.** Adding the cipherstash namespace must not affect resolution of any other namespaced extension constructor.
- **Diagnostic quality.** Errors from invalid arguments (unknown name, wrong type) point at the offending argument's source span, not the constructor expression as a whole.
- **No new PSL grammar.** Reuses the namespaced-constructor grammar already supported for `pgvector.Vector` and shared infrastructure. If any extension to PSL grammar were required, that would be a red flag and should escalate.

## Non-goals

- **Other constructors** (`EncryptedNumber`, etc.). Project 2.
- **Attribute form** (`@cipherstash.encrypted(...)`). Explicitly rejected per umbrella design rationale.
- **Custom diagnostic messages.** Use the framework's standard PSL diagnostic templates (`PSL_INVALID_ATTRIBUTE_ARGUMENT`, `PSL_UNKNOWN_NAMESPACED_TYPE`, etc.) — no cipherstash-specific diagnostic codes in Project 1.
- **PSL-side documentation generation.** Hover-type / doc-comment integration with the constructor is out of scope; whatever the framework does for `pgvector.Vector` is what cipherstash gets.

# Acceptance Criteria

## Constructor registration

- [ ] **AC-CTOR1**: Cipherstash extension registers `EncryptedString` as a namespaced constructor under `cipherstash`. Verified via the same authoring-contributions inspection pgvector tests use.
- [ ] **AC-CTOR2**: Constructor accepts `equality: Bool` and `freeTextSearch: Bool`, both optional with default `false`.
- [ ] **AC-CTOR3**: Unknown argument names produce a `PSL_INVALID_ATTRIBUTE_ARGUMENT` (or equivalent) diagnostic pointing at the offending argument's span.
- [ ] **AC-CTOR4**: Wrong argument types (e.g. `equality: "yes"`) produce a typed diagnostic at the value's span.

## Lowering

- [ ] **AC-LOWER1**: A field declared `cipherstash.EncryptedString(equality: true, freeTextSearch: true)` lowers to a `ColumnTypeDescriptor` with `codecId: 'cipherstash/string@1'`, `nativeType: 'eql_v2_encrypted'`, `typeParams: { equality: true, freeTextSearch: true }`.
- [ ] **AC-LOWER2**: Storage-only form `cipherstash.EncryptedString({})` lowers with `typeParams: { equality: false, freeTextSearch: false }` (defaults applied).
- [ ] **AC-LOWER3**: Nullable form `cipherstash.EncryptedString(...)?` produces `nullable: true` on the `ColumnTypeDescriptor`.
- [ ] **AC-LOWER4**: `dbInit` plan against a contract with an `EncryptedString` field renders `eql_v2_encrypted` as the column's native type (verified by SQL snapshot).

## Named-type aliases

- [ ] **AC-ALIAS1**: A `types { SearchableEmail = cipherstash.EncryptedString(equality: true) }` alias resolves and is usable in subsequent model declarations.
- [ ] **AC-ALIAS2**: An alias's expansion produces the identical `ColumnTypeDescriptor` as the inline-constructor form.

## Parity with TypeScript contract

- [ ] **AC-PARITY1**: A fixture under `test/integration/test/authoring/parity/cipherstash-encrypted-string/` covers three argument shapes (`{}`, `{ equality: true }`, `{ equality: true, freeTextSearch: true }`) on both nullable and non-nullable fields.
- [ ] **AC-PARITY2**: The parity test asserts PSL-emitted `contract.json` ≡ TS-emitted `contract.json` ≡ `expected.contract.json`.

## End-to-end

- [ ] **AC-E2E1**: A contract authored entirely in PSL (per the inline example in this spec) produces a working integration test that round-trips writes + reads + decrypt against live Postgres + EQL — i.e. the umbrella's `AC-UMB1` integration test, but driven from PSL rather than TS.

# Other Considerations

## Security

PSL constructor registration is metadata-only — no runtime impact. No new security surface.

## Cost

No CI-cost impact beyond the parity test, which is on the order of a single contract-emit-and-compare assertion.

## Observability

Not applicable — authoring-time concern.

## Data Protection

Same as the underlying codec — see envelope-codec-extension spec.

# References

- [Project 1 spec](../spec.md) — design rationale for constructor-vs-attribute decision is locked there.
- [Umbrella spec](../../spec.md)
- [envelope-codec-extension task spec](envelope-codec-extension.spec.md) — registers the underlying `RuntimeParameterizedCodecDescriptor` whose `paramsSchema` this constructor's `typeParams` must satisfy.
- [pgvector authoring](../../../../packages/3-extensions/pgvector/src/core/authoring.ts) — the precedent for namespaced-constructor registration.
- [pgvector parity test](../../../../test/integration/test/authoring/parity/pgvector-named-type/) — the parity test shape this spec mirrors.
- [PSL parser README](../../../../packages/2-sql/2-authoring/contract-psl/README.md) — confirms namespaced-constructor inline + alias support.

# Open Questions

1. **Defaults.** `equality: false, freeTextSearch: false` is the obvious default. If the user writes `cipherstash.EncryptedString({})`, that's storage-only encryption. Confirm this is the right default vs requiring at least one mode flag (which would force users to write `cipherstash.EncryptedString({ equality: true })` minimum).
2. **Constructor invocation with no parens.** `cipherstash.EncryptedString` (no `(...)`) — is that legal syntax (defaults applied) or rejected? The pgvector-named-type fixture uses `pgvector.Vector(1536)` always with parens. Default: require explicit `({})` for storage-only, parallel to the TS factory's `encryptedString({})` requirement.
3. **Diagnostic for the attribute-form anti-pattern.** If a user writes `email String @cipherstash.encrypted(equality: true)` (the rejected attribute form), what error do they see? Today the cipherstash extension wouldn't register an `encrypted` attribute, so they'd see "unknown attribute `@cipherstash.encrypted`". That's accurate but not pedagogical. Default: live with the generic error in Project 1; consider a custom diagnostic that suggests the constructor form if user feedback demands it.
4. **Authoring contribution naming.** What's the canonical extension-side hook that registers a namespaced constructor? Pgvector exposes it via `pgvectorPackMeta.types.codecTypes.constructors` (or equivalent — verify against the actual `authoring.ts`). Cipherstash mirrors whatever that shape is.
