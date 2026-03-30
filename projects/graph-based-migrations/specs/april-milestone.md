# April Milestone: Ready for External Contributions

**Goal**: External authors can meaningfully contribute to Prisma Next — SQL database targets, Postgres extensions, middleware, framework integrations, and query DSL extensions. This accelerates progress towards EA/GA.

**Key constraint**: System design decisions must be stable, even if user-facing APIs are still changing. Contributors need confidence that the interfaces they build against won't be reworked.

---

## Approach: architectural validation, not polish

We have five weeks (Mar 31 – May 2, with an offsite in Week 3). The goal for each workstream is to **validate the architecture** — prove that the design decisions hold under real conditions. It is not to polish the experience for users. That's May.

Each workstream is roughly independent, has a single owner, and that owner should progress through it as fast as possible. Each workstream has a priority-ordered queue of **validation points** (VP). Each VP identifies an architectural assumption to test, describes a user story that would prove it, lists the concrete tasks to get there, and defines a **stop condition** — the minimum result that answers the question. Everything beyond the stop condition is deferred. Work proceeds top-down: finish or explicitly stop VP1 before starting VP2. If you finish your workstream early, move to assist on another.

The team's instinct is to perfect. The constraint is: prove the architecture works first, then we polish.

---

## Workstreams

### 1. Migration system

The migration system uses a graph-based data structure for migration history. This is architecturally powerful but unfamiliar to every user coming from linear migration systems (Rails, Django, Prisma ORM, etc.).

**Already validated**: Branch, diverge, merge, and conflict resolution — the graph model's core value proposition for team workflows is implemented and working.

**Key risks**:

- **Data migrations are the highest architectural risk.** The graph model's core invariant (route equivalence) breaks when data matters. If we can't extend routing to handle data invariants, the graph model may need fundamental rework — and we'd rather discover that now than after stabilizing the API. We have a theoretical model ([data-migrations.md](0-references/data-migrations.md), [data-migrations-solutions.md](0-references/data-migrations-solutions.md)) but it is entirely unproven. Prisma ORM had no data migration support, so we have no prior art to lean on.
- The graph-based model is our biggest UX bet. If common use cases aren't dead simple, the power of the graph is irrelevant.

#### Priority queue

**VP1: Data migrations work in the graph model** *(highest risk)*

The entire migration graph is built on the assumption that any migration from contract state A to contract state B is functionally equivalent to any other A→B migration. Data migrations break this assumption — two databases at the same contract hash can have meaningfully different data. The routing model must be extended to define "done" as "contract hash H reached **and** required data invariants satisfied."

User story: I can define a migration that includes a data transformation (e.g. split `name` into `firstName` + `lastName`). I can apply that migration on my local database and a production database. If there are two paths to the destination contract, I have a simple way to ensure that my CD pipeline for production chooses the path that includes my invariant. `plan`, `apply`, and `status` all operate in a way which is aware of the invariant.

Tasks:

1. **Design the data migration representation** — what does a data migration node look like in the graph? What does the runner execute? How is the postcondition checked? Decide between Model A (co-located with structural migrations) and Model B (independent). Key open decisions: routing policy when multiple invariant-satisfying routes exist, and the concrete format of environment refs. Output: a concrete type definition and a sketch of the runner changes, not a document. See [data-migrations.md](0-references/data-migrations.md) and [data-migrations-solutions.md](0-references/data-migrations-solutions.md) for the theoretical model.
2. **Implement a data migration end-to-end** — a migration that splits `name` into `firstName` + `lastName`, with a postcondition invariant. `plan`, `apply`, and `status` all understand "done = hash + invariant satisfied."
3. **Invariant-aware routing** — create a graph with two paths to the same contract hash, only one of which includes the data migration. The system selects the path that satisfies the required invariant. The user has a way to declare which invariants are required for a given environment.

Stop condition: A graph with two paths to the same contract hash. One path includes a data migration (split `name` → `firstName` + `lastName`) with a postcondition invariant. `plan` selects the invariant-satisfying path for an environment that requires it. `apply` executes it. `status` reports "done" only when both the contract hash and the invariant are satisfied. Then stop — routing optimizations, invariant composition, and ref UX are May.

**VP2: Users can author migrations by hand** *(table-stakes)*

Manual SQL and data migrations both require this. Every migration system has an escape hatch where the user writes the migration themselves.

User story: I run a command like `migration new <from> <to>`, and the system scaffolds a migration file for me — pre-populated with the source and destination contract hashes and any boilerplate. I fill in the migration logic (raw SQL, data transformation, or both). The system integrates my hand-authored migration into the graph as a first-class node. I don't create files manually or write raw JSON.

Tasks:

1. **Design the manual authoring surface** — a TypeScript file (e.g. `migration.ts`) where the user uses utility functions to describe the migration, producing a migration data structure when executed. Structural migrations (raw DDL) and data migrations may have different authoring shapes — decide whether they share a surface or not.
2. **Scaffold command** — a CLI command (e.g. `migration new <from> <to>`) that creates the migration file with the correct graph coordinates already filled in. The user shouldn't have to know how to describe "from this contract state to that contract state" — the CLI resolves hashes and generates the skeleton. This is how systems like Active Record work: you never create migration files by hand.
3. **Implement manual SQL migration** — user writes a `.ts` file with raw SQL, it becomes a node in the graph, the runner executes it.

Stop condition: A user runs `migration new`, gets a scaffolded `.ts` file, writes raw SQL in it, and the runner executes it as a first-class graph node. Then stop — polish of the authoring API, documentation, and support for exotic migration shapes are May.

**VP3: The graph scales with large contracts** *(quick pass/fail)*

Every migration node encodes the full contract content. For projects with large contracts, this could cause performance and storage problems.

Tasks:

1. **Generate a 100+ model contract, create a series of migrations, measure** — graph operation time, migration history size on disk, plan/diff time. Pass/fail.

Stop condition: Numbers in hand. If acceptable, move on. If not, file an issue with the measurements and move on — optimization is May.

**Deferred (May)**:

- Ergonomic graph operations (rebase, squash, etc.)
- Polished CLI visualization
- Planner coverage for every schema change case
- Refs UX validation (depends on data migration model existing first)
- Will users understand "refs"? (UX question — refs need to exist before we can test comprehension)


