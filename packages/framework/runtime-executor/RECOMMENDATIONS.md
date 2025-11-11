# Recommendations

## Observations
- Package currently exports nothing; runtime-core logic still lives inside `@prisma-next/runtime`.
- Without real code here, lane packages cannot start depending on a target-neutral runtime SPI.

## Suggested Actions
- Move plan verification, marker handling, plugin orchestration, and telemetry recording into this package per Slice 6.
- Define and export the runtime SPI interfaces so family runtimes can implement them.
- Add the mock-family smoke test here to ensure runtime-core stays target-agnostic.

