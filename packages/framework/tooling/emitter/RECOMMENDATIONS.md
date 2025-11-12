# Recommendations

## Observations
- `src/canonicalization.ts` interleaves JSON normalization, hashing, and manifest validation logic, which makes it hard to reuse parts independently and increases the risk of leaking SQL-specific assumptions into other target families.
- The `TargetFamilyHook` SPI is described in README but not enforced at the type level, and the validation helpers throw generic `Error`s without structured hints or codes.
- Edge cases such as duplicate extension names or malformed manifests are only lightly covered by tests, leaving room for silent regressions.

## Suggested Actions
- Split canonicalization, hashing, and manifest validation into separate modules so future target families only depend on the pieces they need without dragging in the entire file.
- Strengthen the hook SPI by exporting an interface that clearly defines the required methods/return types and by wrapping validation errors in structured diagnostics that carry codes/hints.
- Add tests that cover malformed manifests, duplicate extension entries, and canonicalization determinism (e.g., snapshot tests) to guard these critical invariants.
