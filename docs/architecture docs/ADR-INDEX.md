# ADR Index

This document provides a comprehensive index of all Architectural Decision Records (ADRs) for the Prisma Next prototype, organized by category and ADR number.

## Core Architecture

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 001 | Migrations as Edges | Defines migrations as contract-to-contract transitions rather than sequential SQL files | [ADR 001 - Migrations as Edges.md](adrs/ADR%20001%20-%20Migrations%20as%20Edges.md) |
| 002 | Plans are Immutable | Establishes Plans as immutable, auditable objects with contract hash and references | [ADR 002 - Plans are Immutable.md](adrs/ADR%20002%20-%20Plans%20are%20Immutable.md) |
| 003 | One Query One Statement | Ensures Plans map to single SQL statements for predictability and guardrails | [ADR 003 - One Query One Statement.md](adrs/ADR%20003%20-%20One%20Query%20One%20Statement.md) |
| 004 | Storage Hash vs Profile Hash | Separates storage identity hashing (`storageHash`) from pinned capability profile hashing (`profileHash`) | [ADR 004 - Storage Hash vs Profile Hash.md](adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) |
| 005 | Thin Core Fat Targets | Keeps core minimal while pushing target-specific behavior into adapters | [ADR 005 - Thin Core Fat Targets.md](adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) |
| 140 | Package Layering & Target-Family Namespacing | Establishes ring-based package layout and per-family namespaces; introduces target-agnostic runtime core and family runtimes | [ADR 140 - Package Layering & Target-Family Namespacing.md](adrs/ADR%20140%20-%20Package%20Layering%20%26%20Target-Family%20Namespacing.md) |
| 150 | Family-Agnostic CLI and Pack Entry Points | Config-only CLI, /cli vs /runtime entrypoints, family helpers + TargetFamilyHook | [ADR 150 - Family-Agnostic CLI and Pack Entry Points.md](adrs/ADR%20150%20-%20Family-Agnostic%20CLI%20and%20Pack%20Entry%20Points.md) |

## Contract & Schema

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 006 | Dual Authoring Modes | Supports both PSL-first and TS-first authoring with identical canonical artifacts | [ADR 006 - Dual Authoring Modes.md](adrs/ADR%20006%20-%20Dual%20Authoring%20Modes.md) |
| 007 | Types Only Emission | Emits only TypeScript declarations, no runtime client code generation | [ADR 007 - Types Only Emission.md](adrs/ADR%20007%20-%20Types%20Only%20Emission.md) |
| 008 | Dev Auto Emit CI Explicit Emit | Removes explicit generate step in development via plugins, requires explicit emit in CI | [ADR 008 - Dev Auto Emit CI Explicit Emit.md](adrs/ADR%20008%20-%20Dev%20Auto%20Emit%20CI%20Explicit%20Emit.md) |
| 009 | Deterministic Naming Scheme | Establishes consistent naming patterns for constraints to ensure stable emission | [ADR 009 - Deterministic Naming Scheme.md](adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md) |
| 010 | Canonicalization Rules | Defines exact key ordering and normalization rules for deterministic contract hashing | [ADR 010 - Canonicalization Rules.md](adrs/ADR%20010%20-%20Canonicalization%20Rules.md) |
| 021 | Contract Marker Storage | Defines database storage for contract identity verification and alignment checks | [ADR 021 - Contract Marker Storage.md](adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md) |
| 042 | Contract Marker Evolution | Specifies marker table schema evolution and forward-compatible field additions | [ADR 042 - Contract Marker Evolution.md](adrs/ADR%20042%20-%20Contract%20Marker%20Evolution.md) |
| 156 | Storage sets and check constraints | Adds `storage.sets` and a minimal `checks[]` shape to express “column value is in this set” explicitly in storage | [ADR 156 - Storage sets and check constraints.md](adrs/ADR%20156%20-%20Storage%20sets%20and%20check%20constraints.md) |
| 159 | Definition-only contracts and separate TypeMaps for lane typing | Keeps contracts stack-independent and traversable; keeps runtime-real structural mappings on the runtime contract value; exports codec/operation type maps as a separate `TypeMaps` type (not part of `Contract`) | [ADR 159 - Definition-only contracts and type-only codec-operation maps.md](adrs/ADR%20159%20-%20Definition-only%20contracts%20and%20type-only%20codec-operation%20maps.md) |
| 163 | Provider-invoked source interpretation packages | Keeps parsing/interpretation logic in provider-invoked authoring packages so CLI/control plane stay source-agnostic and IO-free | [ADR 163 - Provider-invoked source interpretation packages.md](adrs/ADR%20163%20-%20Provider-invoked%20source%20interpretation%20packages.md) |
| 167 | Typed default literal pipeline and extensibility | Documents typed literal default flow across authoring/emission/verification/rendering and records deferred codec-keyed SPI follow-up | [ADR 167 - Typed default literal pipeline and extensibility.md](adrs/ADR%20167%20-%20Typed%20default%20literal%20pipeline%20and%20extensibility.md) |

## Query System

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 011 | Unified Plan Model | Establishes common Plan structure across all query lanes with AST, SQL, and metadata | [ADR 011 - Unified Plan Model.md](adrs/ADR%20011%20-%20Unified%20Plan%20Model.md) |
| 012 | Raw SQL Escape Hatch | Provides safe raw SQL execution with required annotations and verification | [ADR 012 - Raw SQL Escape Hatch.md](adrs/ADR%20012%20-%20Raw%20SQL%20Escape%20Hatch.md) |
| 013 | Lane Agnostic Plan Identity | Ensures Plan identity and hashing work consistently across all query lanes | [ADR 013 - Lane Agnostic Plan Identity.md](adrs/ADR%20013%20-%20Lane%20Agnostic%20Plan%20Identity.md) |
| 162 | Kysely lane emits PN SQL AST | Kysely authoring compiles to plans with PN-native QueryAst + refs so runtime plugins can inspect structure lane-agnostically | [ADR 162 - Kysely lane emits PN SQL AST.md](adrs/ADR%20162%20-%20Kysely%20lane%20emits%20PN%20SQL%20AST.md) |
| 165 | ORM WhereArg literal normalization | Records Phase 2 decision to validate bound ToWhereExpr payloads then normalize ParamRef values into literals at ORM boundaries | [ADR 165 - ORM WhereArg literal normalization.md](adrs/ADR%20165%20-%20ORM%20WhereArg%20literal%20normalization.md) |
| 018 | Plan Annotations Schema | Defines canonical JSON schema for Plan annotations and validation rules | [ADR 018 - Plan Annotations Schema.md](adrs/ADR%20018%20-%20Plan%20Annotations%20Schema.md) |
| 019 | TypedSQL as Separate CLI | Establishes TypedSQL as out-of-tree tool that emits Plan factories | [ADR 019 - TypedSQL as Separate CLI.md](adrs/ADR%20019%20-%20TypedSQL%20as%20Separate%20CLI.md) |
| 020 | Result Typing Rules | Defines how DSL and ORM compute result types from projections and joins | [ADR 020 - Result Typing Rules.md](adrs/ADR%20020%20-%20Result%20Typing%20Rules.md) |
| 025 | Plan Caching Memoization | Establishes Plan caching strategy with memoization and invalidation | [ADR 025 - Plan Caching Memoization.md](adrs/ADR%20025%20-%20Plan%20Caching%20Memoization.md) |

## Runtime & Execution

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 014 | Runtime Hook API | Defines composable hook system for Plan lifecycle events and plugin integration | [ADR 014 - Runtime Hook API.md](adrs/ADR%20014%20-%20Runtime%20Hook%20API.md) |
| 015 | ORM as Optional Extension | Establishes ORM layer as optional extension built on core DSL primitives | [ADR 015 - ORM as Optional Extension.md](adrs/ADR%20015%20-%20ORM%20as%20Optional%20Extension.md) |
| 016 | Adapter SPI for Lowering | Defines stable adapter interface for SQL lowering and dialect-specific behavior | [ADR 016 - Adapter SPI for Lowering.md](adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md) |
| 030 | Result decoding & codecs registry | Establishes codec registry for type-safe result decoding and parameter encoding | [ADR 030 - Result decoding & codecs registry.md](adrs/ADR%20030%20-%20Result%20decoding%20&%20codecs%20registry.md) |
| 031 | Adapter capability discovery & negotiation | Defines capability discovery and negotiation flow between adapters and runtime | [ADR 031 - Adapter capability discovery & negotiation.md](adrs/ADR%20031%20-%20Adapter%20capability%20discovery%20&%20negotiation.md) |
| 155 | Driver/Codec boundary and lowering responsibilities | Separates lowering vs codec encoding/decoding vs driver transport; standardizes codec↔driver boundary values as `string \| Uint8Array \| null` | [ADR 155 - Driver Codec Boundary and Lowering Responsibilities.md](adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md) |
| 157 | Execution enums | Defines execution-plane enum behavior derived from explicit storage enforcement; builds on ADR 155 and ADR 156 | [ADR 157 - Execution enums.md](adrs/ADR%20157%20-%20Execution%20enums.md) |
| 158 | Execution mutation defaults | Defines execution-plane mutation defaults (`execution.mutations.defaults`) and a section-owned hashing model to avoid marker churn | [ADR 158 - Execution mutation defaults.md](adrs/ADR%20158%20-%20Execution%20mutation%20defaults.md) |
| 168 | Postgres JSON and JSONB typed columns | Adds first-class PostgreSQL `json`/`jsonb` codec and column support with Standard Schema-based typed emission in `contract.d.ts` | [ADR 168 - Postgres JSON and JSONB typed columns.md](adrs/ADR%20168%20-%20Postgres%20JSON%20and%20JSONB%20typed%20columns.md) |
| 160 | Plan grouping keys for multi-statement orchestration | Adds `meta.groupingKey` to correlate multiple statement executions that serve one higher-level operation | [ADR 160 - Plan grouping keys for multi-statement orchestration.md](adrs/ADR%20160%20-%20Plan%20grouping%20keys%20for%20multi-statement%20orchestration.md) |
| 164 | Repository Layer | Defines `@prisma-next/sql-orm-client` as a multi-query orchestration surface in the extensions integrations layer | [ADR 164 - Repository Layer.md](adrs/ADR%20164%20-%20Repository%20Layer.md) |

## Migration System

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 028 | Migration Structure & Operations | Defines migration file structure, on-disk formats, schemas, and operations for working with migration DAGs | [ADR 028 - Migration Structure & Operations.md](adrs/ADR%20028%20-%20Migration%20Structure%20%26%20Operations.md) |
| 037 | Transactional DDL Fallback | Specifies fallback behavior when adapters lack full transactional DDL support | [ADR 037 - Transactional DDL Fallback.md](adrs/ADR%20037%20-%20Transactional%20DDL%20Fallback.md) |
| 038 | Operation idempotency classification & enforcement | Defines idempotency classification and enforcement for migration operations | [ADR 038 - Operation idempotency classification & enforcement.md](adrs/ADR%20038%20-%20Operation%20idempotency%20classification%20&%20enforcement.md) |
| 039 | DAG path resolution & integrity | Specifies DAG path computation, cycle detection, and deterministic tie-breaking | [ADR 039 - DAG path resolution & integrity.md](adrs/ADR%20039%20-%20DAG%20path%20resolution%20&%20integrity.md) |
| 040 | Node task execution environment & sandboxing | Defines execution environment and sandboxing for migration node tasks | [ADR 040 - Node task execution environment & sandboxing.md](adrs/ADR%20040%20-%20Node%20task%20execution%20environment%20&%20sandboxing.md) |
| 041 | Custom operation loading via local packages + preflight bundles | Establishes custom operation loading with security constraints and bundle support | [ADR 041 - Custom operation loading via local packages + preflight bundles.md](adrs/ADR%20041%20-%20Custom%20operation%20loading%20via%20local%20packages%20+%20preflight%20bundles.md) |
| 043 | Advisory lock domain & key strategy | Defines advisory locking strategy for migration coordination and collision prevention | [ADR 043 - Advisory lock domain & key strategy.md](adrs/ADR%20043%20-%20Advisory%20lock%20domain%20&%20key%20strategy.md) |
| 044 | Pre & post check vocabulary v1 | Establishes vocabulary and patterns for migration operation pre/post checks | [ADR 044 - Pre & post check vocabulary v1.md](adrs/ADR%20044%20-%20Pre%20&%20post%20check%20vocabulary%20v1.md) |
| 154 | Component-owned database dependencies | Sets component-owned verification as the target architecture; v1 uses adapter-owned ID-presence checks as a temporary compromise | [ADR 154 - Component-owned database dependencies.md](adrs/ADR%20154%20-%20Component-owned%20database%20dependencies.md) |
| 161 | Explicit foreign key constraint and index configuration | Adds two independent knobs (`foreignKeys.constraints`, `foreignKeys.indexes`) to control FK constraint and FK-backing index emission in migration DDL | [ADR 161 - Explicit foreign key constraint and index configuration.md](adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md) |
| 166 | Referential actions for foreign keys | Adds optional `onDelete` / `onUpdate` action semantics to foreign keys and Postgres planner DDL emission (`ON DELETE` / `ON UPDATE`) | [ADR 166 - Referential actions for foreign keys.md](adrs/ADR%20166%20-%20Referential%20actions%20for%20foreign%20keys.md) |

## Preflight & CI

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 022 | Lint Rule Taxonomy | Defines taxonomy and classification system for lint rules and violations | [ADR 022 - Lint Rule Taxonomy.md](adrs/ADR%20022%20-%20Lint%20Rule%20Taxonomy.md) |
| 023 | Budget Evaluation | Establishes query budget evaluation and enforcement mechanisms | [ADR 023 - Budget Evaluation.md](adrs/ADR%20023%20-%20Budget%20Evaluation.md) |
| 024 | Telemetry Schema | Defines telemetry schema and privacy controls for runtime observability | [ADR 024 - Telemetry Schema.md](adrs/ADR%20024%20-%20Telemetry%20Schema.md) |
| 029 | Shadow DB preflight semantics | Specifies shadow database semantics for preflight validation and testing | [ADR 029 - Shadow DB preflight semantics.md](adrs/ADR%20029%20-%20Shadow%20DB%20preflight%20semantics.md) |
| 051 | PPg preflight-as-a-service contract | Defines PPg preflight-as-a-service contract with server-side validation | [ADR 051 - PPg preflight-as-a-service contract.md](adrs/ADR%20051%20-%20PPg%20preflight-as-a-service%20contract.md) |

## Extensions & Packs

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 017 | Extension Compatibility Policy | Establishes compatibility policy for extensions and alternate runtimes | [ADR 017 - Extension Compatibility Policy.md](adrs/ADR%20017%20-%20Extension%20Compatibility%20Policy.md) |
| 104 | PSL extension namespacing & syntax | Defines namespaced PSL extension syntax and mapping to contract JSON | [ADR 104 - PSL extension namespacing & syntax.md](adrs/ADR%20104%20-%20PSL%20extension%20namespacing%20&%20syntax.md) |
| 105 | Contract extension encoding | Specifies canonical extension section structure in contract JSON | [ADR 105 - Contract extension encoding.md](adrs/ADR%20105%20-%20Contract%20extension%20encoding.md) |
| 106 | Canonicalization for extensions | Defines deterministic normalization rules for extension data | [ADR 106 - Canonicalization for extensions.md](adrs/ADR%20106%20-%20Canonicalization%20for%20extensions.md) |
| 112 | Target Extension Packs | Establishes extension pack model as versioned, installable modules | [ADR 112 - Target Extension Packs.md](adrs/ADR%20112%20-%20Target%20Extension%20Packs.md) |
| 113 | Extension function & operator registry | Defines function and operator registry for extension capabilities | [ADR 113 - Extension function & operator registry.md](adrs/ADR%20113%20-%20Extension%20function%20&%20operator%20registry.md) |
| 114 | Extension codecs & branded types | Establishes codec model and branded types for extension values | [ADR 114 - Extension codecs & branded types.md](adrs/ADR%20114%20-%20Extension%20codecs%20&%20branded%20types.md) |
| 115 | Extension guardrails & EXPLAIN policies | Defines guardrails and EXPLAIN policies for extension operations | [ADR 115 - Extension guardrails & EXPLAIN policies.md](adrs/ADR%20115%20-%20Extension%20guardrails%20&%20EXPLAIN%20policies.md) |
| 116 | Extension-aware migration ops | Specifies extension-aware migration operations and capability gating | [ADR 116 - Extension-aware migration ops.md](adrs/ADR%20116%20-%20Extension-aware%20migration%20ops.md) |
| 117 | Extension capability keys | Defines canonical capability keys and reserved namespaces | [ADR 117 - Extension capability keys.md](adrs/ADR%20117%20-%20Extension%20capability%20keys.md) |
| 118 | Bundle inclusion policy for packs | Establishes bundle inclusion policy and security constraints for packs | [ADR 118 - Bundle inclusion policy for packs.md](adrs/ADR%20118%20-%20Bundle%20inclusion%20policy%20for%20packs.md) |
| 121 | Contract.d.ts structure and relation typing | Complete specification for Tables, Models, and Relations namespaces with proper relation field typing | [ADR 121 - Contract.d.ts structure and relation typing.md](adrs/ADR%20121%20-%20Contract.d.ts%20structure%20and%20relation%20typing.md) |
| 126 | PSL top-level block SPI | Defines SPI for packs to register new top-level blocks (views, enums, etc.) with parsing, validation, and deterministic emission | [ADR 126 - PSL top-level block SPI.md](adrs/ADR%20126%20-%20PSL%20top-level%20block%20SPI.md) |
| 153 | Extension Package Naming Convention | Standardizes on `extension-*` prefix exclusively for extension pack npm names | [ADR 153 - Extension Package Naming Convention.md](adrs/ADR%20153%20-%20Extension%20Package%20Naming%20Convention.md) |

## Adapters & Targets

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 065 | Adapter capability schema & negotiation v1 | Defines adapter capability schema and negotiation protocol | [ADR 065 - Adapter capability schema & negotiation v1.md](adrs/ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md) |
| 068 | Error mapping to RuntimeError | Establishes stable mapping from engine/driver errors to RuntimeError envelope | [ADR 068 - Error mapping to RuntimeError.md](adrs/ADR%20068%20-%20Error%20mapping%20to%20RuntimeError.md) |

## Development & Tooling

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 026 | Conformance Kit Certification | Defines conformance testing levels and certification requirements | [ADR 026 - Conformance Kit Certification.md](adrs/ADR%20026%20-%20Conformance%20Kit%20Certification.md) |
| 027 | Error Envelope Stable Codes | Establishes stable error codes and envelope structure for consistent error handling | [ADR 027 - Error Envelope Stable Codes.md](adrs/ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md) |
| 032 | Dev Auto Emit Integration | Specifies development tool integration for automatic contract emission | [ADR 032 - Dev Auto Emit Integration.md](adrs/ADR%20032%20-%20Dev%20Auto%20Emit%20Integration.md) |
| 034 | Raw Plan factory manifest | Defines optional manifest for raw Plan factories with metadata | [ADR 034 - Raw Plan factory manifest.md](adrs/ADR%20034%20-%20Raw%20Plan%20factory%20manifest.md) |
| 035 | Dual authoring conflict resolution | Specifies conflict resolution when both PSL and TS authoring exist | [ADR 035 - Dual authoring conflict resolution.md](adrs/ADR%20035%20-%20Dual%20authoring%20conflict%20resolution.md) |

## No-Emit Workflow

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 096 | TS-authored contract parity & purity rules | Ensures TS-authored contracts produce identical artifacts to PSL-first mode | [ADR 096 - TS-authored contract parity & purity rules.md](adrs/ADR%20096%20-%20TS-authored%20contract%20parity%20&%20purity%20rules.md) |
| 097 | Tooling runs on canonical JSON only | Ensures tools consume canonical JSON artifacts, not TS source code | [ADR 097 - Tooling runs on canonical JSON only.md](adrs/ADR%20097%20-%20Tooling%20runs%20on%20canonical%20JSON%20only.md) |
| 098 | Runtime accepts contract object or JSON | Defines runtime API for accepting both TS objects and JSON artifacts | [ADR 098 - Runtime accepts contract object or JSON.md](adrs/ADR%20098%20-%20Runtime%20accepts%20contract%20object%20or%20JSON.md) |
| 099 | Contract authoring lint rules | Establishes ESLint rules for preventing non-deterministic contract authoring | [ADR 099 - Contract authoring lint rules.md](adrs/ADR%20099%20-%20Contract%20authoring%20lint%20rules.md) |
| 100 | CI contract emission trust model | Defines sandbox and trust model for TS evaluation in CI environments | [ADR 100 - CI contract emission trust model.md](adrs/ADR%20100%20-%20CI%20contract%20emission%20trust%20model.md) |

## Migration Advisors

| ADR | Title | Description | Link |
|-----|-------|-------------|------|
| 101 | Advisors Framework | Establishes uniform API for computing and surfacing migration advisories | [ADR 101 - Advisors Framework.md](adrs/ADR%20101%20-%20Advisors%20Framework.md) |
| 102 | Squash-first policy & squash advisor | Defines policy for keeping migration DAGs small through regular baselines | [ADR 102 - Squash-first policy & squash advisor.md](adrs/ADR%20102%20-%20Squash-first%20policy%20&%20squash%20advisor.md) |
| 122 | Database Initialization & Adoption | Covers greenfield, brownfield-conservative, and brownfield-incremental adoption strategies including introspection, multi-service namespacing, and incremental contract expansion | [ADR 122 - Database Initialization & Adoption.md](adrs/ADR%20122%20-%20Database%20Initialization%20%26%20Adoption.md) |
| 123 | Drift Detection, Recovery & Reconciliation | Comprehensive drift taxonomy (marker, schema, DAG, capability, transactional, cache, canonicalization), detection mechanisms, and recovery strategies with idempotency patterns | [ADR 123 - Drift Detection, Recovery & Reconciliation.md](adrs/ADR%20123%20-%20Drift%20Detection%2C%20Recovery%20%26%20Reconciliation.md) |

## Notes

- **ADR 051** covers PPg preflight-as-a-service contract
- **ADRs 104-118** form the core extension system architecture (decorators, attributes, capabilities, packs)
- **ADRs 126-127** introduce PSL top-level blocks and views as composable extensions
- **ADRs 096-100** cover the no-emit workflow for TypeScript-authored contracts

## Related Documentation

- [Architecture Overview](../Architecture%20Overview.md) - High-level system architecture
- [Subsystem Specifications](subsystems/) - Detailed subsystem documentation
- [Extensions Glossary](../reference/extensions-glossary.md) - Extension terminology reference
- [Capabilities Reference](../reference/capabilities.md) - Capability keys and namespaces
