# ADR 015 — ORM as an optional extension over the DSL

## Context

The base system provides a small SQL DSL that compiles to a relational AST and a Plan. Many users want higher-level ergonomics for traversing relations and shaping results. Historically, ORM concerns have leaked into core query builders, increasing complexity and limiting portability. We want an optional ORM layer that improves ergonomics without changing core semantics, safety, or portability.

## Decision

Ship the ORM as an optional package layered on top of the SQL DSL and the data contract:
- `@prisma/orm` depends on `@prisma/sql` and `@prisma/relational-ir` but not vice versa
- Enforce the one call → one statement rule for ORM operations; each ORM invocation must compile to exactly one SQL statement and one Plan
- Place dialect-specific lowering strategy for ORM constructs in adapter profiles, not in the DSL core (e.g., the Postgres profile implements include lowering via LEFT JOIN LATERAL, json_agg, or LEFT JOIN patterns)
- Keep the SQL DSL free of ORM concepts such as relation handles or nested include syntax; the ORM compiles its higher-level AST into the same relational AST nodes the DSL already uses

## Rationale
- One call → one statement keeps performance characteristics predictable, makes budgets and guardrails straightforward, and avoids N+1 class pitfalls
- Housing lowering in adapter profiles preserves the thin-core design and keeps dialect decisions close to capability checks, not scattered in userland or the DSL core
- Keeping ORM optional prevents feature creep into the base builder and allows teams to adopt only what they need
- Plans remain uniform across lanes, preserving verification, hashing, and telemetry

## Scope

### In scope
- Read-oriented relation traversal for 1:N and N:1 as sugar over joins and lateral subqueries
- Controlled shaping of nested results through adapter-provided lowering strategies
- Emitting a single Plan per ORM call with meta.lane = 'orm'

### Out of scope for this ADR
- M:N traversal strategies
- Nested writes or unit-of-work semantics
- Multi-statement orchestration or batching under a single ORM call
- Caching, identity map, or change tracking

## Adapter responsibilities
- Declare capabilities needed by ORM lowering such as lateral, jsonAgg, arrayAgg, jsonBuildObject
- Provide lowering routines that transform ORM AST nodes into relational AST nodes supported by the base SQL compiler
- Guarantee deterministic SQL emission from the same inputs and capabilities
- Emit helpful diagnostics if a requested ORM feature is unsupported by the target

## Behavior when capabilities are missing
- If the adapter cannot lower an ORM construct while preserving one call → one statement, compilation fails with a clear error and remediation guidance
- Where safe and unambiguous, adapters may fall back to alternative single-statement strategies such as flattening with prefixed columns and grouping in the client, but only if result types and guardrails remain correct

## Error semantics and safety
- ORM-generated Plans participate in the same verification pipeline as DSL and raw Plans
- Guardrails such as no-select-star, mutation-requires-where, limit-required, and budgets apply identically
- Plan hashing per ADR 013 is lane-agnostic and thus unaffected by whether the Plan originated in ORM or DSL

## Developer experience
- Developers opt into ORM for ergonomics while retaining the ability to drop to the DSL or raw SQL lane for edge cases
- The ORM API mirrors DSL composition patterns to minimize cognitive switching
- Result typing is derived from the lowered projection and adapter guarantees

## Alternatives considered

### Embedding ORM features directly in the DSL
- Would bloat the core and entangle dialect decisions with the base AST

### Allowing ORM calls to orchestrate multiple statements
- Complicates budgets and safety guarantees and undermines Plan identity

### Implementing per-dialect logic inside the ORM package
- Duplicates adapter concerns and breaks thin core, fat target

## Consequences

### Positive
- Clean separation of concerns between ergonomics (ORM), composition (DSL), and execution (runtime)
- Easier to add new dialects by implementing adapter profiles without touching ORM public API
- Predictable performance and safety due to the one call → one statement invariant

### Trade-offs
- Some advanced relational shaping may not be expressible as a single statement in all dialects and will surface as compilation errors instead of automatic batching
- Adapter profiles carry more responsibility and must be well-tested to ensure deterministic lowering

## Testing
- Golden SQL snapshots for representative ORM patterns per adapter profile
- Equivalence tests showing ORM-produced Plans match hand-written DSL Plans for the same shape
- Capability matrix tests that assert proper errors when required features are unavailable
- Performance smoke tests to confirm one statement per call and budget adherence

## Migration and compatibility
- Existing DSL code remains valid and unchanged
- Teams can incrementally adopt ORM constructs where it improves readability without impacting the execution pipeline
- Adding a new dialect involves only the adapter profile and tests, not changes to ORM or DSL public APIs

## Open questions
- Strategy for M:N traversal and whether single-statement lowering is feasible across all dialects
- Pagination strategies for nested collections that preserve one statement while remaining efficient
- Standardized aliasing and projection rules to ensure stable typings across adapters

## Decision record
ORM is an optional layer over the DSL that compiles to exactly one SQL statement per call. Dialect-specific lowering resides in adapter profiles, not in DSL core. Plans produced by ORM follow the same contract, hashing, guardrails, and runtime hooks as all other lanes.
