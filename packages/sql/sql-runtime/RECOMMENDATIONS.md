# Recommendations

## Observations
- Another placeholder; `src/index.ts` exports nothing so runtime logic still lives in `@prisma-next/runtime`.
- Docs do not explain how this package will compose runtime-core once Slice 6 is done.

## Suggested Actions
- Implement the SQL runtime wrapper (wiring codecs, adapters, driver) so consumers can import it directly.
- Document the expected options/context (verify modes, plugins, telemetry) so future targets can mirror the structure.

