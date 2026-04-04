# ADR 183 — SPI types live at the lowest consuming layer

## Context

Prisma Next's package architecture enforces a strict layer hierarchy: **foundation → core → authoring → tooling → runtime**. Packages may only import from their own layer or lower layers. When an SPI (Service Provider Interface) — an interface implemented by higher-layer packages but consumed by lower-layer orchestration code — is colocated with its implementation, the orchestration code cannot depend on it without creating an upward layer violation.

Before this decision, emission SPI types (`TargetFamilyHook`, `ValidationContext`, etc.) lived in `@prisma-next/contract`. This forced the contract package to depend on `@prisma-next/operations` (for `OperationRegistry` in `ValidationContext`), making the contract a non-leaf package with framework-domain coupling.

## Problem

Where should SPI interfaces live in a layered architecture?

The intuitive placement — colocating interfaces with their implementations — breaks when:
1. Multiple packages at different layers need the interface (orchestration code consumes it, family-specific packages implement it).
2. The interface references types from packages that the ideal host shouldn't depend on.

## Constraints

- Layer violations are enforced by `lint:deps` and cannot be bypassed.
- The contract package should be a leaf in the foundation layer with no framework-domain dependencies.
- Emission SPI types are consumed by control-plane orchestration (core layer) and implemented by family-specific emitters (tooling layer).

## Decision

**SPI interfaces live in the lowest layer that consumes them, not alongside their implementations.**

Concretely:
- Emission SPI types (`TargetFamilyHook`, `ValidationContext`, `GenerateContractTypesOptions`, `TypeRenderEntry`, `TypeRenderer`, `ParameterizedCodecDescriptor`) live in `@prisma-next/framework-components` (core layer), exported via the `./emission` subpath.
- Family-specific implementations (SQL emitter hook, Mongo emitter hook) in the tooling layer depend on `@prisma-next/framework-components/emission` and implement these interfaces.
- Orchestration code (control-plane emission) depends on `@prisma-next/framework-components/emission` to call into family hooks.

This is the dependency inversion principle applied at the package boundary: high-level orchestration and low-level implementations both depend on abstractions that live at the abstraction's own layer.

## Consequences

- **Contract is a true leaf**: `@prisma-next/contract` has no dependency on `@prisma-next/operations` or any framework-domain package.
- **No upward imports**: Orchestration code imports SPI types from core, not from tooling.
- **Single canonical source**: Each SPI type has exactly one definition; no duplicates across packages.
- **Applies broadly**: The same pattern already governs component descriptors, control-plane types, and execution-plane types in `@prisma-next/framework-components`.
- **Counter-intuitive placement**: Contributors may instinctively want to move SPI types "closer" to their implementations. The framework-components README documents the rationale to prevent this.

## Status

Accepted — implemented in task 5.11 (contract-domain-extraction project).
