# Recommendations

## Observations
- `src/canonicalization.ts` (~250 LOC) interleaves JSON normalization, hashing, and manifest validation logic, making it difficult to reuse parts independently.
- Target-family hooks sit alongside canonicalization, increasing the risk of leaking SQL-specific assumptions.
- Edge cases (duplicate extension names, invalid manifests) have limited automated coverage.

## Suggested Actions
- Split canonicalization, hashing, and manifest validation into separate modules so target families can reuse them selectively.
- Document the target hook SPI (inputs, expected outputs) and enforce it via TypeScript interfaces.
- Add tests covering malformed manifests, duplicate extension entries, and hash determinism.

