# Summary

Today, the system lacks a canonical way to answer a basic question about mutation defaults:

- for a given default function / generator, **which column types does it apply to?**

TS-first authoring can represent essentially arbitrary defaults because it can construct the contract directly; that flexibility is valuable and we want to keep it. But other authoring surfaces (PSL today; other declarative sources in the future) need a **registry-driven vocabulary** that is:

- **typed** (applicability is explicit, not guesswork),
- **composed** from framework components (targets/adapters/packs), and
- **end-to-end** (emit-time lowering and runtime generation agree).

Historically we considered validating generator compatibility by reasoning about “generator output type vs column type” (or SQL type vs TS type). That approach quickly becomes complex and brittle. A simpler, more deterministic approach is **declared applicability**: a framework component that provides a generator also declares which column shapes it applies to.

This follow-up introduces the component-composed registries and declared applicability metadata that make mutation defaults predictable, extensible, and reusable across authoring surfaces and future DX (e.g. “suggest defaults for this column”).

# Description

Milestone 5 introduced registry-driven lowering behavior for PSL default functions, but the effective vocabulary and compatibility rules are not yet fully component-defined. This leaves two gaps:

- We don’t have a system-wide, component-provided source of truth for **default applicability** (which defaults are valid for which columns).
- We don’t have a system-wide, component-provided source of truth for **runtime generation** (how `execution.mutations.defaults` generator ids are implemented).

In TS-first authoring, users can always bypass a vocabulary by emitting explicit contract shapes (and that should remain true). But for vocabulary-driven authoring surfaces, we need explicit applicability rules and runtime generator composition so the system can validate, lower, and execute defaults consistently.

This follow-up adds the missing composition seam in both planes so defaults can be introduced, overridden, and tested through normal component composition:

- **Control plane**: default-function lowering registry is assembled from configured components and passed into PSL interpretation.
- **Execution plane**: mutation default generator implementations are assembled from configured components and used by mutation-default application.

The outcome is one canonical extension path for default behavior across authoring surfaces, contract emission, and runtime execution.

# Proposed design (intended)

## Two coordinated registries

- **Default-function lowering registry (emit-time)**: a composed registry of handlers that:
  - defines the supported function vocabulary (names + arg rules),
  - declares **applicability** to columns (via resolved column descriptor / codec info), and
  - lowers to either storage defaults (`ColumnDefault`) or execution mutation defaults (`ExecutionMutationDefaultValue`).
- **Runtime generator registry (execution-time)**: a composed registry of generator implementations keyed by generator id referenced by `execution.mutations.defaults`.

## Applicability is a control-plane concern

Applicability (“this default function is valid for these columns”) is enforced by the lowering registry. The runtime generator registry is not expected to be keyed by column type; it executes generator ids that were already validated and embedded into the contract.

## Compatibility is declared, not inferred

We do not attempt to infer applicability via type-level reasoning (“generator output type matches codec input type”). Instead, generator contributors declare applicability explicitly (for example: supported `codecId`s, and optionally additional constraints/predicates over column descriptors).

This makes validation and UX deterministic:

- vocabulary-driven surfaces (PSL initially) can validate without any complex reasoning
- TS-first authoring can optionally validate against the same declared applicability when using registry-backed generators
- future DX can surface “available generators for this column” directly from the registry metadata

## Escape hatches remain available (TS-first)

TS-first authoring remains free to emit arbitrary contract defaults (including custom generator ids) as an escape hatch.

Important nuance: a TS author may want to attach an application-specific generator to a specific column even when it is not part of the registry vocabulary. In that case:

- the author provides the runtime generator implementation through a lower-level composition seam (e.g. a runtime extension pack or other runtime wiring), and
- we may intentionally **omit applicability validation** for that override, treating it as an explicit “trust me” contract authoring decision rather than a guided UX path.

Vocabulary-driven surfaces use the registries for validation and lowering; lower-level authoring can always bypass them intentionally.

# Requirements

## Functional Requirements

- Define a stable contribution interface for component-provided default-function lowering handlers.
  - Handler input includes function name, raw args, source spans, and optional resolved column descriptor.
  - Handler output can produce either a storage `ColumnDefault`, an execution `ExecutionMutationDefaultValue`, or structured diagnostics.
- Define a stable contribution interface for component-provided runtime mutation-default generators.
  - Generators are keyed by generator id referenced by `execution.mutations.defaults`.
  - Missing generator ids at runtime fail with a targeted, stable error.
- Define a stable way for contributors to declare **applicability** (“supported column shapes”) for:
  - default-function lowering handlers (where applicable), and/or
  - generator ids referenced by execution defaults.
- Implement deterministic registry assembly from composed framework components:
  - sources: target, adapter, extension packs composed in `prisma-next.config.ts`
  - deterministic ordering and conflict resolution when duplicate names/ids are contributed
  - explicit behavior for baseline built-ins (always-on baseline vs composed-only)
- Update vocabulary-driven authoring (PSL initially) to consume the assembled default-function registry instead of relying on provider-owned hardcoded vocabulary.
- Update execution mutation default application to resolve generators from the assembled runtime generator registry.
- Preserve existing span-based diagnostics and error categories:
  - unknown default function name
  - invalid argument shape/value for known function
  - missing runtime generator implementation
- Provide a compatibility path so existing Milestone 5 fixtures remain valid, either via baseline parity or a documented mechanical migration.
- Document pack-author ergonomics for contributing:
  - new default-function lowering handlers
  - new runtime generators
  - collision/precedence behavior

## Non-Functional Requirements

- **Determinism:** the same config and inputs produce the same assembled registries and emitted contract artifacts.
- **Layering correctness:** PSL parsing/interpreter stays registry-driven and generic; provider/runtime layers consume assembled registries rather than embedding function-specific branching.
- **Extensibility safety:** contribution APIs are minimal and explicit, with stable diagnostics and predictable conflict handling.
- **Backward compatibility:** existing default-function behavior remains unchanged for current configured baseline scenarios.
- **Testability:** all contribution and conflict paths are fixture/integration-testable without requiring private provider internals.
- **No type-theory validation:** compatibility is validated using declared applicability, not inferred “output type vs column type” reasoning.

## Non-goals

- Expanding PSL default-function syntax.
- Broadly expanding supported default vocabulary beyond the scope needed to prove and validate the composition seam.
- Introducing connector-specific semantics that are not representable in Prisma Next contract/execution models.
- Removing TS-first escape hatches for custom defaults/generators (explicit contract shapes remain allowed).
- Changing unrelated PSL relation/list behavior or broader authoring-surface parity scope.

# Acceptance Criteria

## SPI and Assembly

- A component can contribute a default-function lowering handler through the new SPI, and vocabulary-driven authoring (PSL initially) recognizes it without provider code changes.
- A component can contribute a runtime mutation-default generator implementation through the new SPI, and runtime uses it without runtime hardcoding changes.
- A component can declare applicability for a generator id without implementing bespoke compatibility logic in the authoring surface.
- Registry assembly order and duplicate handling are deterministic and covered by tests.
- The baseline decision (always-on baseline vs composed-only) is implemented and documented.

## Emission and Diagnostics

- Vocabulary-driven emission (PSL initially) uses an assembled registry derived from configured framework components.
- Unknown default function diagnostics remain span-based and use stable diagnostic codes/messages.
- Invalid argument diagnostics remain span-based and use stable diagnostic codes/messages.

## Runtime Behavior

- Runtime mutation-default generation resolves built-in generator ids through the assembled registry (regression guard).
- Runtime mutation-default generation resolves pack-provided generator ids through the assembled registry.
- When a contract references a missing generator id, runtime fails with a clear, stable error.

## Compatibility and Migration

- Existing Milestone 5 parity fixtures pass unchanged, or
- A single documented mechanical migration is applied and all affected fixtures pass after migration.
- Documentation explains where default-function vocabulary comes from and how to extend it through packs.

# Other Considerations

## Security

- No new external trust boundary is introduced; contributors are already composed code in the application boundary.
- Runtime error messages for missing/invalid generators must avoid leaking sensitive runtime values.

## Cost

- Expected cost impact is low. Changes are in compile-time assembly and in-process registry lookup paths.
- Main cost is maintenance/test surface, not infrastructure runtime cost.

## Observability

- Add structured diagnostic metadata to identify function/generator ids and contributor source during failures.
- Ensure logs/errors make conflict resolution decisions inspectable during development.

## Data Protection

- No direct personal-data model changes are introduced.
- Generated defaults must continue to follow existing value-handling rules (no additional data retention or transport behaviors).

## Analytics

- No product analytics changes are required.
- Optional internal telemetry may track registry hit/miss and missing-generator error frequency to guide future hardening.

# References

- Project spec: `projects/psl-contract-authoring/spec.md`
- Follow-up plan: `projects/psl-contract-authoring/plans/Follow-up - Pack-provided mutation default functions registry-plan.md`
- Project plan: `projects/psl-contract-authoring/plan.md`
- Milestone 5 spec: `projects/psl-contract-authoring/specs/Milestone 5 - ID variants and default function parity.spec.md`
- Architecture overview: `docs/Architecture Overview.md`
- Runtime mutation defaults ADR: `docs/architecture docs/adrs/ADR 158 - Execution mutation defaults.md`

# Open Questions

1. Should default-function lowering and runtime generator contribution remain two coordinated SPIs, or be unified into one contribution model?
  **Default assumption:** keep two SPIs with shared naming conventions; they solve different lifecycle concerns (emit-time lowering vs runtime generation).
2. What is the final collision strategy when multiple components provide the same function name or generator id?
  **Default assumption:** deterministic precedence by composition order (later component overrides earlier) with an explicit warning/error mode for ambiguous collisions.
3. Should we keep an always-on baseline built-in registry for backward compatibility, or require all vocabulary to come from composed components?
  **Default assumption:** keep a baseline equivalent to v1 initially, then allow explicit opt-out in a future cleanup slice.

