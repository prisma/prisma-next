# Design decision — the RLS TS authoring surface (shape + target-gating)

Status: **DECIDED — Option C** (operator, 2026-06-08). Supersedes the spec's old open-question D3.
RLS authoring is a **top-level, target-contributed helper** taking the model handle (the `enum`
mechanism), **not** a chained model-builder method. Rationale: it mirrors the PSL top-level-declaration
shape, matches the only existing Postgres-only TS affordance, and is target-gated for free — no
first-of-its-kind builder-generic machinery. The exact helper signature (per-operation helpers vs a
single array helper; how model-level enable/disable rides) is settled at slice-2 planning, leaning
toward per-operation helpers for PSL symmetry. The rejected options (A/B chained method, D
always-present) are retained below for provenance.

## The question

How does a user attach RLS policies to a model in TypeScript, such that the affordance is
**visible if-and-only-if the contract targets Postgres** (invisible for SQLite / Mongo)?

The original spec assumed `.rls([…])` as "a 4th staged-builder method on the model, alongside
`.attributes()` / `.sql()`." Investigation shows that shape carries a hidden, non-trivial cost.

## The hard finding (why this needs real design)

**Target identity does not exist on the model-builder type.** Postgres and SQLite share the *exact
same* `ContractModelBuilder` (`packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts:1141`) — it
has no `Family` and no `Target` type parameter. Family is gated only by *separate packages* (the SQL
builder vs the Mongo `ModelBuilder` in `packages/2-mongo-family/...`), which does nothing for
Postgres-vs-SQLite. The `Target` literal is known upstream in `ComposedAuthoringHelpers<Family,
Target, ExtensionPacks>` but is **thrown away** before reaching `model()` — only the merged
`IndexTypes` survives onto the builder (`composed-authoring-helpers.ts:115,149`).

Consequences:
- **There is no existing precedent for a target-gated builder method.** The present/absent method
  trick (`this:`-constraint) exists — `ref()` and `RelationBuilder.sql()` use it — but always keyed on
  model-name-ness or relation-kind, never on target.
- **`.sql()` is *not* a precedent for target-gating** — it is present on *every* SQL contract
  (family-level, not target-level).
- **The proven way Postgres adds target-specific authoring surface is a standalone helper, not a
  builder method.** `enum` is contributed via `authoring.entityTypes` and surfaces as
  `helpers.enum({…})` (`packages/3-targets/3-targets/postgres/src/core/authoring.ts:43`), present
  if-and-only-if the Postgres pack is bound. That target-gating works *for free* because helpers are
  computed from `ComposedAuthoringHelpers<…Target…>`, which still has the target. `enum` is the only
  existing Postgres-only TS authoring affordance, and it's a free function.

So: a chained `model(…).rls(…)` **method** that is Postgres-only-visible would be the *first* of its
kind and requires surfacing target (or a derived capability) onto the builder type — genuinely new
machinery. A standalone `helpers.rls(Profile, […])` **function** gets the exact gating we want for
free, via the mechanism the codebase already uses for `enum`.

## Options

| Opt | Shape | Target-gating mechanism | New machinery | Cost |
|---|---|---|---|---|
| **A** | chained `model(…).rls([…])` | add a `Target`/`TTargetId` param to `ContractModelBuilder`, thread through every chaining method, `this:`-gate `.rls()` | new builder generic + propagation through ~6 methods; widen `PackAwareModel` | **High** churn across all `ContractModelBuilder<…>` sites |
| **B** | chained `model(…).rls([…])` | revive `ExtractPackCapabilities`: add typed `capabilities:{rls}` to `TargetPackRef`/Postgres pack, thread a capabilities param onto the builder, gate on it | all of A + touch shared `TargetPackRef` type | **High+**, but extension packs could gate too; revives intended-but-dead machinery |
| **C** | standalone `helpers.rls(Profile, […])` (free function taking the model handle) | the existing `entityTypes`→`helpers.*` path; present iff Postgres pack bound | ~none on the type side (matches `enum`) | **Low**; proven pattern |
| **D** | always-present `.rls()`, late error | none — builder can't see target, so error fires later at contract assembly | — | **Rejected**: `.rls()` would show in SQLite autocomplete. This was the bad "working position." |

## Why C may be the *right* answer, not just the cheap one

1. **It matches the PSL surface.** In PSL, policies are **top-level** `policy_select {…}` blocks scoped
   to the namespace, referencing the model via `target = Profile` — they are *not* nested inside the
   model block. A chained `model(…).rls(…)` method makes the TS surface structurally *inconsistent*
   with PSL; a top-level `helpers.rls(Profile, […])` (or per-op `helpers.policySelect(Profile, {…})`)
   mirrors the PSL shape directly.
2. **It matches the one existing Postgres-only affordance** (`enum`), so the codebase stays internally
   consistent and we add no first-of-its-kind type machinery.
3. **It is target-gated correctly and for free** — the requirement Will set ("invisible off-Postgres")
   is satisfied by construction, not by new plumbing.

The model-level `rls: 'auto'|'enabled'|'disabled'` toggle is a separate, smaller question and has the
same target-visibility problem if put on `model()` config; it likely rides whatever decision we make
here (e.g. a field on the policy-helper's target, or accepted on model config with the same gating).

## Recommendation

Lean **C** (standalone target-contributed helper), reframed so policies read as top-level declarations
consistent with PSL. Pay for **A/B** only if a chained `model(…).rls(…)` method is a hard ergonomic
requirement worth being the first target-gated builder method in the codebase. **Operator decides the
shape** — this is an ergonomics + architecture call, not a mechanical one.
