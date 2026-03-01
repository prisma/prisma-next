# Contract PSL Parser Plan

## Summary

Build a reusable PSL parser in `@prisma-next/psl-parser` that parses Prisma schema text into a deterministic AST with source spans and stable diagnostics. This milestone establishes the parser boundary needed by PSL-first emit and future language tooling while enforcing strict errors for unsupported constructs.

**Spec:** `projects/psl-contract-authoring/specs/Milestone 2 - PSL parser.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | William Madden | Owns implementation and rollout |
| Reviewer | Framework/tooling reviewer (TBD) | Reviews parser API and diagnostics contracts |
| Collaborator | SQL authoring owner (TBD) | Confirms referential action parity with TS authoring |

## Milestones

### Milestone 1: Parser API + deterministic diagnostics

Deliver a public parser surface that accepts schema text plus source identifier and returns AST + diagnostics with stable spans and codes.

**Tasks:**

- [x] Define parser AST, span, and diagnostic types in `@prisma-next/psl-parser`.
- [x] Implement `parsePslDocument({ schema, sourceId })` returning deterministic node ordering and stable diagnostics ordering.
- [x] Implement strict error behavior for unsupported constructs (no warning path).
- [x] Add unit tests for parser success/failure and deterministic ordering.

### Milestone 2: v1 PSL subset coverage + verification

Implement the v1 construct set from the feature spec and verify acceptance criteria with targeted tests and package documentation updates.

**Tasks:**

- [x] Parse models, scalar fields, required/optional modifiers, enums, and relation fields.
- [x] Parse supported attributes: `@id`, `@unique`, `@@unique`, `@@index`.
- [x] Parse `@relation(fields, references)` plus referential actions (same supported set as TS authoring).
- [x] Parse defaults: `autoincrement()`, `now()`, and supported literal defaults.
- [x] Parse `types { ... }` declarations and type references.
- [x] Add diagnostics tests that assert stable code + span + message for invalid/unsupported inputs.
- [x] Update `packages/1-framework/2-authoring/psl-parser/README.md` with package responsibilities, API, dependencies, architecture diagram, and links.
- [x] Verify all acceptance criteria in the feature spec and record follow-up items for downstream normalization milestone.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Parser returns AST with spans for representative v1 schemas | Unit | Milestone 1 + 2 | Golden-style fixtures for models/enums/types |
| Invalid PSL produces diagnostic with precise span and clear message | Unit | Milestone 1 + 2 | Assert code/message/span tuple |
| Unsupported PSL constructs fail with strict errors | Unit | Milestone 1 | No warn/fallback mode |
| Unit tests cover success and failure diagnostics (including spans) | Unit | Milestone 1 + 2 | Include deterministic ordering checks |

## Open Items

- Confirm the single source-of-truth module for referential action support so parser and normalization share one mapping.
