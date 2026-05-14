# ADR (draft) — Architectural principles: affordances and cross-target consistency

> **Status:** Draft, ready for promotion (lives under `projects/target-extensible-ir/specs/` while the project executes; promoted to `docs/architecture docs/adrs/` with a permanent ADR number at project close-out — after PR2 lands the namespace exemplar). The principles have been exercised against the Mongo Contract IR refactor (M2), the SPI dispatch symmetry between SQL and Mongo families (M2.5), the SQL targets' adoption of the SPI shape (M3), the entities authoring mechanism (M3.5), and the enum exemplar (M4); PR1's M6 docs sweep is the principles' first surfacing in durable repo docs (the M6 `docs/Architecture Overview.md` update adds the two principles to § Guiding Principles).
>
> **Companion ADRs:** [3-layer polymorphic IR convention](3-layer-polymorphic-ir-convention.md); [Target-extensible authoring via pack contributions](target-extensible-authoring.md); [Polymorphic `storage.types`](polymorphic-storage-types.md). This ADR captures the principles; the companions capture three concrete instances of them.

## At a glance

Prisma Next is a multi-target data layer (Postgres, SQLite, Mongo, …) that promises a coherent developer experience across targets. Two architectural principles underwrite that promise:

1. **The framework provides affordances; targets implement specifics.** The framework encodes behaviour as interfaces, abstract bases, and shape constraints (the *affordances*) — the shape of an IR node, the SPI a verifier must satisfy, the contract a serializer round-trips. Targets fill in specifics: rendering, dialect quirks, native types, target-only kinds. A target author who reaches for an affordance falls into the right shape by construction.

2. **Familiar with one target, fluent in another.** Because every target consumes the same framework affordances, a developer who learns one target's IR reads the next target's IR the same way. The verifier interface is the same shape. The hydrator dispatches the same way. The namespace mental model carries across SQL and Mongo even though the underlying object differs (Postgres `schema`, MySQL `database`, Mongo `db`). Cross-target consistency is not a style guide — it is what the affordances *produce*.

Both principles are already present in the codebase as implicit conventions ([ADR 195](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md), [ADR 185](../../../docs/architecture%20docs/adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md), `OpFactoryCall`, `MongoSchemaNode`, the existing target descriptor pattern). They have not been stated as load-bearing principles in the architecture docs. This ADR states them and explains why they are load-bearing — particularly for ecosystem extensibility (FR23). The companion [3-layer polymorphic IR convention](3-layer-polymorphic-ir-convention.md) ADR is one concrete instance of both principles at work.

## Context

### Today's docs name "Thin core, fat targets" but not the underlying reasons

[`docs/Architecture Overview.md`](../../../docs/Architecture%20Overview.md) § "Guiding Principles" surfaces "Thin core, fat targets" — the *what*. The underlying *why* is unstated:

- **Why is the core thin?** Because the framework's job is to *encode behaviour as affordances*, not to implement the behaviour. A framework that implements Postgres-specific rendering becomes a framework that has to know about every target's specifics; that scales `O(targets × concepts)`. A framework that ships the *affordance for rendering* (an interface, an abstract base) scales `O(concepts)` and the targets absorb the `O(targets)` axis on their own surface.

- **Why are the targets fat?** Because the *specifics* are what differentiates a target. Postgres's `nativeType` field, SQLite's `WHERE` clause on partial indexes, Mongo's collection options — these are not framework knowledge; they are target knowledge, and the target is the only honest place to ship them.

- **What ties the targets together?** That every target consumes the same affordances. A user who reads `PostgresColumn` and learns it carries `nativeType` does not also need to learn that `SqliteColumn` carries a different field; both extend the same `SqlColumn` and the framework promise — "a column has a name, a nullable bit, a default" — holds across them. The same shape repeats at the Storage level, the Namespace level, the verifier SPI level. The *form* is the same; the *content* is target-specific.

Stating "Thin core, fat targets" without stating its underlying principles produces correct surface advice but does not equip a contributor to *generate* the right design decisions for a new concept. Naming the principles closes that gap.

### These principles are load-bearing for ecosystem extensibility

The follow-up Supabase project (RLS policies, `supabase()` runtime facade, `auth.users` queryable surface) is a stress test of both principles:

- **Supabase needs target-specific IR kinds** (`RlsPolicy`) the framework has never heard of. The "framework provides affordances; targets implement specifics" principle is what allows Postgres to extend `SchemaNodeBase` directly with a new kind without touching the framework. Without that principle, Supabase has to either widen the framework's IR shape (every consumer in every other target now sees an irrelevant kind) or smuggle RLS through `annotations` blobs (lossy, opaque, no static types).

- **Supabase reads "the same" as Postgres.** A developer who learns Prisma Next on vanilla Postgres should be able to open a Supabase contract and read it. They will see `auth.users` (a namespace coordinate they recognise from M5a/b), and an `RlsPolicy` kind they don't recognise — but the *shape* of the IR around it is the same. They learn one new kind, not a new architecture. The "familiar with one target, fluent in another" principle is what makes that gradient possible.

The same argument applies recursively to every target downstream — Cockroach extending Postgres, Vitess extending MySQL, MongoDB Atlas extending Mongo. The principles are what make the extension surface scale.

### These principles surface during this project, not after

The target-extensible IR refactor (TML-2459) is the first project in the codebase that names *both* principles as load-bearing in its spec. The principles existed before — embedded in `OpFactoryCall`, the Mongo Schema IR, the target descriptor pattern — but always as one-project applications. This project lifts them out of "convention by example" and into "stated principles". Stating them lets follow-up projects (Supabase, Cockroach, MySQL family) reference them rather than re-derive them.

## Decision

State both principles explicitly in the architecture docs.

### Principle 1: The framework provides affordances; targets implement specifics

**Statement.** The framework's job is to encode behaviour as affordances — interfaces, abstract base classes, shape constraints, SPI contracts. The framework does not implement target behaviour; it ships the *shape* that target behaviour must take. Targets fill in the specifics, and any target that uses the affordance falls into the framework's intended shape by construction.

**What "affordance" means here.** An affordance is a piece of framework surface that:

- Names a concept and commits to its minimal shape (`interface SchemaNode { readonly kind: string }`).
- Provides ergonomic scaffolding when scaffolding is cheap and pays for itself (`abstract class SchemaNodeBase` centralising `freeze()`).
- Declares an SPI that consumers depend on (`interface ContractSerializer<TContract>`), so consumers reach the target through the abstraction rather than the concrete class.
- Leaves *specifics* — rendering, dialect quirks, native types, target-only kinds — to the target.

**What this rules out.** The framework does not:

- Branch on target identity (`if (target === 'postgres')` is an architectural smell — see [`.cursor/rules/no-target-branches.mdc`](../../../.cursor/rules/no-target-branches.mdc)).
- Carry target-shape fields on framework types (`SchemaNode` does not declare `nativeType` because not every kind has one).
- Implement behaviour the target should implement (the framework does not know how to render a Postgres `CREATE INDEX` statement; Postgres does).

**Reference instances of this principle:**

- [ADR 185 — SPI types live at the lowest consuming layer](../../../docs/architecture%20docs/adrs/ADR%20185%20-%20SPI%20types%20live%20at%20the%20lowest%20consuming%20layer.md). The dependency-inversion pattern that operationalises this principle — the framework declares the SPI; the target implements it.
- [ADR 195 — Planner IR with two renderers](../../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md). The framework interface for `OpFactoryCall` is three readonly fields; the target abstract base + ~20 concrete classes carry every specific.
- [3-layer polymorphic IR convention](3-layer-polymorphic-ir-convention.md) (this project's companion ADR). The framework alphabet is `SchemaNode`, `Namespace`, `Storage`, plus the SPI shapes; the family provides the dialect bases (`SqlTable`, `SqlContractSerializerBase`); the target provides the words (`PostgresTable`, `PostgresContractSerializer`).

### Principle 2: Familiar with one target, fluent in another

**Statement.** Because every target consumes the same framework affordances, a developer fluent in one target reads any other target the same way. Learning the second target is learning its *specifics*, not a new architecture. The framework's affordances produce a common shape; the targets fill in their content.

**What this looks like in practice.**

- A developer who learns to read a Postgres contract.json — `storage.tables.<name>.columns.<name>` — reads a SQLite contract.json the same way. The SQLite column carries different `nativeType` values, no fancy defaults, but the *walk* is identical.
- A developer who learns the namespace concept on Postgres — top-level `namespace { … }`, dot-qualified `auth.User` in `@relation`, `__unspecified__` for connection-bound binding — reads the Mongo equivalent the same way. Mongo's namespace IS the database; the singleton `MongoTargetUnspecifiedDatabase` elides the database prefix when rendering. The mental model carries; the rendering details differ.
- A developer who writes a verifier for a new target reads the existing verifiers — `PostgresSchemaVerifier`, `MongoTargetSchemaVerifier` — and finds the same shape: `extends <family>SchemaVerifierBase`, override `verifyTargetExtensions`. The new target slots into a known recipe rather than inventing a new one.

**What this rules out.**

- **Bespoke per-target shapes.** A target cannot "innovate" on the IR's overall shape (kind discriminant, namespace coordinate, JSON-canonical fields). Within the shape, it innovates freely on the content. The framework promises the form; targets promise the content.
- **Target-specific consumer interfaces.** A consumer that needs to walk an IR depends on framework SPIs (`SchemaVerifier<TContract, TSchema>`), never on concrete target classes (`PostgresSchemaVerifier`). The framework consumer can swap one target for another at the abstraction's seam.

**Reference instances of this principle:**

- The existing target descriptor pattern ([`packages/3-targets/3-targets/postgres/src/exports/control.ts`](../../../packages/3-targets/3-targets/postgres/src/exports/control.ts) and the Mongo equivalent). Same descriptor shape across families; same named properties (`migrations`, soon `contractSerializer`, `schemaVerifier`); same consumer integration path.
- Mongo Schema IR ([`packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts`](../../../packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts)). Demonstrates the AST-class recipe inside the Mongo family; the recipe transports to SQL families without modification.
- The 3-layer polymorphic IR convention ADR. Cross-target consistency is the *output* of the convention; the principle is the *why*.

## Consequences

### What this enables

- **Ecosystem extensibility.** A third-party target author (or a sibling project like Supabase) extends an existing family by extending the family abstract bases, plus optional target-only kinds extending `SchemaNodeBase` directly. The framework never has to know the new target exists; the consumers that depend on framework SPIs continue to work without modification. This is what makes the follow-up Supabase project a series of focused feature PRs rather than another foundational reshape (FR23 framing).
- **Cross-target onboarding cost stays sub-linear.** Adding a target N+1 to a developer's known set is cheap because the framework already taught them N's shape. The cost is the target's specifics, not its architecture.
- **Targets innovate on content, not form.** A target that wants to add a target-specific kind (Postgres functions, RLS policies, MongoDB change streams) can; the framework's affordance covers it without modification. A target that wants to invent a new IR shape (a different storage walk, a different verifier dispatch) cannot, because the affordances are the form and the form is fixed.
- **Reviewers have a sharpened question.** When a PR proposes adding behaviour to the framework, the review question is "is this an affordance or a specific?" If it is an affordance (an SPI shape, an abstract base, a shape constraint), it belongs in the framework. If it is a specific (a rendering decision, a dialect quirk, a target-only kind), it belongs in the target. The principle gives reviewers a clean axis to decide.

### What this costs

- **A fuzzy edge: when does an affordance become specific enough to belong in the family?** The principles point in different directions at the boundary. Example: a "column has a native-type concept" — is that a framework affordance (`SchemaNode` carries it) or a SQL-family affordance (`SqlColumn` carries it) or a target specific (`PostgresColumn.nativeType`)? The current decision is "target specific" because Mongo's collection field shape has no `nativeType`. But that decision is judgement, not a derivation from the principle. The project's working rule (subject to refinement): the framework only ships the affordance if *every* family needs it; the family only ships the abstract base if every target in the family needs it; otherwise the target ships it. The rule is conservative — adding an affordance later is cheaper than removing one — but it is not mechanical. Reviewers exercise judgement at the boundary.
- **Discipline cost on framework changes.** Anyone proposing a framework change must answer "does this preserve the principle?" before landing. That is a real cognitive load on framework PRs, and one some changes will fail the first time they are reviewed.
- **Mental model investment.** The principle is more abstract than "Thin core, fat targets" alone. Adopting it requires reading this ADR (or one of its reference instances) and internalising the affordance/specifics distinction. The pay-off is that contributors can *generate* design decisions consistent with the principle, rather than copying patterns from existing code without understanding why the patterns work.

### What this rules out

- **Framework-side target awareness.** Branches on target identity in framework code (`if (target === 'postgres')`) violate principle 1 and have been ruled out independently (`.cursor/rules/no-target-branches.mdc`). The principle states the *why*.
- **Target-specific consumer interfaces.** A framework consumer that wants to walk an IR must do so through a framework SPI (`SchemaVerifier<TContract, TSchema>`), never through a concrete target class. This is principle 2 in operational form.
- **"Innovate everywhere" target authoring.** A target author can innovate on what their target ships (target-only kinds, target-specific fields, target-specific rendering), but not on the *shape* the framework imposes (kind discriminant, JSON-canonical fields, namespace coordinate). This is a structural commitment, not a style guide.

## Alternatives considered

- **State only "Thin core, fat targets" and rely on convention.** The status quo. Rejected: the surface guidance is correct but underspecified; it produces correct copy-paste behaviour but does not equip contributors to derive new patterns. The Supabase exploration ran into exactly this — the team kept asking "where does this RLS thing belong?" and the answer required tribal knowledge that this ADR is intended to make explicit.
- **State the principles only in subsystem docs, not in the architecture overview.** Rejected: subsystem docs are read by people working in one subsystem; the principles are cross-cutting and surface in every subsystem. Architecture Overview is the right altitude.
- **State the principles as one principle, not two.** Earlier draft tried fusing them: "the framework's job is to make targets predictable". Rejected: the two principles point in different directions in places (principle 1 is about *who implements what*; principle 2 is about *what consumers can assume*). Keeping them separate lets reviewers route questions to the right principle without conflating them.
- **Defer naming the principles to the Supabase project.** Rejected: this project introduces the IR convention that operationalises both principles. Naming them here, while the convention is being designed, surfaces design tension at the cheapest moment. Deferring would mean Supabase has to re-derive the convention's *why* on its way to extending the *how*.
- **Use a different term than "affordance".** Considered "abstraction" and "scaffold". Rejected: "abstraction" is too generic (everything in software is an abstraction); "scaffold" implies a temporary shape removed later. "Affordance" carries the specific connotation — the framework provides a shape that *invites* the target to fall into the right pattern. The term is borrowed deliberately from UI/UX vocabulary; the analogy is intentional.

## Open questions (for the close-out promotion)

- **The affordance/specifics boundary inside the family — addressed by M2-M4.** The fuzzy-edge cost above. The project exercised the boundary multiple times: Mongo Storage (M2), the SPI dispatch surface (M2.5), the entities mechanism (M3.5), enums (M4). The working rule the project lands on: the framework only ships the affordance if *every* family needs it; the family only ships the abstract base if every target in the family needs it OR if a single consumer dispatches polymorphically on it (the M4 `SqlEnumType` case earns the abstract via dispatch rather than ≥2 sibling targets); otherwise the target ships it. Reviewers still exercise judgement at the boundary; the rule narrows the question rather than mechanising it. Close-out promotion should fold this sharpening into the Decision § text.
- **Relationship between principle-2 fluency and target-specific content.** A developer fluent in Postgres reading Mongo for the first time: are they "fluent in another" because the framework affordances carry, or are they re-learning the document model? The principle is honest about the *form* carrying; it does not promise that *all content* transports. Close-out promotion should sharpen the wording — "fluent in another's architecture" rather than "fluent in another", perhaps — alongside the close-out re-reading after PR2 lands the namespace exemplar.
- **Relationship to "Thin core, fat targets".** This ADR enriches the existing principle. The PR1 docs sweep (`docs/Architecture Overview.md` § Guiding Principles) keeps "Thin core, fat targets" intact and adds the two new principles alongside; the new principles capture the *why* the existing principle leaves implicit. Close-out should confirm this is the steady state rather than collapse the three principles into a smaller set.
- **Naming and ADR number.** This ADR is drafted as "architectural principles". Candidates for the permanent name: "Architectural principles underwriting the 3-layer IR convention" (long but accurate), "Affordances and cross-target consistency" (shorter, less context-laden). The permanent name should be picked at close-out alongside the 3-layer convention ADR's permanent name so the two read as a pair.
