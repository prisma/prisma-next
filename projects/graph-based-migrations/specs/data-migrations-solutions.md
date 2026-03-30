# Data migrations (solutions): compatibility, routing, and UX

## Table of contents

- 1. Why this document exists
- 2. Compatibility: when is it safe to run a data migration?
  - 2.1 Contract-based compatibility via schema-verify
  - 2.2 Explicit schema requirements (preferred)
  - 2.3 Typed query interfaces (derived from compatible schema)
- 3. Who owns required invariants (source of truth)
  - 3.1 Recommended: store invariants alongside the environment ref head
  - 3.2 Promotion workflow (how refs get updated)
- 4. Two integration models
  - 4.1 Model A: co-located with schema migrations (packages contribute invariants)
  - 4.2 Model B: independent data migrations (applied when schema allows)
- 5. How routing changes when invariants exist
  - 5.1 Priority and equivalence when multiple routes exist
  - 5.2 Fail-closed cases and diagnostics
- 6. Pure data migrations (no schema change)
- 7. UX: what plan/apply/status should explain
- 8. Optional follow-up: a ledger (optimization only)
- 9. Conclusion and open decisions

---

## 1. Why this document exists

[data-migrations.md](./data-migrations.md) describes the *goal*: model data transformations as guarded transitions and define desired end state as “contract hash + required invariants”.

This document focuses on *how we could implement that goal* without muddying the theory:

- how to decide whether a data migration can run (compatibility),
- how to integrate data migrations with structural routing,
- what the CLI must explain,
- and what we still need to decide as a team.

## 2. Compatibility: when is it safe to run a data migration?

Data migrations must be able to query/update safely. That means they need the schema they expect.

### 2.1 Contract-based compatibility via schema-verify

If a data migration has access to a full contract (not just a hash), we can use the existing schema-verify operation to ask:

> “Is the current database schema compatible with this contract?”

This turns “schema is a superset of what I need” into a concrete, checkable property.

### 2.2 Explicit schema requirements (preferred)

Even if a contract is available, it is usually better practice for a data migration to declare explicit requirements:

- required tables/columns/types/constraints
- required capabilities
- required indexes (for performance)

This avoids relying on “match contract C” as an all-or-nothing proxy, and it keeps migrations auditable.

### 2.3 Typed query interfaces (derived from compatible schema)

Once we have a compatibility check, the runner can provide a typed query interface derived from the contract/schema used for compatibility.
This keeps authoring safe (you can’t write queries against columns that don’t exist).

## 3. Who owns required invariants (source of truth)

The theory assumes we can say: “to be done, invariants {I1, I2, …} must hold”.

We need an explicit owner for that set.

### 3.1 Recommended: store invariants alongside the environment ref head

A clean model is to treat the environment’s ref head as the declaration of desired state:

- the ref already answers “what contract state should production/staging be at?”
- and it can also answer “what invariants must hold in that environment?”

This keeps invariants out of contract hashing and makes promotions explicit and reviewable.

It also keeps ownership consistent: the same thing that says “prod should be at contract hash H” also says “prod requires invariants {I}”.

### 3.2 Promotion workflow (how refs get updated)

A concrete workflow that fits this model:

1. On a topic branch, a developer changes the contract and plans migrations starting from the current environment ref (e.g. production head).
2. They update the environment ref to say: “move from X → Y” and (optionally) “require invariant Z”.
3. They run apply locally against a representative database to validate behavior.
4. They commit the planned migrations, updated contract artifacts, and the updated ref.
5. CI gates the ref update with the same tooling/safety checks we provide.
6. Promotion becomes an explicit second step:
   - staging ref can move first, then production ref later, or
   - an automated pipeline step can fast-forward production ref to whatever staging ref currently declares.

Alternative ownership models (still possible, but less aligned with the ref workflow):

- **Alongside the contract** (e.g. a `data-invariants.json` next to contract output)
- **Inside the contract** (more cohesive, but complicates hashing and contract evolution)
- **Environment policy** (prod vs staging vs dev can require different invariants)

We don’t need to decide this to explore models A/B, but we do need it for CLI semantics (“up to date”).

## 4. Two integration models

### 4.1 Model A: co-located with schema migrations (packages contribute invariants)

In this model, a single migration package can contain:

- structural operations that move contract A → B
- data operations that establish invariant(s) I

The effective destination becomes: “contract B with invariants I satisfied”.

When multiple A→B packages exist, route choice can’t treat them as interchangeable; it must choose a package/path that establishes the required invariants.

### 4.2 Model B: independent data migrations (applied when schema allows)

In this model, data migrations are independent of structural transitions.

The runner:

1. routes schema markerHash → targetHash
2. applies data migrations as soon as their schema requirements are met
3. continues until:
  - target hash is reached, and
  - required invariants are satisfied

This avoids baking “priority” into the structural routing layer; invariants are enforced by the invariant layer.

## 5. How routing changes when invariants exist

### 5.1 Priority and equivalence when multiple routes exist

Once invariants matter, “shortest path” cannot mean only “fewest structural steps”.

A reasonable policy is:

- **first**: choose a route that can satisfy required invariants
- **then**: minimize steps / risk / time
- **then**: deterministic tie-break

This is also where teams feel the pull of golden history (“just pick the latest”), so the CLI needs to make the policy explicit.

### 5.2 Fail-closed cases and diagnostics

Apply should fail closed (with clear diagnostics) when:

- a required invariant has no provider migration
- a provider exists but its schema requirements are not satisfiable on any reachable schema route
- there are multiple possible ways to satisfy invariants but they are not provably equivalent and no selection was provided

## 6. Pure data migrations (no schema change)

Pure data migrations are naturally expressed as “invariant enforcers”:

- they don’t move the contract hash
- they become relevant when the desired state (or policy) requires their invariant

In a hash-only router, A→A would never be selected; the invariant model makes them first-class.

## 7. UX: what plan/apply/status should explain

The CLI needs to communicate both dimensions of state:

- **schema**: current marker hash, desired hash, chosen route of structural migrations
- **data**: required invariants, which currently hold, and which migrations will establish the rest

The core reframing for teams used to golden history is:

> We show “what must be true”, not “what number you are in a global sequence”.

## 8. Optional follow-up: a ledger (optimization only)

Repeatedly checking invariants can be expensive.

We can add a minimal ledger to:

- avoid repeated checks
- improve auditability and debugging

But the semantic model should not depend on it:

- correctness comes from pre/postcondition checks
- the ledger is an optimization and a diagnostic surface

## 9. Conclusion and open decisions

We can preserve routing-first semantics with data migrations if we treat “done” as:

- target contract hash reached, and
- required invariants satisfied

Open decisions:

- What is the concrete format/location of environment refs, and who updates them (human vs CI/CD automation)?
- Do we want Model A, Model B, or both (with a clear preference)?
- What is the default routing policy when multiple invariant-satisfying routes exist?
