# Slice: psl-authoring

_Parent project: [`projects/control-policy/`](../../spec.md). Outcome it contributes: the project-DoD condition that "the PSL authoring surface ships, **or** is explicitly deferred" — this slice ships it, closing the project's last open authoring surface and reaching PSL/TS authoring parity for both per-object control and the contract-level default._

## At a glance

PSL gains a single new model-level attribute, `@@control(<policy>)`, that lowers to the storage table's `controlPolicy` field — the IR slot slice 1 already established and slice 4 already exposed through the TS builder. The contract-level `defaultControlPolicy` does **not** get a new top-level PSL grammar; instead, it rides into the loaded contract through the contract specifier in `prisma-next.config.ts`:

```ts
// prisma-next.config.ts — PSL-authored contract
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';

export default defineConfig({
  contract: prismaContract('schema.prisma', {
    target: postgresPackRef,
    defaultControlPolicy: 'external',          // ← new
  }),
});
```

```prisma
// schema.prisma
model AuthUser {
  id String @id
  email String

  @@map("users")
  @@control(external)                          // ← new model-level attribute
}
```

Both authoring paths (PSL and TS) reach parity through the specifier change. The 80% case the project spec describes — "extension authors set `defaultControlPolicy: 'external'` once" — collapses to one keystroke at the specifier site, regardless of which authoring surface the user chose.

## Chosen design

### PSL: `@@control(<policy>)` model-level attribute

A single parameterised attribute, lowercase string-literal argument. The argument is one of `managed | tolerated | external | observed` — the same four-value framework-locked vocabulary defined by `ControlPolicy` in `@prisma-next/contract`.

```prisma
model Profile {
  id String @id
  // …
  @@control(tolerated)
}
```

**Lowering target:** `storage.namespaces[<ns>].tables[<tableName>].controlPolicy = '<policy>'` on the IR. The slot already exists (slice 1); this slice wires a new branch in the PSL → IR interpreter that reads `@@control` from `model.attributes` and writes the policy onto the storage-table entry the model already produces.

**Parser:** zero changes. `@@control(external)` reuses the existing model-attribute grammar that already accepts bare identifiers in argument position (the same shape `@relation(onDelete: Cascade)` uses today). The parser path lives at `packages/1-framework/2-authoring/psl-parser/src/parser.ts`; `model.attributes` already arrives as `PslModelAttribute[]` and the interpreter walks it per-name (see the existing `@@unique` / `@@index` branches at `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:858+`).

**Interpreter:** new `@@control` branch at the same place as `@@unique` / `@@index`. Validation:

| Authored | Diagnostic | Code |
|---|---|---|
| `@@control()` (no argument) | "`@@control` requires exactly one positional argument: `managed`, `tolerated`, `external`, or `observed`." | `PSL_INVALID_ATTRIBUTE_ARGUMENT` |
| `@@control(external, managed)` (multiple arguments) | "`@@control` accepts exactly one positional argument; got 2." | `PSL_INVALID_ATTRIBUTE_ARGUMENT` |
| `@@control(invalid)` (unknown policy) | "`@@control` argument `invalid` is not a known policy. Allowed: `managed`, `tolerated`, `external`, `observed`." | `PSL_INVALID_ATTRIBUTE_ARGUMENT` |
| `@@control(external) @@control(managed)` (duplicate) | "`@@control` declared more than once on model `<Name>`." | `PSL_DUPLICATE_ATTRIBUTE` |
| `@@control(policy: external)` (named arg) | "`@@control` does not accept named arguments; pass the policy positionally as `@@control(external)`." | `PSL_INVALID_ATTRIBUTE_ARGUMENT` |

**Case:** lowercase. PSL convention reserves PascalCase for runtime enum members (e.g. relation actions `Cascade`, `SetNull`); `ControlPolicy` is a TS string-literal union, so the literal in PSL matches the IR wire form with no case translation.

### Specifier: `defaultControlPolicy` on contract specifiers

Both `prismaContract(...)` and `typescriptContract(...)` / `typescriptContractFromPath(...)` accept an optional `defaultControlPolicy` flowing into the loaded contract:

```ts
// PSL specifier — already options-bag, just adds the field
prismaContract('schema.prisma', { target, defaultControlPolicy: 'external' });

// TS specifier (in-memory) — third positional options bag
typescriptContract(contract, 'src/contract.json', { defaultControlPolicy: 'external' });

// TS specifier (path) — third positional options bag
typescriptContractFromPath('src/contract.ts', 'src/contract.json', { defaultControlPolicy: 'external' });

// Empty contract specifier (used in the SQL family) — already options-bag
emptyContract({ target, defaultControlPolicy: 'external' });
```

The two TS specifiers grow a new third positional argument shaped as an options bag — chosen over an options-bag-as-second-arg refactor because the existing two-argument call sites (e.g. the pgvector / postgis examples and every fixture under `test/integration/test/fixtures/cli/`) keep working unchanged. Future specifier options ride in the same bag.

**Precedence:** source wins when present; specifier acts as default-of-default. Concretely: each specifier's `load(...)` function applies the policy to the loaded contract **only when the contract's `defaultControlPolicy` is `undefined`**. A TS author who sets `defineContract({ defaultControlPolicy: 'managed' })` at the source AND `typescriptContract(c, _, { defaultControlPolicy: 'external' })` at the specifier still gets `'managed'` on the loaded contract; the specifier-level value is silently overridden. (No diagnostic — both spellings are legitimate and the source-wins rule is monotone.) PSL has no source-level spelling for `defaultControlPolicy`, so for PSL contracts the specifier value is the only path and there is no conflict.

**Hash impact:** the specifier-applied default is part of the loaded contract before the contract hash is computed, so contracts where the specifier sets `defaultControlPolicy` carry that policy in their hash. The "no hash churn from introduction" guarantee from the project spec is preserved by the existing omit-when-default serialiser: a contract whose effective default is `'managed'` (the framework default) still serialises with `defaultControlPolicy` omitted, and existing fixtures hash identically.

### Round-trip

A PSL document carrying `@@control(...)` lowers to IR → serialises to JSON contract → reloads → produces an identical IR. The substrate's round-trip coverage (slice 1) already covers `controlPolicy` on storage tables across Postgres, SQLite, and Mongo's contract serialisers; this slice adds one PSL-side parity test (PSL → IR → JSON → IR) demonstrating the new attribute survives the round trip.

## Coherence rationale

PSL `@@control` and the specifier `defaultControlPolicy` arg are **the two halves of the same surface gap**: a PSL-only project today has zero way to express either per-object policy or the contract default. Splitting them into two PRs leaves PSL users in an awkward intermediate state — *some* policy works, contract-default does not — for the duration between merges, and the CLI/extension fixtures that demonstrate parity exercise both halves at once. One reviewer holds the PSL parity story (parser → interpreter → specifier wiring → round-trip test) in one sitting; the diff is rollback-able as one unit. (The TS-specifier change is a one-line addition to each of three small files; it rides naturally with the PSL work because the precedence rule and the load-time application are shared.)

## Scope

**In:**

- New PSL model-level attribute `@@control(<policy>)` in the SQL family's PSL interpreter (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`), with the five validation diagnostics above.
- `defaultControlPolicy?: ControlPolicy` field on `PrismaContractOptions` (PSL specifier) and on a new third positional options bag for `typescriptContract` / `typescriptContractFromPath` (TS in-memory + path specifiers); analogous addition to `emptyContract`'s existing options bag.
- The "source wins; specifier as default-of-default" precedence rule applied inside each specifier's `load(...)` callback.
- Round-trip parity test: PSL with `@@control(...)` → IR → JSON → IR equality, plus a fixture asserting the specifier-level default flows into the loaded contract.
- Documentation: brief PSL authoring surface entry alongside `@@index` / `@@unique` / `@@map` (in whichever README documents the PSL authoring surface today); short config reference for `defaultControlPolicy` on each specifier.

**Out:**

- Mongo PSL surface. Mongo authoring is TS-only today (no PSL family for Mongo); the specifier-arg change still needs to land for the Mongo TS specifier (`packages/2-mongo-family/2-authoring/contract-ts/src/config-types.ts`) so Mongo TS authors get parity, but no PSL grammar work for Mongo in this slice.
- Per-namespace `@@control` inheritance (e.g. `namespace auth { @@control(external) … }`). Project spec defers this; namespace policies remain v0.next.
- A new top-level `contract { … }` PSL block. The specifier-arg shape supersedes this option entirely.
- Re-litigating the four-value vocabulary or the `controlPolicy` IR field shape (slice 1 is canon).
- PSL diagnostic surface beyond the five `@@control` validations enumerated above (e.g. cross-attribute interactions, `@@map` + `@@control` interactions). The interpreter's existing per-attribute walk is independent; no cross-attribute logic lands here.
- Re-running the slice 5 e2e demonstration through the PSL surface. Slice 5's CLI integration tests already cover the project-DoD's "all four policies behave end-to-end" condition through the TS authoring surface; rerunning them through PSL is duplicate coverage. The PSL round-trip parity test is the slice-specific demonstration.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `@@control` and `@@map` on the same model | The interpreter resolves `@@map` to the storage table name first, then `@@control` lowers `controlPolicy` onto that resolved table. No special case needed; both walk `model.attributes` independently. | Cited because the existing `@@map` interaction is the obvious "did you think about this?" question; the answer is "the existing per-attribute walk handles it." |
| `@@control` on a model that maps into a target-only kind (e.g. a Postgres enum via `enum E { … } @@control(...)`) | **Out of scope for this slice.** PSL `enum` blocks lower through a different code path; `@@control` is model-level only in this slice. Target-only-kind PSL authoring is not yet a thing the PSL surface expresses (slice 4's TS authoring surface is the only path that can attach `controlPolicy` to a `PostgresEnumStorageEntry` today). | If a future slice introduces PSL spellings for target-only kinds, `@@control` extends naturally — same vocabulary, same lowering shape. |
| Specifier `defaultControlPolicy` set to `'managed'` on a contract where the source has no `defaultControlPolicy` | The specifier writes `'managed'` into the loaded contract; the omit-when-default serialiser then omits it again on emit (since `'managed'` is the framework default). Hash unchanged. | Confirms the no-hash-churn guarantee survives the new specifier path. |

## Slice-specific done conditions

- [ ] PSL → IR → JSON → IR round-trip parity test for `@@control(<policy>)` lands and asserts on at least one tolerated, one external, and one observed object (managed is the default; covered by absence). The test file lives alongside the existing PSL interpreter tests.

(CI-green + reviewer-accept + the project-DoD floor cover the rest. The integration tests slice 5 already shipped exercise the TS authoring path; they do not need to be ported to PSL.)

## Open Questions

1. **Should `@@control` ever fire a non-error diagnostic when set on the same model as `@@ignore`** (which Prisma 1–6 used as a lighter "exclude this" flag)? Working position: **no** — `@@ignore` is not a Prisma Next attribute today (the parser doesn't emit it as a recognised model attribute), so the question is moot until/unless `@@ignore` lands. If `@@ignore` arrives later, its semantics are likely a strict subset of `@@control(external)`, and the migration story belongs to that work, not this one.
2. **Should the PSL specifier validate `defaultControlPolicy` against the four-value vocabulary at config-load time, or trust the TypeScript type to enforce it?** Working position: **trust the TS type.** `defaultControlPolicy?: ControlPolicy` is a string-literal union; users who bypass the type system get an unhelpful arktype validation failure later in the load pipeline, which is the same failure mode any other invalid contract field produces. Adding a specifier-level guard duplicates work.

## References

- Parent project: `projects/control-policy/spec.md`
- Parent plan: `projects/control-policy/plan.md`
- Linear issue: [TML-2779 — `psl-authoring`](https://linear.app/prisma-company/issue/TML-2779)
- Slice 1 substrate (the IR field this slice writes into): `packages/1-framework/0-foundation/contract/src/control-policy.ts`, `packages/2-sql/1-core/contract/src/ir/storage-table.ts`
- Slice 4 surface (the parallel TS authoring path this slice mirrors): `packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts`, `packages/2-sql/2-authoring/contract-ts/src/contract-definition.ts`
- PSL interpreter call site (where the `@@control` branch lands): `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:858+` (existing `@@unique` / `@@index` walk)
- PSL specifier (where the `defaultControlPolicy` option lands): `packages/2-sql/2-authoring/contract-psl/src/provider.ts` (the `prismaContract` function)
- TS specifier (where the third positional options bag lands): `packages/2-sql/2-authoring/contract-ts/src/config-types.ts`, `packages/2-mongo-family/2-authoring/contract-ts/src/config-types.ts`
- Prior-art table that justified the parameterised-attribute shape (Prisma 1–6 `@@ignore`, Django `Meta: managed = False`, TypeORM `@Entity({ synchronize: false })` — all two-level systems using bare-flag spelling): captured in this project's design discussion, not yet promoted to an ADR.
