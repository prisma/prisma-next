# MongoDB in Prisma Next — Planning Index

> **Reference archive.** This directory contains detailed planning docs from the MongoDB PoC. The durable architecture documentation lives elsewhere — see links below.

## Canonical docs

- [10. MongoDB Family](../../architecture%20docs/subsystems/10.%20MongoDB%20Family.md) — subsystem doc covering contract, ORM, execution pipeline, design principles, and open questions
- [ADR 172 — Contract domain-storage separation](../../architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md)
- [ADR 173 — Polymorphism via discriminator and variants](../../architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [ADR 174 — Aggregate roots and relation strategies](../../architecture%20docs/adrs/ADR%20174%20-%20Aggregate%20roots%20and%20relation%20strategies.md)
- [ADR 175 — Shared ORM Collection interface](../../architecture%20docs/adrs/ADR%20175%20-%20Shared%20ORM%20Collection%20interface.md)
- [ADR 176 — Data migrations as invariant-guarded transitions](../../architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)
- [MongoDB user promise](../../reference/mongodb-user-promise.md) — value proposition, query examples, ecosystem comparison

## Planning docs (retained as reference)

- [mongo-poc-plan.md](1-design-docs/mongo-poc-plan.md) — PoC phases, sequencing, and conclusion
- [design-questions.md](1-design-docs/design-questions.md) — 14 open architectural questions with full analysis
- [contract-symmetry.md](1-design-docs/contract-symmetry.md) — where Mongo and SQL contracts converge and diverge
- [cross-cutting-learnings.md](cross-cutting-learnings.md) — design principles and open contract questions (proven learnings promoted to architecture docs)
- [mongo-execution-components.md](1-design-docs/mongo-execution-components.md) — execution pipeline component breakdown
- [example-schemas.md](1-design-docs/example-schemas.md) — concrete schemas with speculative PSL and query patterns

## Reference material

- [MongoDB primitives](../../reference/mongodb-primitives-reference.md) — data model, type system, query language, transactions
- [MongoDB idioms](../../reference/mongodb-idioms.md) — patterns experienced MongoDB developers use and expect
- [MongoDB user journey](../../reference/mongodb-user-journey.md) — typical developer experience and friction points
- [MongoDB feature support priorities](../../reference/mongodb-feature-support-priorities.md) — prioritized feature inventory

## Current planning

- [april-milestone.md](../april-milestone.md) WS4 — current priorities and scope
- `projects/` — implementation specs and plans (transient, per the Drive workflow)

New architectural decisions should be recorded as ADRs in `docs/architecture docs/adrs/` directly (not under this directory).
