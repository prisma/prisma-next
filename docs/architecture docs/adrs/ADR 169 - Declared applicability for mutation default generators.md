# ADR 169 — Declared applicability for mutation default generators

## Context

Prisma Next supports **execution-time mutation defaults** via `execution.mutations.defaults` (ADR 158). These defaults reference generators by stable ids (for example `cuid2`, `uuidv4`), and the execution plane fills in omitted values during mutations.

We need a system-wide way to answer:

- For a given generator (or default function), **which column types does it apply to?**

This question matters for authoring surfaces and tooling:

- Vocabulary-driven authoring (PSL, and future declarative sources) must be able to validate applicability deterministically.
- TS-first authoring can remain permissive (escape hatches), but would benefit from optional validation and “suggest available defaults for this column” ergonomics.
- Runtime needs a consistent way to resolve generator ids to implementations, including extension-provided generators, without hardwiring behavior into one package.

## Problem

Historically, mutation default generators were imported and passed into TS column builders. We wanted to validate that a generator’s output is compatible with the backing column/codec.

One explored approach was to infer compatibility by reasoning about:

- SQL column type vs generator output type
- TypeScript types vs codec `encode` input types

In practice this becomes complicated quickly (type-level reasoning across codecs, dialect facets, parameterization, and narrowing), and risks producing brittle or misleading validation.

We want a simpler, deterministic approach that:

- avoids complex compatibility inference,
- keeps extension seams aligned with “compose, don’t configure”, and
- supports multiple authoring surfaces without special-casing PSL.

## Design constraints

- **No executable code in contracts**: contracts store references (ids), not implementations (ADR 158).
- **Deterministic, inspectable validation**: applicability rules must not depend on ad-hoc inference.
- **Composable**: extension packs should be able to add generators/default vocabulary without changing core/provider code.
- **Escape hatches remain**: TS-first authoring must remain able to express application-specific generators and defaults.

## Decision

### 1) Compatibility is declared, not inferred

We treat generator/column compatibility as **declared applicability** supplied by the generator contributor, not as something the system infers via type comparisons.

Contributors provide applicability metadata sufficient to validate “this generator id is valid for this column descriptor”.

For this slice, applicability is keyed by `codecId` only.

### 2) Introduce a component-composed generator registry (execution-time)

Runtime resolves generator ids through a registry assembled from the composed runtime stack (target/adapter/extension packs).

- Built-ins are provided via normal component contributors (for example adapter/target contributors), not implicit runtime fallback wiring.
- Packs can add additional generator ids.

Missing generator ids referenced by a contract are a stable, targeted runtime error.

### 3) Introduce a component-composed lowering vocabulary registry (emit-time)

Emit-time lowering for default functions uses a composed registry of handlers that:

- define supported vocabulary (names + argument rules), and
- lower to either:
  - storage defaults (`storage.tables.*.columns.*.default`), or
  - execution mutation defaults (`execution.mutations.defaults` with `{ kind: "generator", id, params? }`).

Applicability is declared on generator descriptors and checked during authoring via `codecId`.

Duplicate default-function names and duplicate generator ids are hard errors during assembly.

This registry is the primary mechanism for vocabulary-driven authoring surfaces to validate defaults deterministically.

PSL authoring packages consume this registry as an input; assembly ownership lives in composition layers (for example SQL family/control orchestration), not in PSL provider/interpreter packages.

### 4) Preserve TS-first escape hatches (opt-in validation)

TS-first authoring may express:

- registry-backed generators (eligible for applicability validation), and
- application-specific overrides for a specific column (may bypass applicability validation intentionally).

This is not a guided UX path; it is an explicit “trust me” contract authoring decision. When used, the author must still provide a runtime implementation for any referenced generator ids through lower-level runtime wiring (e.g. a runtime extension pack).

### 5) Keep generator metadata single-sourced and contributor-owned

Generator-owned storage-shape metadata (including parameterized behavior such as `nanoid(size)`) is defined once in contributor-owned metadata and reused across:

- TS authoring helper construction,
- emit-time generator descriptors consumed by PSL interpretation.

Runtime generator implementations remain contributor-owned and are resolved only through composed runtime contributors.

## Consequences

### Benefits

- **Deterministic validation** without brittle type inference.
- **Composable extensibility**: packs can add generators and default vocabulary through the same composition seams as other runtime behavior.
- **Reusable metadata**: future tooling can answer “what defaults are available for this column?” using the registry’s declared applicability.
- **Authoring-surface neutrality**: PSL is a consumer, not the driver; the data structures are system-wide.

### Costs

- **Contributor responsibility**: applicability must be declared correctly; misdeclared applicability can yield runtime failures or incorrect assumptions.
- **Registry assembly surface**: contributors must avoid duplicate ids/names because collisions fail assembly deterministically.
- **Migration work**: move from “hardwired maps” (e.g. ids) to “composed registry contributors” incrementally.

### Risks and mitigations

- **Incorrect applicability declarations**:
  - Mitigation: conformance tests, pack-level tests, and (where feasible) runtime “encode probe” validation for built-ins (optional; not required by this ADR).
- **Collision/override ambiguity**:
  - Mitigation: fail fast with deterministic hard errors for duplicate names/ids.

## Related ADRs

- ADR 158 — Execution mutation defaults
- ADR 112 — Target Extension Packs
- ADR 150 — Family-Agnostic CLI and Pack Entry Points
- ADR 155 — Driver Codec Boundary and Lowering Responsibilities
- ADR 113 — Extension function & operator registry (adjacent pattern: registry as extension seam)

