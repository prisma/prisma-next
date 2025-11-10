# Recommendations

## Observations
- This package is a stub (`src/index.ts` exports nothing) even though multiple slices depend on it for the shared operation registry.
- Without concrete code here, lane packages continue to duplicate registry logic.
- No documentation explains how targets should register operations or declare capabilities.

## Suggested Actions
- Move the shared registry helpers from `@prisma-next/sql-relational-core`/`sql-query` into this package and expose typed APIs.
- Add a README describing the registry SPI and how capability gating works across authoring → runtime.
- Write unit tests covering chaining, capability failures, and lowering metadata to keep future targets safe.

