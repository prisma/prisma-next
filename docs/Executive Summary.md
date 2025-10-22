# Executive Summary

Software development has entered the agent era. Agents can write code and SQL, but they lack structure, verification, and safe deployment paths. The **market is shifting from APIs for humans to systems with guardrails for automation** — and no one has yet defined what that looks like for data.

**Prisma Next** is a contract-first successor to the Prisma ORM, purpose-built for this new workflow reality. It centers on a verifiable data contract that unifies code and database, enabling safe, predictable change for both humans and agents.

**When paired with PPg, Prisma Next delivers a unique "better together" advantage**: preflight per PR, safe migrations, and contract-aware advisors.

|  |  | Audience | Strengths | Gaps |
| --- | --- | --- | --- | --- |
| Past | **Prisma ORM (current)** | Human developers on traditional servers | Typed client, schema-driven DX  <br> Strong safety culture and migrations | Node-coupled, Rust binaries <br> Manual `generate` step <br> Not viable for serverless or agent workflows |
| Present | **Drizzle, Kysely** | Modern toolchains and frameworks | Pure TypeScript, no generate step <br> Runs anywhere JS runs | No verification <br> No guardrails for unsafe queries or schema drift <br> Query builder, not a system |
| Future | **Prisma Next** | Humans *and* agents | Verified data contracts <br> Deterministic, safe migrations <br> Actionable feedback for agents <br> PPg integration: preflight and hosted safety checks | — |

### Before vs After: how building with data feels

#### Before (today)
Teams write code that “looks” correct because TypeScript checks the shape of their queries. But once those queries hit the database, it’s hard to know if they are efficient, safe, or future‑proof. Problems like hidden N+1 patterns, unbounded reads, or missing indexes often show up late—in staging or production—when they are expensive to fix. When schemas change, drift is discovered through failures, not early warnings. Agents (and junior developers) don’t get much help beyond generic errors and blog‑post advice.

#### After (with Prisma Next)
Every app has a clear data contract that both the app and the database agree on. Each query is checked against that contract before it runs, and the system explains what’s risky and exactly how to improve it. Results and behavior are consistent and traceable, because each request maps to one well‑defined statement, making cause and effect obvious. When the schema changes, Prisma Next and PPg can verify those changes in an isolated environment before they reach production.

#### What this means for everyday development
Developers keep the ergonomics they love—familiar includes and selections—but now the system acts like a coach and a safety net. If a query could return far more data than expected or is missing a filter, Prisma Next flags it and tells the developer how to fix it. If the database doesn’t support a feature, the system says so up front and suggests a supported alternative. The goal isn’t to force a new style, but to make the existing style safer and more predictable.

#### What this means for teams running at scale
Leaders get fewer surprises. Because each request is a single, predictable statement, it’s easier to manage performance, costs, and reliability. We can set sensible budgets (for example, how many rows or how long a query may run) and enforce them consistently. When something regresses, we can point to the exact query and the exact reason, rather than guessing across multiple moving parts.

#### What this means for agents and automation
Agents can read the same contract that humans do and propose changes with confidence. When an agent’s query isn’t ideal, Prisma Next provides specific, actionable feedback—what to change and why—so the agent learns and improves. For schema changes, agents can run a pre‑flight in a safe, isolated environment and get a clear yes/no answer with reasons before anything is merged. This makes automated work both faster and safer.

#### How we bring our users along
We keep the ergonomics people love. A compatibility layer lets most teams switch without large rewrites, preserving familiar patterns while adding the new safety checks behind the scenes. Adoption can be incremental: start by running Prisma Next side‑by‑side, turn on guidance in “warn” mode, and tighten to “enforce” once teams are comfortable. This is an upgrade in experience, not a reset.

> Before, teams had typed queries and hoped they behaved well. After, teams have verified plans with a guide. Prisma Next turns data access into something you can trust: the application and the database agree on a contract, every query is checked and explained, and changes are verified before they ship.

### Proposal

Approve a focused pivot to Prisma Next as the successor to the current ORM, which will move into LTS (security and critical fixes only). Fund a **two-week MVP** and a **stage-gated private preview** to validate value, de-risk adoption, and establish Prisma Next + PPg as the definitive data platform for the agent era.

To maintain PPg progress, we’ll invest in features that stand alone yet directly support Prisma Next: database branching, contract visibility in Console, and contract browsing in Studio.

### Key outcomes

- Verified, contract-based development with no heavy client codegen
- Guardrails for humans and agents: safe queries, predictable migrations
- Clear PPg differentiation: preflight per PR, safe hosted migrations, contract-based promotion

### Call to action
Approve this pivot, resource the MVP and private preview, and align PPg development around the foundational capabilities that make Prisma Next’s advantage real.


## **Prisma Next in a nutshell**

### **The data contract**

Prisma Next centers the product on a **data contract** — a single, verifiable artifact that defines what the database *promises* to provide and what the application *expects* to exist.

This is **not** the `schema.prisma` file itself. The Prisma schema (PSL) or an equivalent TypeScript builder is the **input**. Prisma Next processes that input into a deterministic **contract file** — a machine- and human-readable JSON artifact that describes all tables, columns, indexes, foreign keys, and the models they support.

Each contract:

- Has a unique, immutable **contract ID** (a hash of its contents)
- Is recorded by both the application (which declares what it was built against) and the database (which declares what it currently implements)
- Allows instant verification that the two match before queries or migrations run

Because the contract is explicit and verifiable, Prisma Next eliminates ambiguity between developer intent and database state. It becomes a **shared source of truth** for humans, agents, and infrastructure — the foundation for preflight checks, safe migrations, and runtime guardrails.

### **Safer, verifiable queries**

Two simple ways to express queries, whichever teams prefer:

- A minimal **query builder** (TypeScript) that knows your data contract
- An **ORM-style builder** on top of that for familiar model-oriented queries

Both paths produce async iterable results that support incremental streaming for large datasets or collection for typical CRUD operations. Each query is a structured plan carrying the contract ID, verified before execution. This enables runtime guardrails—no unbounded queries, sensible limits, and time or resource budget caps—so agents can iterate safely with clear, actionable feedback.

For advanced or vendor-specific operations, Prisma Next provides a **raw SQL escape hatch** with optional plan annotation for policy checks and auditing. We will evaluate a TypedSQL surface in a later phase only if private preview usage demonstrates clear need.

These query guarantees combine with deterministic migrations to form the foundation of Prisma Next's safety model — one that both humans and agents can rely on.

### **Deterministic migrations**

Prisma Next reframes migrations as **a verified move from one data contract to another**, replacing the fragile model of file-based SQL scripts used across the industry.

Each migration is expressed as a sequence of **structured operations** — not raw SQL — and each operation includes pre- and post-conditions that verify the database is in the correct state before and after execution. This means you can never apply the wrong migration to the wrong system. The system always knows which contract the database currently implements, and the precise path to the desired one.

Because migrations are recorded as structured JSON, they are **deterministic, portable, and verifiable**:

- **Safe by design.** Each step checks itself before it runs. Humans or agents can generate migrations confidently, knowing they will validate as they execute.
- **Deterministic and cheap.** Migrations are computed directly from two contracts — no manual ordering or file management
- **Portable.** They can be transmitted and executed safely in controlled environments — for example, by a hosted migration service that applies them in isolation before promotion (think **PPg Cloud Migrations**)
- **Reviewable.** JSON-based migrations can be inspected or summarized by an agent or human reviewer in a PR before execution
- **Conflict-resilient.** When the contract changes upstream, migrations can be automatically regenerated against the new target without guesswork
- **Squashable.** Migrations can be cleanly collapsed into a new baseline contract, eliminating the need to keep an ever-growing migration history in your repo — a long-standing pain point and a **visible industry criticism (e.g. by Theo)**

This architecture replaces blind, sequential SQL files with a **verifiable, self-checking workflow**. It makes migrations predictable, automatable, and inherently safe — for both humans and agents.

This is a **genuine innovation**. No other ORM or data-layer tool has built migrations that verify themselves as they run. Prisma can lead the market for a change — setting the new standard for safety, automation, and operational clarity in schema evolution.

When paired with PPg, this model becomes even more powerful: migrations can be verified and executed in isolated environments before promotion.

### **PPg advantage (contract-aware hosted database)**

When paired with PPg, Prisma Next can provide:

- Preflight per pull request: a fresh, **isolated database copy** checks proposed changes and posts results back to the PR before merge
- Safe, platform-managed migrations: online index builds, phased changes, chunked backfills
- Built-in advisors and optional server-side guardrails: suggestions and policies that prevent risky operations in production
- A promotion flow tied to contract IDs: see exactly what will change when promoting a branch

## **Product value, positioning, differentiation**

### **Immediate user value**

- Safer changes: unsafe queries and migrations are caught before production
- Faster iteration: no heavy client code to regenerate. Modern toolchains just work. New environments spin up quickly from a clean baseline
- Agent-ready: agents have a clear contract to read, can produce structured changes, and get actionable feedback when checks fail
- Familiar, first-class DX: TypeScript-only, better errors, fewer steps

### **How we differ from TypeScript-only query builders**

- We provide a verifiable data contract that ties code and database together. Competitors expose a library; we expose a system boundary the whole toolchain can trust
- Queries and migrations are structured plans (not just strings) that can be checked, linted, and audited
- With PPg, we offer preflight, safe orchestration, and advisors as a service—uniquely enabled by the contract

### **Strategic impact: ecosystem & expansion**

Prisma Next doesn’t just modernize the ORM; it redefines our participation in the ecosystem.

**Open for contribution**

Prisma Next removes one of the biggest barriers to community contribution: the Rust-TypeScript hybrid codebase. The new architecture is TypeScript-only and modular. That means:

- The open-source community can meaningfully contribute for the first time—new dialects, migration operations, or platform integrations—without needing deep Rust expertise
- We can grow a true **plugin ecosystem** around the data contract: extensions for policy enforcement, auditing, or custom operations authored by users themselves
- We can **extend the ORM** without changing the implementation of the core
- This creates leverage. The community can expand coverage faster than we ever could as a single team

This positions Prisma as an **open, extensible data layer** rather than a closed ORM — a platform others can build on, integrate with, and extend.

**Path to Mongo and other databases**

This design finally gives Prisma a clear, sustainable path beyond relational databases. Because the **data contract** describes storage and models independently:

- Each database family can define its own mapping layer between models and storage, while still producing the same contract format
- We can introduce a Mongo-specific “family” of adapters that express collections, documents, and indexes as first-class contract elements—without rewriting the system

Better yet, the MongoDB team could contribute it themselves — potentially as a design partner in our private preview — rebuilding and strengthening our relationship with them.

This not only solves the long-standing problem of how to integrate Mongo as a first-class DB but retains Prisma’s position as the only data layer that can unify relational and document worlds, under a single contract-based model.

## Risks and mitigations

- Two products may confuse users or fragment the base
  - **Mitigation:** clear naming and guidance (Prisma ORM LTS vs Prisma Next data contract platform) and a small bridge to adopt Prisma Next module-by-module in existing repos

- Rewrite risk (losing hard-won behavior)
  - **Mitigation:** we are not chasing feature parity. We carry forward Prisma’s safety culture (tests, fixtures, golden checks) where the new model overlaps and deliberately avoid the old ORM’s multi-query behaviors

- Thin or buggy MVP could damage reputation
  - **Mitigation:** stage-gated rollout with design partners. Strict acceptance metrics. No public launch until gates are passed

- Performance overhead from checks
  - **Mitigation:** keep checks lean and lazy. Benchmark hot paths early. Set performance budgets

- Over-coupling to PPg
  - **Mitigation:** all PPg features are opt-in. Prisma Next works with any Postgres; PPg simply adds compelling advantages

### Kill or hold criteria

Pause if any of the following are true:

- Developers rate the new experience worse than today’s ORM for common tasks despite guidance
- Safety checks and preflight do not catch a meaningful share of would-have-been incidents
- The migration model confuses teams (frequent manual interventions)
- Runtime overhead can’t be kept small on standard CRUD
- Design partners can’t integrate within two sprints, or agent workflows do not improve review cycles or time-to-green

### Metrics for the agent era

- Agent success rate: first-try and post-iteration preflight pass rates versus alternatives
- Human time per task: building CRUD, evolving the schema, writing a complex query
- Safety: percentage of risky queries and migrations caught before production and reduction in incidents
- Environment time-to-ready: from clone repo to working environment with a squashed baseline
- Change stability: unexpected plan changes blocked in CI
- PPg adoption: growth in users leveraging preflight and safe migration orchestration features within PPg

## **Validation & Rollout**

| Phase | Duration | Goal | Key Validation |
| --- | --- | --- | --- |
| **Proof of Concept** | ✅ Done | Demonstrate viability of approach | Contract-based migrations and query builder with ORM extension are possible <br> https://github.com/wmadden/prisma-next |
| **MVP** | 2 weeks | Demonstrate contract flow & preflight concept | Internal demo slice shared with Insiders - Kent, Theo etc |
| **Private Preview (Stage-Gated)** | 12–20 weeks | Validate usability, safety gains, and PPg integration | Three design partners confirm improved experience and safety outcomes |
| **GA for Postgres** | — | Public launch of Prisma Next | Meaningful user adoption despite LTS ORM coexistence |

### **Two-week MVP**

Build a minimal, end-to-end Prisma Next slice that demonstrates the core workflow:

- Edit a schema and see the data contract update automatically — no manual generate
- Plan a schema change and fail preflight with a clear, actionable error
- Add a small data migration and pass preflight successfully
- Run a query checked against the contract and guardrails
- Show how PPg would automatically run the same preflight on a pull request
- Enable an agent to execute the above tasks successfully

**Constraints for focus:**
- TypeScript-only development plugin for automatic updates
- Postgres only
- Additive schema changes only (no renames or drops yet)
- A few high-value guardrails (e.g., prevent unbounded queries)

### **Private Preview (Stage-Gated, 12–20 weeks)**

- **Gate 1 (end of week 6):**
  - **The Portal team adopts Prisma Next** in at least one project (e.g. Management API)
  - Preflight provides low-noise, actionable feedback. Development plugin eliminates manual generate

- **Gate 2 (end of week 12–20):**
  - **Three design partners** report that Prisma Next improves safety, feedback quality, and day-to-day workflow over the LTS ORM
  - Safety checks catch real-world issues before production. Performance overhead remains minimal
  - At least one partner adopts Prisma Next in a limited production environment
  - PPg integration demonstrated: contract visible in Console and preflight checks running per PR

### Private Preview → GA

Timeline beyond the private preview will depend on validation results; we’ll reassess scope and schedule at each gate.

### **PPg Investment During the Private Preview**

Focus PPg effort on features that deliver standalone customer value *and* enable the Prisma Next + PPg advantage:

- **Database branching and cloning** — Core to the hosted migration preflight service. Delivers immediate value for isolated test environments and CI validation, while serving as Prisma Next’s contract-aware preflight infrastructure.
- **Display the contract in Console** — Show the data contract (and ID) for each connected database to build early user awareness of Prisma Next concepts.
- **Backport contract emission to the LTS ORM** — Allow the existing ORM to emit and store contracts post-migration. Enables contract visibility in Console today, bridging the old and new worlds.
- **Contract browsing in Studio** — Extend Studio (embedded in Console and available via CLI) to explore models, relations, and indexes as recorded in the database.

These initiatives maintain visible PPg momentum while directly building the foundation for Prisma Next’s “contract-aware, safe, and verifiable change” story.

## **Decisions Needed**

- Approve positioning: Prisma Next as successor; Prisma ORM to LTS
- Approve resourcing for the two-week MVP and stage-gated private preview with defined checkpoints
- Approve a design-partner program and private preview under NDA
- Approve initial PPg investment to support preflight and contract awareness

### **Immediate Next Steps (within 14 days post–Prisma 7 launch)**

1. Kick off the two-week MVP with named owners across:
   contract and types, queries/runtime, migrations/preflight, example app, and development plugin.
2. Secure three design partners (API CRUD, analytics/reporting, and one existing Prisma customer) with clear goals and timelines.
3. Draft LTS messaging and a one-page “Which Prisma should I use?” guide for users and sales.
4. Stand up a simple dashboard for acceptance metrics: usability, safety catches, overhead, agent pass rate.
5. Scope PPg’s preflight per PR spike and infrastructure needs: ephemeral databases, seed data, CI integration.

## **Closing**

The time is right to make a clean break. Agentic development workflows aren’t a future trend — they’re already shaping how software is built. The current ORM, with its legacy design and technical debt, can’t evolve fast enough to meet that reality.

Prisma has spent years following shifts in the ecosystem. Prisma Next is our chance to lead again — with a clear innovation: **contract-aware migrations and queries that enforce their own safety guarantees.** No other player in the space has explicitly targeted agent workflows or built for verifiable, autonomous change. We can be first, carrying forward Prisma’s safety culture while leaving behind the architecture that’s been holding us back.

This is a **controlled pivot**: time-boxed, measurable, and validated through design partners. It aligns our resources with the future of development instead of maintaining a legacy product that’s slowing us down.

**Decision:** Transition investment from the legacy ORM to Prisma Next — the foundation for Prisma’s next decade.
