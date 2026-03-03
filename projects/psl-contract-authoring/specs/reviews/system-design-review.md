## Sources

- Spec: [projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md](../Follow-up%20-%20Pack-provided%20mutation%20default%20functions%20registry.spec.md)
- ADR: [docs/architecture docs/adrs/ADR 169 - Declared applicability for mutation default generators.md](../../../../docs/architecture%20docs/adrs/ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md)
- Review range: `origin/main...HEAD`

## Summary

This change set establishes a clean, end-to-end composition seam for mutation defaults: emit-time PSL lowering uses a composed default-function registry plus declared applicability metadata, and runtime mutation-default execution resolves generator ids through a composed registry (with stable missing-id failures).

## Design alignment with spec / ADR

- **Two coordinated registries**: control-plane “default-function lowering + applicability descriptors” and runtime “generator id → implementation” are represented as two explicit surfaces.
  - Control-plane SPI + assembly: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L10–L589)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:10-589)
  - Runtime registry + lookup + stable missing-id error: [packages/2-sql/5-runtime/src/sql-context.ts (L375–L422)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:375-422)
- **Applicability is declared, not inferred**: PSL checks applicability using declared `applicableCodecIds` rather than any type-level inference.
  - Applicability validation: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L323–L345)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:323-345)
- **Composability**: “built-ins” are provided via normal component descriptors (e.g. Postgres adapter), matching ADR 169’s “no implicit fallback wiring”.
  - Control: [packages/3-targets/6-adapters/postgres/src/exports/control.ts (L10–L17)](../../../../packages/3-targets/6-adapters/postgres/src/exports/control.ts:10-17)
  - Runtime: [packages/3-targets/6-adapters/postgres/src/exports/runtime.ts (L65–L75)](../../../../packages/3-targets/6-adapters/postgres/src/exports/runtime.ts:65-75)
- **Duplicate handling**: assembly fails fast on duplicates (hard errors), per the plan’s locked decision.
  - Control-plane assembly errors: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L537–L577)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:537-577)
  - Family control-plane assembly errors (determinism + collisions): [packages/2-sql/3-tooling/family/src/core/assembly.ts (L255–L283)](../../../../packages/2-sql/3-tooling/family/src/core/assembly.ts:255-283)

## Architecture review

### Control plane: vocabulary + applicability registry

- **Control-plane SPI shape looks minimal and stable**:
  - Handler input includes spans and contextual labels (source/model/field), and exposes `columnCodecId` for future applicability/UX.
  - Handler output is either storage default, execution default, or a structured diagnostic with code+span.
  - SPI types: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L10–L52)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:10-52)
- **PSL is properly registry-driven**: interpreter doesn’t embed function-name branching; it parses `@default(...)` into a call and delegates lowering to the registry.
  - Call parsing + lowering: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L250–L322)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:250-322)
- **Applicability enforcement is localized and deterministic**: check is explicitly “descriptor exists” then “codecId is listed”.
  - Applicability validation: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L323–L345)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:323-345)

### Runtime: generator resolution and safety

- **Registry construction matches the runtime composition model** (target + adapter + extension packs).
  - Registry assembly: [packages/2-sql/5-runtime/src/sql-context.ts (L375–L401)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:375-401)
- **Missing generator behavior is stable and targeted**, which is important for contract/runtime mismatch debugging and safe failures.
  - Stable error: [packages/2-sql/5-runtime/src/sql-context.ts (L403–L422)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:403-422)

### Determinism and composition boundaries

- **Determinism**: the registries are derived from ordered contributor lists and use explicit duplicate detection; the family assembly test ensures deterministic ordering for keys.
  - Test evidence: [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L20–L77)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:20-77)
- **Boundary correctness**: PSL interpreter remains generic; the provider helper is responsible for passing composition state (`frameworkComponents`) into interpretation.
  - Provider wiring: [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L55–L76)](../../../../packages/2-sql/2-authoring/contract-psl/src/provider.ts:55-76)

## Diagnostics and UX

- **Span-based diagnostics preserved** for unknown defaults and invalid args (and new applicability failures).
  - Unknown/default arg diagnostics: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L591–L611)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:591-611)
  - Applicability diagnostics: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L323–L345)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:323-345)
- **Namespace wording** follows the repo preference (“unrecognized namespace … add extension pack …”).
  - Example: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L467–L475)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:467-475)

## Risks / follow-ups (design-level)

- **Registry signature metadata**: unknown-function errors list “supported functions” by enumerating registry keys, but contributed handlers may have non-`()`
signatures. Consider an optional “usage strings” contribution alongside handlers to keep UX accurate for contributed functions.
- **Assembly ownership (clarified expectation)**: `sql-contract-psl` should not own assembly; the composed mutation-default registry should be an **input** to PSL interpretation/provider wiring.
  - Today, `sql-contract-psl` contains assembly helpers (for example `assembleControlMutationDefaults(...)`) and the provider helper assembles from `frameworkComponents` before calling the interpreter.
  - Follow-up: treat `family-sql` (or a control-plane orchestration layer) as the canonical owner of assembly, and keep `sql-contract-psl` focused on **interpretation given registries**.
- **Observability**: current duplicate errors and missing-generator errors include ids, but do not consistently include both “existing owner” and “incoming owner” metadata across planes.
Tightening the meta payload could make conflict resolution more inspectable without changing behavior.

