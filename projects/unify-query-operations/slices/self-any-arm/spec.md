# Slice: self-any-arm

_Parent project: [`projects/unify-query-operations/`](../../). This slice is foundation work for the project's FR5 and AC6 — adding the third `{ any: true }` arm to `SelfSpec` so a later slice can register `isNull` / `isNotNull` as operations reachable on every codec regardless of its declared traits._

## At a glance

Extend the operation registry's `SelfSpec` discriminated union with a third arm — `{ readonly any: true }` — meaning *"this operation applies to every codec, regardless of trait set."* This is purely structural: no operation registers with the new arm yet, no user-visible authoring surface changes, the SQL family registry doesn't exist yet. The slice is done when (a) every consumer that switches on the existing `codecId | traits` discrimination handles the third arm, (b) the registration validator accepts `{ any: true }` and rejects ambiguous combinations, and (c) the type-level dispatch matcher `OpMatchesField` returns `true` for any field codec when `self.any === true`.

The motivation is that the project's later slices need to express *"this operation reaches every codec column"* for `isNull` / `isNotNull` — operations that today live in `COMPARISON_METHODS_META` with `traits: []` (meaning "no trait required"). The current `SelfSpec` cannot express that intent — a registered `traits: []` is rejected by the validator at `index.ts:44-46` precisely because an empty traits array is indistinguishable from a missing one. Rather than overloading `traits: []`, we add an explicit arm that says what we mean.

## Scope

### In scope

- `packages/1-framework/1-core/operations/src/index.ts` — add the `{ readonly any: true }` arm to `SelfSpec`; extend the registration validator at `createOperationRegistry` (lines 42-50) so exactly one of `codecId`, `traits`, `any` must be set when `self` is present.
- `packages/2-sql/1-core/contract/src/types.ts` — add the matching `{ readonly any: true }` arm to the public-export `QueryOperationSelfSpec` (lines 99-101). This keeps the contract-emitted type in sync with the runtime type. (See § Contract impact.)
- `packages/3-extensions/sql-orm-client/src/model-accessor.ts` — extend the `self` resolution loop (lines 71-85) with a branch that, when `self.any === true`, indexes the op under every codec known to `context.codecDescriptors`.
- `packages/3-extensions/sql-orm-client/src/types.ts` — extend the type-level `OpMatchesField` matcher (lines 234-248) with a clause that returns `true` when `Self extends { readonly any: true }`, regardless of the field's codec id.
- `packages/1-framework/1-core/operations/test/operations-registry.test.ts` — add registration-validator tests covering: (a) `self: { any: true }` accepted, (b) `self: { any: true, codecId: '...' }` rejected, (c) `self: { any: true, traits: [...] }` rejected. The existing tests for the two prior arms must still pass unchanged.

### Out of scope (this slice)

- Registering any built-in operation (`isNull`, `isNotNull`, or otherwise) with the new arm. That is slice 2's work (`family-ops-factory`).
- Removing `COMPARISON_METHODS_META`. That is slice 3's work (`collapse-consumers`).
- The SQL family `queryOperations()` factory itself. Slice 2.
- ORM ordering registry. Slice 3.
- Any change to the contract emitter, the sql-builder's `Functions<QC>` derivation, or the `fns` Proxy. Later slices.
- Any change to existing operations' `self` declarations (cipherstash, pgvector, etc.). They remain `{ codecId }` / `{ traits }` as authored — purely additive.

## Approach

The change is a discriminated-union extension in two parallel type definitions plus three consumer-site updates. Both type definitions live in different packages by layering convention but represent the same concept — runtime registration vs contract emission — and must stay in lock-step.

**1. Type extension.** `SelfSpec` in `packages/1-framework/1-core/operations/src/index.ts:12-14` and `QueryOperationSelfSpec` in `packages/2-sql/1-core/contract/src/types.ts:99-101` each gain a third arm using the same mutual-exclusion pattern the existing two arms use (the `?: never` cross-clauses):

```ts
// Illustrative — final placement / formatting is the implementer's call.
export type SelfSpec =
  | { readonly codecId: string; readonly traits?: never; readonly any?: never }
  | { readonly traits: readonly string[]; readonly codecId?: never; readonly any?: never }
  | { readonly any: true; readonly codecId?: never; readonly traits?: never };
```

Using `any: true` (rather than `any: boolean`) keeps "the field is set" and "the field is `true`" identical at the type level — there is no meaningful `any: false`.

**2. Runtime validator.** `createOperationRegistry` at `packages/1-framework/1-core/operations/src/index.ts:42-50` today computes `hasCodecId` + `hasTraits` and rejects neither/both. Extend with `hasAny`, then enforce "exactly one of the three is set." The error messages should be precise — at least three messages: "self has none of codecId/traits/any," "self combines codecId and traits," "self combines any with codecId or traits."

**3. ORM model accessor resolution loop.** `packages/3-extensions/sql-orm-client/src/model-accessor.ts:71-85` walks every registered operation and indexes it under the codecs it applies to. Today: `self.codecId` indexes under one codec; `self.traits` indexes under every codec whose descriptor's `traits` set contains every required trait. Extend with a third branch: `self.any === true` indexes the op under every codec known to `context.codecDescriptors` (the same iteration the trait branch already uses, but without the trait filter):

```ts
// Illustrative — at the same indent as the existing two branches.
} else if (self.any === true) {
  for (const descriptor of context.codecDescriptors.values()) {
    registerOp(descriptor.codecId, op);
  }
}
```

**4. Type-level matcher `OpMatchesField`.** `packages/3-extensions/sql-orm-client/src/types.ts:234-248` is a conditional-type chain that returns `true` when the field's codec matches the operation's `self`. Extend the chain with an `any`-first clause: if `Self extends { readonly any: true }` return `true` immediately (any field codec matches). Place the `any` clause first because it is the most permissive — the order doesn't affect correctness for well-formed `SelfSpec` (the discriminated union ensures exactly one arm matches), but reading it first matches the documentation intent.

**5. Tests.** Mirror the existing three validator tests in `operations-registry.test.ts:51-84` for the new arm: one positive case (`{ any: true }` accepted), two negative cases (`{ any: true, codecId: ... }` rejected; `{ any: true, traits: [...] }` rejected). The existing `// @ts-expect-error` pattern carries over for the negative cases, since the discriminated-union constraint makes them ill-formed at compile time as well as at runtime. No new type-level test files are added in this slice — `pnpm typecheck` of the existing consumers covers the structural extension.

The slice is structurally additive: existing call sites that pass `{ codecId: ... }` or `{ traits: [...] }` keep working unchanged. The only call sites that need new code are the four sites named above, all of which switch on the discriminant and need a third branch.

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| `self: { any: true }` registered, no `codecId` / `traits` | Handle | Validator accepts; resolution loop indexes the op under every codec in `context.codecDescriptors`; `OpMatchesField` returns `true` for any field. Positive registration test + a runtime test that the op appears on every column. |
| `self: { any: true, codecId: 'pg/text@1' }` | Handle | Validator rejects with "self combines any with codecId or traits." TypeScript should also reject at compile time via the `?: never` cross-clauses; `@ts-expect-error` in the negative test. |
| `self: { any: true, traits: ['equality'] }` | Handle | Same as above with `traits` instead of `codecId`. |
| `self: { any: false }` | Explicitly out | `any` is typed `true`, not `boolean`. The validator never sees `any: false` because TypeScript rejects it. If runtime JSON hydration ever produced `{ any: false }`, the validator's "exactly one of three must be set" check would reject it as "none of codecId/traits/any set" — but no JSON hydration path currently produces `SelfSpec`, so this is theoretical. No runtime branch added for it. |
| `self: {}` (no codecId, no traits, no any) | Handle | Validator continues to throw "self has none of codecId/traits/any." Existing test at `operations-registry.test.ts:51-61` covers the prior shape; updated error message; the test message string updates accordingly. |
| `self: { traits: [] }` (empty traits array) | Handle | Existing rejection at `index.ts:44` (`hasTraits = ... && traits.length > 0`) stays in place — the current test at lines 63-72 already covers this. Empty `traits` is not promoted to `any: true`; that would be a silent semantic change. The caller must explicitly choose. |
| `self` omitted entirely (operation has no `self`) | Explicitly out | Existing behaviour: `self?` is optional; operations without `self` are sql-builder-only and not surfaced as column methods. Unchanged by this slice. Existing test at `operations-registry.test.ts:99-107` covers this. |
| Type-level consumer that switches on `codecId | traits` today | Handle | The only one inside this slice's blast radius is `OpMatchesField` itself (extended in scope). External extension type definitions (cipherstash's `QueryOperationTypes`, pgvector's equivalent) only **author** `SelfSpec` shapes — they don't pattern-match on the discriminant. The grep at `packages/3-extensions/cipherstash/src/types/operation-types.ts:62` is a documentation comment that references `QueryOperationSelfSpec` but doesn't switch on it — no edit needed. |
| Runtime consumer that switches on `self.codecId` / `self.traits` today | Handle | The only one is the resolution loop at `model-accessor.ts:71-85` (extended in scope). Confirmed via `rg 'self\.codecId\|self\.traits' packages/`. |
| `OpMatchesField` ordering: `any` first vs last in the conditional chain | Handle | Place `any: true` first because it is the most permissive and documents intent. Functional correctness does not depend on ordering — the discriminated union guarantees at most one arm matches well-formed input. A test or comment should record the intent so a later maintainer doesn't reorder it for "consistency" with the runtime branch order. |
| Reflective consumer (debug printer / serializer) that doesn't know about `any` | Defer | No such consumer found in the codebase (`rg` confirms). If one surfaces during slice 2 / 3, treat as a discovered-edge-case stop-condition per project I12, route to `drive-discussion`. |
| Naming: `any: true` vs `applyToAll: true` vs `universal: true` | Handle | `any` chosen to match the cardinality vocabulary already used elsewhere in the project (`any: true` reads as "any codec"). The field is on a type named `SelfSpec`, so the noun is clear. If review pushes back, naming can change without affecting the structural plan. |
| Validator error message wording | Handle | Three distinct messages, all matching the existing tone ("Operation \"<name>\" self ..."): (a) `"self has none of codecId, traits, or any"` for the empty case (replaces the existing `"self has neither codecId nor traits"`), (b) `"self combines codecId and traits"` for the existing both-set case (rewording the existing message), (c) `"self combines any with codecId or traits"` for the new ambiguous case. Existing tests' expected-message strings update in lock-step. |

## Contract impact

**Affected contract-surface types.** `QueryOperationSelfSpec` at `packages/2-sql/1-core/contract/src/types.ts:99-101` is publicly re-exported from `@prisma-next/sql-contract/types` (`packages/2-sql/1-core/contract/src/exports/types.ts:18`). The contract emitter (not modified in this slice) already lifts `QueryOperationTypeEntry` into the generated `contract.d.ts` via the `types.queryOperationTypes` slot, so the new arm flows through to every downstream consumer at the type level.

**Migration plan for downstream consumers.** Purely additive. No downstream consumer pattern-matches on the discriminant; the new arm widens the type without invalidating existing entries. Verified via `rg 'QueryOperationSelfSpec' packages/` — three hits total: the type definition, the re-export, and a single documentation comment in cipherstash (`packages/3-extensions/cipherstash/src/types/operation-types.ts:62`) that references the type's name but does not switch on it. No `@prisma-next/*` extension authors `self: { any: true }` after this slice; the new arm becomes consumable when slice 2 registers `isNull` / `isNotNull` with it.

## Adapter impact

N/A. No adapter (`packages/3-targets/**`) code is touched. The slice's runtime changes are confined to `@prisma-next/operations` (the registry primitive) and `@prisma-next/sql-orm-client` (the one consumer that switches on the discriminant). Verified via `rg 'self\.codecId\|self\.traits' packages/3-targets/` — zero hits.

## ADR pointer

The project's slice 5 (`adr-close-out`) commits to drafting a new ADR ("ADR NNN — Unified SQL-family operation registry") that records the unified-registry decision and explicitly supersedes the carve-outs in ADR 203 and ADR 206. The new `{ any: true }` arm is part of the decision the close-out ADR documents; this slice does not draft a separate ADR. If review surfaces an architectural question this slice should answer in its own ADR rather than defer to the close-out ADR, the spec amends via `drive-discussion`.

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass: `pnpm typecheck` green workspace-wide; `pnpm test:packages` green for `@prisma-next/operations` and `@prisma-next/sql-orm-client`; `pnpm lint:deps` green; intent-validation confirms the diff matches the brief (no scope creep into slice-2 / slice-3 territory).
- [ ] **SDoD2.** Every pre-named edge case handled per its disposition.
- [ ] **SDoD3.** Reviewer verdict: accept on `projects/unify-query-operations/reviews/code-review.md`.
- [ ] **SDoD4.** Manual-QA script: **N/A — no user-observable change.** The slice extends an internal type and validator; no `model.field.xxx()` surface appears or disappears; no error message a user could see changes (the validator's new error messages are framework-author-facing, not end-user-facing). Slice 2 is the first slice in this project that surfaces user-observable change; manual-QA discipline picks up there.
- [ ] **SDoD5.** Slice doesn't touch surfaces listed as out-of-scope. Specifically: no operation registers with `self: { any: true }` in this slice (slice 2's job); `COMPARISON_METHODS_META` and `BuiltinFunctions<CT>` remain in place; no SQL family `queryOperations()` factory shipped.
- [ ] **SDoD6.** `QueryOperationSelfSpec` (`packages/2-sql/1-core/contract/src/types.ts`) and `SelfSpec` (`packages/1-framework/1-core/operations/src/index.ts`) carry semantically identical arms in the same order; a deliberate convention comment on at least one of them references the other so a future maintainer doesn't drift them.
- [ ] **SDoD7.** `OpMatchesField` (`packages/3-extensions/sql-orm-client/src/types.ts`) returns `true` for the `any: true` arm against any field codec. A `pnpm typecheck` test on the existing model-accessor surface confirms no regression for existing trait-targeted / codec-id-targeted entries.

## Open Questions

1. **Naming: `any: true` vs alternative wording.** Working position: `any: true`, as drafted in the approach. The name is short, reads as "applies to any codec," and matches the field's intent. Alternatives considered: `applyToAll`, `universal`, `everyCodec`. None reads better; if review pushes back, naming can change without affecting structural scope. Resolved at slice-plan time or earlier.
2. **Should the validator's error message for the empty-`self` case mention the new arm?** Working position: yes — the message becomes `"self has none of codecId, traits, or any"`. The trade-off: a longer message vs. an accurate one. Accuracy wins; the existing test's expected-message string updates in lock-step.
3. **Should the type-level `OpMatchesField` clause for `any: true` go first or last in the conditional chain?** Working position: first, as drafted. Reasoning is documentation-of-intent — `any: true` is "the most permissive case, handled before the codec/trait narrowing." Functional behaviour identical either way given the discriminated union's mutual exclusion. Resolved during implementation if a clearer ordering surfaces.
4. **Does extending `QueryOperationSelfSpec` (public contract surface) belong in this slice or slice 2?** Working position: this slice. Reasoning: keeping the runtime type (`SelfSpec`) and the contract-emitted type (`QueryOperationSelfSpec`) in lock-step is structural — splitting the extension across slices means slice 1 ships a runtime type that the contract type can't represent, which is a half-finished surface (forbidden by project conventions). The change to `QueryOperationSelfSpec` is purely additive and risk-free (no downstream consumer switches on the discriminant), so the lock-step extension is cheap. Resolved here unless slice plan surfaces a reason to split.

## References

- Parent project: [`projects/unify-query-operations/spec.md`](../../spec.md) — FR5 (the new arm definition), AC6 (the project-level acceptance criterion this slice partially satisfies).
- Parent project plan: [`projects/unify-query-operations/plan.md`](../../plan.md) § Slice `self-any-arm`.
- Linear issue: TML-2354 (project-level tracking issue; no per-slice sub-issue per project plan). Slice PR title carries `tml-2354:` prefix.
- Calibration: failure modes [F2](../../../../drive/calibration/failure-modes.md#f2-constructor-magic-for-optional-fields) (avoid optional `any?: boolean` — use required `any: true`), [F3](../../../../drive/calibration/failure-modes.md#f3-discovery-via-test-suite-instead-of-grep) (consumer discovery already done via `rg`; no test-suite-as-discovery loop expected). Grep library: `: any\b|\bany\[\]` is a forbidden-`any` check unrelated to this slice's `any: true` field name; `pnpm lint:deps` separately confirms.
- Codebase touchpoints (anchors for the slice plan):
  - `packages/1-framework/1-core/operations/src/index.ts:12-14` (`SelfSpec`)
  - `packages/1-framework/1-core/operations/src/index.ts:42-50` (validator)
  - `packages/1-framework/1-core/operations/test/operations-registry.test.ts:51-107` (existing validator tests)
  - `packages/2-sql/1-core/contract/src/types.ts:99-101` (`QueryOperationSelfSpec`)
  - `packages/3-extensions/sql-orm-client/src/model-accessor.ts:71-85` (resolution loop)
  - `packages/3-extensions/sql-orm-client/src/types.ts:234-248` (`OpMatchesField`)
