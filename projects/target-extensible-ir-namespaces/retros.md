# Retro — Target-Extensible IR + Namespaces (final / close-out)

**Trigger:** mandatory final retro at project close (invariant I10).
**Scope:** the umbrella project and its gating slices (contract-ir-planes, domain-plane, public-by-default, runtime-qualification). Lessons below have each landed in a durable surface the next dispatch reads — the log itself is transient and deletes with the project folder.

## Lessons + where each landed

### 1. Naming a target in a target-agnostic package is a layer violation — branch or not

`runtime-qualification` (PR #670) first shipped target-named constants and helpers in the framework core (`POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID`, `defaultDomainNamespaceIdForSqlTarget`, plus a `targetId === 'postgres'` branch). It was rejected on review: the framework had absorbed a Postgres-specific fact. The `no-target-branches` rule existed but only illustrated the *branch* form, so the *named-constant* form slipped through.

**Landed:**
- [ADR 223 — Target-owned default namespace](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md) — a target declares its default namespace on its descriptor (`defaultNamespaceId`); target-agnostic code reads it through a uniform field.
- `.agents/rules/no-target-branches.mdc` — generalized in the close-out PR from "don't branch on target" to "don't *name* a target in target-agnostic code," with the constant/helper form as a worked example.

### 2. The default namespace is an authoring-time fact, not a runtime dependency

The rework established that runtime SQL resolution needs no per-target default at all: a single-namespace contract resolves bare names against its sole namespace; a multi-namespace contract requires explicit navigation (TML-2550, elevated out). `defaultNamespaceId` is consumed only by authoring (PSL/TS contract build), never threaded into runtime.

**Landed:** ADR 223 (runtime-vs-emitter split section).

### 3. Fail loud beats silent inference when intent is ambiguous

The first rework cut kept an `inferDefaultDomainNamespaceId` that guessed (prefer `public`, else insertion order) on multi-namespace contracts. That hid ambiguity behind a guess. Replaced with `soleDomainNamespaceId`, which returns the sole namespace when exactly one exists and throws `DomainNamespaceResolutionError` on zero or many. The optional `defaultNamespaceId` parameter that the guess had threaded through resolvers and domain helpers was deleted, removing the silent-guess surface entirely.

**Landed:** ADR 223 + the resolver/helper implementations and tests merged in PR #670.

### 4. Process: when reworking, re-sync the spec and plan in the same pass

Mid-rework, the spec and plan drifted to describe the *rejected* design while the code moved on; the divergence was only caught when the operator demanded the docs match the code. The cost of treating spec/plan as write-once is that a fresh implementer (or reviewer) reverse-engineers intent from stale prose.

**Landed:** covered by `.agents/rules/doc-maintenance.mdc` ("keep docs current"). Sharper Drive-process framing (rework dispatches own their spec/plan re-sync) surfaced to the operator at close-out rather than edited unilaterally into Drive skill internals.

### 5. Redundant casts get cargo-culted across refactors

A redundant `as Record<string, ContractModel>` cast was reintroduced in the demo during R2 and caught on review. The contract walk was already well-typed; the cast was noise copied from an earlier shape.

**Landed:** covered by the `no-bare-casts` skill; no new surface needed.

## Outcome

Project DoD met (see close-out PR for the per-criterion evidence block). The substrate (two-plane symmetric IR, target-owned default namespace, namespace-qualified runtime SQL with zero query-API breakage for single-namespace consumers) is in place for the downstream Supabase integration. `explicit-dsl` (TML-2550) was elevated out and does not gate this close-out.
