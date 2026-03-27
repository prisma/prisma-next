# April Milestone: Ready for External Contributions

**Goal**: External authors can meaningfully contribute to Prisma Next — SQL database targets, Postgres extensions, middleware, framework integrations, and query DSL extensions. This accelerates progress towards EA/GA.

**Key constraint**: System design decisions must be stable, even if user-facing APIs are still changing. Contributors need confidence that the interfaces they build against won't be reworked.

See [roadmap.md](roadmap.md) for how this milestone fits into the broader timeline.

---

## Workstreams

### 1. Migration system

**People**: Saevar, Alberto

The migration system uses a graph-based data structure for migration history. This is architecturally powerful but unfamiliar to every user coming from linear migration systems (Rails, Django, Prisma ORM, etc.). The UX must be dead simple for common cases or we'll get significant backlash.

**Active work**:

- **Planner extensions**: Extending the migration planner to handle more schema change cases.
- **Conflict resolution**: When migration history diverges (e.g. two branches add migrations), the system must detect and resolve conflicts.
- **Git-style CLI visualization**: Visual representation of migration graph state, diffs, and history in the CLI.

**Not yet started**:

- **Data migrations**: Users need to transform data as part of a migration (e.g. split a `name` column into `firstName` + `lastName`). This is unvalidated — we need to design how data migration steps integrate into the graph.
- **Manual migration escape hatch**: Users need to write raw SQL migration steps when the planner can't express what they need. This is table-stakes; every migration system has one.
- **Ergonomic graph operations**: The graph-based history needs CLI commands with a similar level of ergonomics to git. Users need to be able to inspect, rebase, squash, and manipulate their migration history without understanding the underlying graph theory. If common workflows (branching, merging, rolling back) aren't intuitive, the graph model becomes a liability rather than an advantage.

**Key risk**: The graph-based model is our biggest UX bet. If common use cases (linear development, feature branches, team collaboration) aren't dead simple, the power of the graph is irrelevant.

---

### 2. Contract authoring (PSL + TypeScript DSL)

**People:** Will, Alberto

Users describe their domain model — which becomes the contract — in one of two ways: PSL (Prisma Schema Language) or a TypeScript DSL. Both need significant work.

**Active work**:

- **PSL — parameterized types**: Extending PSL with support for parameterized/generic types.
- **PSL — field presets**: Default field configurations that reduce boilerplate in schema definitions.
- **PSL — historical pain points**: Addressing known PSL limitations and community complaints from Prisma ORM.
- **TypeScript authoring DSL** (new, Alberto): A new DSL that matches PSL's expressiveness. The current TS authoring surface was a proof-of-concept that mirrors the contract JSON structure directly — extremely verbose, repetitive, and unpleasant to write. The new DSL replaces it entirely.

**Not yet started**:

- **PSL extensibility via framework components**: When a user adds a new framework component (e.g. a Postgres extension like pg_vector), PSL must be able to incorporate the new types, attributes, and syntax that the component introduces. PSL cannot be a closed language if the extension model is open.
- **Language server update**: The VS Code extension's language server is coupled to Prisma 7's version of PSL. It needs to be extended to:
    - Load the Prisma Next config file (`prisma-next.config.ts`)
    - Use the config to interpret PSL (which components are loaded, what syntax they contribute)
    - Support the new PSL features (parameterized types, presets, extension-contributed syntax)

**Key risks**:

- The language server is a DX-critical path. If PSL has new features but the VS Code extension doesn't understand them, users get red squiggles on valid code. This erodes trust fast.
- The TS authoring DSL needs to be genuinely pleasant to use — if it feels like writing JSON with extra steps, users will avoid it and we lose the "author in TypeScript" selling point.

---

### 3. ORM and query builders

**People: Alexey, Serhii**

**Active work**:

- **SQL Query DSL** (new): A new SQL query builder that will replace the current SQL Query plan and the Kysely plan. This becomes the escape hatch for the ORM client — when the ORM abstraction doesn't fit, users drop down to the SQL DSL.
- **ORM client maturation**: The ORM client has most of its core functionality, but is missing key components:
  - **Transactions**: No transaction support yet.
  - **Extension-contributed operations**: The ORM client doesn't respond when an extension like pg_vector is added. It needs to read the operations registry, incorporate custom data types, and surface extension-contributed query methods.

**Key risk**: The ORM client and SQL DSL together form the primary user-facing query surface. If transactions aren't supported or extensions can't surface their operations through the ORM, users can't build real applications.

---

### 4. MongoDB PoC — validate the extension ecosystem boundary

**People: Will**

**Status**: Planning complete, implementation not started

**Why this blocks the milestone**: We plan to invite community authors to build extensions. Our [community generator analysis](community-generator-migration-analysis.md) shows 31 of 33 use cases are family-agnostic — but every interface an extension would consume today is SQL-specific. Stabilizing these interfaces without validating a second family risks ecosystem fragmentation and breaking changes. See the [roadmap rationale](roadmap.md#april-ready-for-external-contributions) for the full argument.

**Deliverables**:

- `DocumentContract` type populated from a real schema (PSL or TS authoring)
- Document execution context that a consumer library can accept
- At least one consumer library example working against both SQL and document contracts
- Handoff-ready scaffold for the MongoDB team to extend

**Detailed plan**: [mongo-poc-plan.md](mongo-target/mongo-poc-plan.md)

**Key questions to answer**:

- Is `ContractBase` sufficient as the family-agnostic surface, or does it need to evolve?
- How do extensions detect and traverse different contract families?
- How should extensions declare which targets/families they support?

---

### 5. Second SQL database (SQLite)

**People: Serhii**

**Status**: Not started

**Why it matters**: Multiple systems have Postgres implementation details baked in (Kysely lane, migration planning, etc.). Supporting a second SQL target forces us to decouple target-specific assumptions from the core, which is a prerequisite for contributors building new SQL targets.

**Deliverables**:

- SQLite adapter (at least MVP)
- Core systems decoupled from Postgres-specific assumptions
- At least one query lane working against SQLite

---

## Tangential topics

These are not primary workstreams but are important enough to track in this plan.

### Benchmarks

Comparative benchmark suite (Prisma Next vs Prisma ORM vs raw driver). High-visibility deliverable that substantiates our performance claims. In progress (Alexey).

### ParadeDB PoC

Scaffolded extension that provides a new database primitive. Demonstrates that the extension model can go beyond middleware and schema tooling. Handoff target for the ParadeDB team.

### Community outreach

Reaching out to potential contributors: authors of Prisma generators, Arktype, Zod, NestJS, and other packages with close integrations (see [community-generator-migration-analysis.md](community-generator-migration-analysis.md)). Depends on stable interfaces and contributor documentation. Can't meaningfully start until the core workstreams have landed.

---

## Dependencies

```
MongoDB PoC ──────→ Stable extension interfaces ──→ Community outreach
                                                 ↗
SQLite target ────→ Decoupled core ─────────────

PSL extensibility → Extensions can contribute syntax → ORM reads extension operations
                                                     ↗
ORM + query DSL ──→ Transaction support, extension ops
```

- **MongoDB PoC** and **SQLite target** are the two validation axes: one validates the family abstraction (SQL vs document), the other validates the target abstraction (Postgres vs SQLite within SQL). Both must land before we can confidently stabilize interfaces for external contributors.
- **PSL extensibility** and **ORM extension-contributed operations** are two sides of the same coin: the extension model needs to flow from schema definition through to query surface.
- **Migration system** is largely independent — it has its own design validation path (graph operations, data migrations, escape hatches).
- **Community outreach** depends on stable interfaces and contributor docs; it's the last thing that can start.

## Five-week timeline

### Week 1: Mar 24–28

<!-- TODO -->

### Week 2: Mar 31–Apr 4

<!-- TODO -->

### Week 3: Apr 7–11

<!-- TODO -->

### Week 4: Apr 14–18

<!-- TODO -->

### Week 5: Apr 21–25

<!-- TODO -->

---

## Open questions

- What is the priority order across the five workstreams? How do we sequence work given the team we have?
- How much of the ergonomic TS schema API is needed for April vs. May? Is it a prerequisite for contributors, or can they work with the current low-level API?
- What does "contributor documentation" look like concretely? A guide? Example repos? API reference?
- Is the ParadeDB PoC dependent on the MongoDB PoC (both validate extension interfaces), or can they proceed in parallel?
- For migrations: what is the minimum viable set of graph operations that makes the UX acceptable for common workflows?
- For the language server: is updating the existing Prisma 7 language server feasible, or does it need a rewrite?

