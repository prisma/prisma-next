---
name: Descriptor Manifest as Serialized View
status: draft
owners:
  - framework
  - cli
  - sql-family
---

# Descriptor Manifest as Serialized View

## Summary

Today, framework component descriptors (family/target/adapter/driver/extension) carry a nested `manifest: ExtensionPackManifest`. This is convenient because `packs/manifest.json` is the serialized artifact, but it conflates the *component model* with its *distribution mechanism* (“pack”).

This plan proposes an end-state where:

- The **descriptor is canonical**: it owns the declarative fields directly (`version`, `capabilities`, `types`, `operations`, `targets`, …).
- The **manifest is a serialized view** of those descriptor fields.
- At system boundaries responsible for hydration, we are **strict**: if a manifest exists and does not match the descriptor’s declarative fields, we abort immediately.
- After hydration, **downstream code should not depend on manifests**; it should operate on descriptors/instances.

## Goals

- Model “framework components” without embedding “pack” semantics into the core descriptor model.
- Reduce reliance on `ExtensionPackManifest` in internal code paths (SQL family assembly, emitter, etc.).
- Establish a single place (“hydration boundary”) where requirements are validated and manifest-vs-descriptor mismatches are detected.

## Non-goals

- Build a general-purpose module loader for user environments.
- Implement hosted/cloud preflight module loading (registry-based resolution) now.
- Change the current extension pack JSON schema format (`packs/manifest.json`) in this slice.

## Definitions

- **Component descriptor**: the thing we compose the framework from. Includes identity, compatibility IDs, declarative capabilities/types/operations, and plane-specific factories/hook surfaces.
- **Manifest**: a **pure JSON** representation of the *declarative subset* of a descriptor intended for disk/registry/preflight uses.
- **Hydration boundary**: the system boundary responsible for producing a hydrated descriptor from either:
  - user-provided module exports (default local environment), or
  - platform-owned registry/module resolution (future hosted preflight).

## Current State (today)

- `@prisma-next/contract/framework-components` defines `ComponentDescriptor` with `manifest: ExtensionPackManifest`.
- Many code paths consume `descriptor.manifest.*` directly:
  - SQL family assembly (`operations`, `types.{codecTypes,operationTypes,storage}`, …)
  - CLI pack loading and config validation
  - target/adapter/driver/extension descriptors load JSON and assign `manifest: ...`

## Target State (end goal)

### 1) Descriptor owns the declarative fields

Descriptor types directly expose the semantic declarations that are currently nested under `manifest`:

- `id`, `kind`, and for target-bound components: `familyId`, `targetId`
- declarative fields (serializable):
  - `version`
  - `targets?`
  - `capabilities?`
  - `types?` (including `codecTypes`, `operationTypes`, and family-specific type metadata like `storage`)
  - `operations?`

Plane-specific descriptor interfaces add non-serializable behavior:

- Control plane: `hook`, `migrations?`, control factories (`create(url)` etc.)
- Runtime plane: runtime factories (`create(options)` etc.)

### 2) Manifest is a projection

Treat manifest as a projection:

- `serializeDescriptorToManifest(descriptor) -> ExtensionPackManifest`
- `assertManifestMatchesDescriptor(manifest, descriptor) -> void` (throws on mismatch)

Implementation note: the manifest can remain structurally identical to today’s `ExtensionPackManifest` for now; the key change is that it’s no longer threaded through internal code paths.

### 3) Hydration boundary rules

In all environments:

- Hydration resolves **requirements** → **descriptor**.
- We validate that the resolved descriptor satisfies the contract’s requirements.
- If a manifest is present (from disk/registry), we strictly verify it matches the descriptor declarations, and abort immediately on mismatch.

Two environments:

- **User-owned module loading (local)**:
  - User provides hydrated descriptor exports (via config imports).
  - Manifest is optional; internal flow should not require it.
- **Platform-owned module loading (hosted preflight)**:
  - Platform resolves requirements via registry.
  - Manifest is used for selection/validation and must match the loaded descriptor.

## Migration Plan (incremental)

1. **Introduce “declarative fields” on descriptors**
   - Add `version`, `capabilities`, `types`, `operations`, `targets` fields directly to shared descriptor types.
   - Keep `manifest` temporarily if needed for a staged migration (avoid breaking downstream code immediately).

2. **Move internal consumers off `descriptor.manifest.*`**
   - SQL family assembly should read `descriptor.operations`, `descriptor.types`, etc.
   - Emitter and other tooling should use the descriptor fields, not `ExtensionPackManifest`.

3. **Update concrete component descriptors**
   - Targets/adapters/drivers/extensions should hydrate descriptor declarations from `packs/manifest.json` by spreading/mapping into descriptor fields.
   - Keep JSON parsing/validation close to the boundary responsible for loading.

4. **Constrain manifest usage to boundaries**
   - CLI pack-loading stays as a boundary utility.
   - Add a strict `assertManifestMatchesDescriptor` call in the boundary that loads both.

5. **Remove `manifest` from the shared component descriptor model**
   - Once all internal consumers are migrated, remove `descriptor.manifest` from `@prisma-next/contract/framework-components`.
   - Adjust config validation to validate descriptor declarative fields directly.

6. **Update tests**
   - Update any tests that construct `{ manifest: ExtensionPackManifest }` objects.
   - Keep manifest parsing tests only where manifest parsing is still a boundary responsibility.

## Open Questions

- Contract requirements: should they be strictly `id@version` only, or also include capability keys? (Likely yes, capability keys are required for capability-gated features.)
- Which fields are “declarative” and must match manifest exactly vs fields that can be derived? (Default: everything serialized must match.)


