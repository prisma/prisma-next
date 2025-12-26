# Recommendations

## Observations
- The package only re-exports `createOperationRegistry` and `register`, so the manifest/pack-driven assembly described in the README is still handled elsewhere and extension authors must re-implement it themselves.
- Tests exercise the bare registry API but never cover manifest validation, capability gating, or pack loading, leaving the manifest contract undocumented and unguarded.
- The README promises operation assembly and lowering specs, yet the package exposes no helpers that interpret `OperationManifestLike` objects or ensure manipulators don’t forget to register capability metadata.

## Suggested Actions
- Implement the manifest assembly helpers here (`toOperationSignature`, `assembleOperationRegistryFromManifests`, etc.) so any target family or runtime can compose extension packs without duplicating logic.
- Document the manifest schema (args, returns, lowering strategy, capability flags) and add guidance on how extension authors should publish and test their manifests.
- Add unit tests that cover manifest validation, capability filtering, duplicate detection, and conversion of real pack manifests into `SqlOperationSignature` instances.
