# Data migrations (theory): invariants and desired state

## Table of contents

- 1. Why this document exists
- 2. The problem (in plain language)
- 3. The core idea: data migrations are guarded transitions
- 4. What “invariant” means (and why it’s the right abstraction)
- 5. The desired end state: contract hash + required data invariants
- 6. Constraints a data migration must respect
- 7. Where to go next (solutions doc)
- 8. Conclusion

## 1. Why this document exists

Our migration history discussion intentionally focuses on structural state: “reach contract hash H”.

Data migrations complicate that, because they introduce a second notion of state that is not captured by a contract hash: **the content of the database**.

This document records the current design direction for data migrations in a way that:

- keeps the structural routing model ergonomic in the simple case, and
- makes data correctness explicit and machine-checkable when it matters.

## 2. The problem (in plain language)

If migrations are purely structural, then “database state” is mostly “schema state”, and contract hashes do a good job describing it.

Once you start performing non-trivial data transformations, two databases can have:

- the same schema / contract hash, but
- meaningfully different content.

In that world, “schema state == desired” does not imply “data state == desired”.

This is exactly why teams slip back into “golden history” thinking: a single linear history is a crude way of saying “we know these data transformations happened”.

We want a model that says that directly.

## 3. The core idea: data migrations are guarded transitions

We treat a data migration the same way we treat a structural migration:

- it is a transition guarded by a **precondition** and a **postcondition**,
- and it is safe to retry because completion is observable.

Concretely:

- **Precondition**: the database is in a data state where applying the migration makes sense (often “needs change”).
- **Execution**: statements/steps that move data toward the desired shape.
- **Postcondition**: a check that proves “done”.

If the postcondition already holds, the migration is a no-op — that’s the idempotence story.

## 4. What “invariant” means (and why it’s the right abstraction)

In this document, a **data invariant** is:

- a named property we want to be true (e.g. “all user phone numbers normalized”), and
- a checkable predicate that can confirm whether it holds.

This is a better abstraction than “did we run migration X?” because:

- it is verifiable,
- it is composable,
- and it decouples correctness from a single canonical history.

## 5. The desired end state: contract hash + required data invariants

In a world with data migrations, “desired state” is not just a contract hash.

It is:

- **target contract hash** (structural state), plus
- **required data invariants** (data state).

In practice, this “desired state” needs an owner. A clean model is to treat the environment’s **ref head** as the declaration of desired state:

- the ref already answers “what contract state should production/staging be at?”
- and it can also answer “what data invariants must hold in that environment?”

That makes promotions explicit and reviewable: a ref update can say “move production from X → Y, and require invariant Z to hold”.

This solves a major failure mode of schema-only routing:

- a database can be structurally “up to date” while still missing required data correctness properties.

## 6. Constraints a data migration must respect

The theory above is only useful if the system can apply data migrations safely. That implies a few constraints:

- **Guarded**: the migration must have a “done-ness” check (postcondition) so retries and partial failure are safe.
- **Selective / idempotent**: running the migration twice should either do nothing the second time or only touch rows that still need it.
- **Schema-aware**: the migration must only run when the database schema supports the queries it needs (more on this in the solutions doc).

## 7. Where to go next (solutions doc)

This document intentionally stops at “what we’re trying to model”.

For concrete solution options (compatibility checks, how to integrate with routing, UX implications, and an optional ledger optimization), see:

- [data-migrations-solutions.md](./data-migrations-solutions.md)

## 8. Conclusion

Data migrations are easiest to reason about when we treat them as **guarded transitions** whose completion is defined by **data invariants**.

That leads to a crisp statement of desired end state:

- reach the target **contract hash**, and
- satisfy the required **data invariants**.

A practical ownership model is that environment refs own this declaration of “done”: schema target + required invariants.

