# Recommendations

## Observations
- The package only exposes the registry and capability helper; there are no helpers for translating manifests or loading extension packs, so each family that wants manifest-aware operations must duplicate that logic.
- The README demonstrates registry usage but doesn’t describe how to express lowering metadata or how capability strings are interpreted, which leaves extension authors guessing.
- Tests cover registry behavior but never cover manifest conversion or packs, so changes to manifest structures risk regressing downstream consumers.

## Suggested Actions
- Add helpers that convert generic `OperationManifest` objects from packs into `OperationSignature`s and assemble registries, so CLI/emitters and runtimes can share the same logic.
- Document the manifest schema (args, returns, lowering strategy, capability keys, duplicates) and how those pieces map to `hasAllCapabilities` and `SqlOperationSignature` fields.
- Extend the tests to cover manifest conversion, capability filtering with nested namespaces, and detection of duplicate method registrations across manifests.
