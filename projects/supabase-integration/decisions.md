# Decisions log — Supabase integration

This file is the canonical at-a-glance record of design decisions reached during the shaping phase. Each entry is a settled decision; longer rationale lives in the linked component doc.

Decisions are grouped by area. The order within each group is rough chronological order of when the decision was reached, not priority order.

When a decision changes, **update this file**. When a new design hole surfaces, capture it in [`example/design-holes.md`](example/design-holes.md) until it resolves into a decision recorded here.

---

## Contract authoring — TypeScript surface

- **A1. No RLS capability flag.** Target presence is the gate. The Postgres target's `pack` carries RLS support; pack-aware typing makes the `.rls(...)` slot visible on `ContractModelBuilder` only when targeting Postgres. Non-Postgres targets do not see the method. (See [`rls.md`](rls.md), [`example/design-holes.md` #1](example/design-holes.md).)
- **A2. `.rls(...)` is a fourth named stage on the model builder**, alongside `.attributes(...)` and `.sql(...)`. Same staged-builder shape as the existing surface. Target-gated by the pack-aware typing described in A1. ([`example/design-holes.md` #2](example/design-holes.md))
- **A3. The argument is `Array<PolicyDescriptor>` — not a dict keyed by operation.** Each descriptor carries `{ name, operation, roles, using?, withCheck?, as? }`. The earlier dict-keyed shape was rejected on the basis that it made the TS surface *more* restricted than PSL (named-block policies), inverting the typical positioning. The array form restores TS as the more expressive surface. ([`example/design-holes.md` #2](example/design-holes.md))
- **A4. Multiplicity is lenient.** Multiple permissive policies for the same `(target, operation)` are valid. Postgres ORs them; the framework emits N CREATE POLICY statements. The TS surface validates that duplicate `name` within the same model is an error; it does not validate "one per op." ([`example/design-holes.md` #2](example/design-holes.md))
- **A5. `using` and `withCheck` accept `string | ((ctx) => string)`.** The function-form's `ctx` exposes one helper: `ref(modelHandle): string`, returning the canonical quoted namespace-qualified identifier (`"public"."profile"`, `"profile"` for `__unspecified__`, `"auth"."users"` for cross-contract). Subquery predicates that use `ref()` track renames automatically; bare-column predicates stay one-line strings. The verbatim escape hatch (a raw string with hardcoded names) remains available. ([`example/design-holes.md` #5](example/design-holes.md))
- **A6. Cross-contract `onDelete: 'cascade'` is permitted with no diagnostic.** The developer's explicit `cascade` at the call site is the audit trail. The repo-wide policy at [`.agents/rules/explicit-opt-in-over-diagnostics.mdc`](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc) codifies the principle: explicit opt-ins are documentation; warnings on intentional paths are noise. ([`cross-contract-refs.md`](cross-contract-refs.md), [`example/design-holes.md` #3](example/design-holes.md))
- **A7. Composite / named uniques use `.attributes(...)`, not `.sql(...)`.** `.attributes(({ fields, constraints }) => ({ uniques: [constraints.unique([fields.x, fields.y], { name }) ] }))` is the canonical shape. Field-level `.unique({ name? })` handles single-column. No DSL extension was needed; the example app's earlier `uniqueConstraints` inside `.sql()` was wrong, not a missing feature. ([`example/design-holes.md` #4](example/design-holes.md))

## Contract authoring — PSL surface

- **B1. Policies are top-level named-block declarations:** `policy <name> { ... }`, scoped by the surrounding `namespace` block. Zero new grammar primitives — `<keyword> <ident> { body }` is existing PSL idiom. ([`rls.md`](rls.md))
- **B2. Body uses `key = value` lines** (the datasource/generator-style PSL body convention). Fields: `target = <Model>`, `operation = select|insert|update|delete|all`, `roles = [ident, ...]`, `using = "..."`, `withCheck = "..."`, `as = permissive|restrictive` (optional, default `permissive`). ([`rls.md`](rls.md))
- **B3. Multiplicity is lenient** — multiple permissive policies per `(target, operation)` are allowed when their PSL names differ. The framework emits N CREATE POLICY statements; Postgres ORs them. PSL and TS are aligned on this. ([`rls.md`](rls.md), [`example/design-holes.md` #2](example/design-holes.md))
- **B4. Cross-contract `target` is forbidden.** A policy can only attach to a model the contract owns. `target = supabase:auth.User` is a load-time error mirroring Postgres's permission model (you can't `CREATE POLICY` on a table you don't own). ([`rls.md`](rls.md))
- **B5. Predicates are verbatim strings in v0.1.** Authors type schema-qualified names matching their migrations. Renames in `target = ...` don't auto-track inside subquery predicates. Structured interpolation (`${ModelName}`, `${supabase:auth.User}`) is a **stretch goal**, not on the v0.1 critical path. ([`rls.md`](rls.md), [`example/design-holes.md` #5](example/design-holes.md))
- **B6. Namespace blocks are reopenable** (already settled in TML-2459); policies and models can live in separate PSL files within the same namespace; resolution joins them at load time. Duplicate policy names within `(namespace, target)` are a fail-fast load error. ([`rls.md`](rls.md))

## Cross-cutting

- **C1. Default policy name in PSL is not a concept** — block grammar requires a name in the head. There is no anonymous `policy { ... }` form. (Settled inline during PSL discussion; no separate doc.)
- **C2. `supabase()` shorthand dropped.** Use `supabase.pack()` for the extension pack ref and `supabase.contract<C>(json)` for the typed contract handle. The shorthand created an awkward "callable namespace" idiom inconsistent with the rest of the API. ([`extension-package.md`](extension-package.md), [`example/design-holes.md` #20](example/design-holes.md))
- **C3. Strict-vs-lenient positioning.** Across both surfaces the framework's typical stance is: **TS is the more expressive surface; PSL is the simpler restricted one.** Specific applications of this rule:
  - RLS policy multiplicity: both lenient (A4, B3) — Postgres-faithful.
  - Predicate interpolation: TS gets `ref()` in v0.1 (A5); PSL stays verbatim and gets interpolation only as a stretch (B5). This is the asymmetry the rule allows.
- **C4. Functions are not contract elements in v0.1.** The framework verifies declared contract elements; functions don't enter the contract. The four typical Supabase flows (FK to `auth.users` with cascade, server-generated UUID columns, RLS predicates using `auth.uid()` etc., column-default function invocations) map to existing mechanisms — cross-contract FK refs (A6), the framework's `DefaultFunctionRegistry`, and opaque RLS predicate strings (A5/B5). The verifier never introspects `pg_proc`. Missing functions surface as Postgres errors at migration / query time, which is acceptable.
  - The Supabase pack **may** register `auth.uid()` / `auth.jwt()` / `auth.role()` into `DefaultFunctionRegistry` if we decide to support them as column defaults (currently uncertain — flows that need it can fall back to the raw escape hatch). This is a small targeted extension of an existing mechanism; no new IR.
  - Promoting functions to first-class IR (with posture, `pg_proc` verifier checks, planner DDL) stays out of v0.1 entirely; it pairs naturally with the trigger work as a stretch. See [`posture.md`](posture.md) § "Functions are not contract elements in v0.1." Closes [`example/design-holes.md` #15](example/design-holes.md).
- **C5. Roles are first-class contract elements.** Target-only `PostgresRole` IR class, parallel to `PostgresRlsPolicy`. The Supabase pack declares the standard role set (`anon`, `authenticated`, `service_role`, plus seldom-used ones like `authenticator`) as `externally-managed`. App contracts may author their own roles in future. RLS policy `roles` fields accept **branded `RoleRef`s** — not bare strings — coming from the pre-built `/contract` builder export (e.g. `supabase.roles.anon`). PSL `roles = [authenticated]` identifiers resolve against the loaded contract aggregate (locally declared + extension-pack contributions). **Verifier introspects `pg_roles`** under posture dispatch: missing externally-managed roles fail loudly so policy creation errors don't surface only at migration time. (Replaces the earlier "typed string constants" framing.)
- **C6. Extension package entrypoints are subpath-only:** `/pack`, `/contract`, `/runtime`. Each ships only what its name implies. No catch-all `extensionName.*` umbrella on the main package. Pack metadata is value-imported (`import supabasePack from '@prisma-next/extension-supabase/pack'`), not call-style. Mirrors existing convention in `packages/3-extensions/cipherstash/` and `packages/3-extensions/pgvector/`. Tree-shaking discipline is a hard rule: `/pack` must not transitively pull in runtime code; `/contract` must not transitively pull in SDK code. **Supersedes [C2](decisions.md)** — the entire `supabase.*` umbrella goes away, not just the `supabase.pack()` shorthand.
- **C7. Emitter-generated `contract-builder.ts` is a stretch goal, not v0.1.** Extension authors hand-write the `/contract` submodule for v0.1 (the Supabase package does so directly). The emitter today produces `contract.json` + `contract.d.ts`; extending it to also produce a typed authoring builder is roadmapped but not on the critical path. Closes design hole #17 (the consumer-side mapped-type machinery I had sketched isn't needed — extensions ship concrete pre-built types). See [`example/design-holes.md` #17](example/design-holes.md).
- **C8. Introspection is the authoring mechanism for extension contracts (roadmap, not v0.1).** Introspect a live canonical database (e.g., a fresh Supabase project) → emit a contract.json marked as `externally-managed` → ship as the extension's source of truth. When upstream schemas evolve, re-introspect to refresh.
  - **Round-trip property as a test obligation:** introspect → emit → re-introspect → diff must be empty. Drift is either a real upstream schema change (refresh) or a framework IR regression that broke an extension's round-trip (fix). Either way it's the canonical signal.
  - The same pattern applies to any future extension describing an existing database (not just Supabase).
  - v0.1 ships **targeted** introspection for verifier purposes (`pg_roles` per C5, `pg_policies` per design-hole #19). Those code paths are written with the broader pattern in mind, not as one-offs. The full introspection-driven authoring pipeline is roadmapped.
  - Skill capturing the canonical extension shape (including this round-trip pattern) tracked as [TML-2492](https://linear.app/prisma-company/issue/TML-2492/skill-author-a-prisma-next-extension).

## Architectural offcuts (deserve their own treatment, not RLS-specific)

These surfaced during RLS / Supabase discussions but apply to PSL or the framework as a whole. Each will be drafted as an ADR or architecture doc when the right project pulls them in.

- **OC1. Two body-form pattern in PSL.** Two distinct body-statement forms coexist:
  - `field Type @attrs...` for *typed elements with structure* (model fields, future "members").
  - `key = value` for *instance-level static properties / configuration* (datasource, generator, `policy`, future similar declarations).

  Both can coexist in the same block where it makes sense. The pattern deserves its own ADR independent of RLS. Draft target: alongside whichever project formalises the `policy` grammar.
- **OC2. Future `policyGroup` for shared-target policies.** A `policyGroup UserPolicies { target = User; policy ... { ... } }` form that hoists shared properties was sketched. Deferred until real Supabase contracts show the repetition pain in practice. Capture as a one-line "future direction" wherever the policy grammar is specified.
- **OC3. PSL `${...}` interpolation in string literals.** Required for the structured-reference equivalent of TS's `ref(model)`. New string-literal kind in the lexer; small but real parser change. Deferred from v0.1 (B5).

## Agent / tooling process changes (separate PR)

These are not project-shape decisions but came out of the discussion. They're staged in PR [#486](https://github.com/prisma/prisma-next/pull/486) (open at time of writing) so they can land independently of the Supabase project shaping.

- **D1. Research before asking.** Drive skills (`drive-discussion`, `drive-create-spec`, `drive-create-plan`) require codebase investigation before opening discussion threads or drafting specs. The agent should not ask the user about state the codebase can answer.
- **D2. Explicit opt-in over noisy diagnostics.** Repo-wide rule at [`.agents/rules/explicit-opt-in-over-diagnostics.mdc`](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc). When a user choice has a non-obvious consequence, prefer requiring explicit opt-in at the call site over emitting a diagnostic on every build.

---

## Decisions still open

Active open work, by cluster:

- **Runtime cluster** — [`example/design-holes.md`](example/design-holes.md) #7, #8, #11, #13, #14. Middleware option / ordering / role-binding transaction model / JWT validation timing / implicit transaction for `SET LOCAL`.
- **IR cluster** — All closed.
  - #15 (Function IR) closed by C4 — functions are not v0.1 contract elements.
  - #17 (`TypedContract<T>` accessor surface) closed by C5+C6+C7 — extensions ship pre-built concrete `/contract` builders; no consumer-side mapped-type machinery needed.
- **Verifier cluster** — [`example/design-holes.md`](example/design-holes.md) #19. RLS verifier check semantics; depends on #15.

🟡 / 🟢 holes (#6, #9, #10, #12, #16, #18, #20) are default-able with working assumptions; resolve when implementation forces the question.
