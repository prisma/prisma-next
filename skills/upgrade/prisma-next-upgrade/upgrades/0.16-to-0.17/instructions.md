---
from: "0.16"
to: "0.17"
changes:
  - id: error-codes-renamed-to-dotted-namespace-subcode
    summary: |
      Every published error code is renamed from numeric `PN-DOMAIN-NNNN` to a dotted
      `NAMESPACE.SUBCODE` name (e.g. `PN-CLI-4001` → `CONFIG.FILE_NOT_FOUND`,
      `PN-RUN-3001` → `CONTRACT.MARKER_MISSING`, `PN-MIG-CHECK-004` →
      `MIGRATION.CHECK_DANGLING_REF`), and migration-runner `Result` failure codes gain
      the `MIGRATION.` prefix (`'PRECHECK_FAILED'` → `'MIGRATION.PRECHECK_FAILED'`).
      The full old→new crosswalk is in
      `docs/architecture docs/adrs/ADR 239 - Errors are structural envelopes with dotted namespace codes.md`.
      Update any code, script, or CI matcher that branches on an old code string.
      The JSON error envelope no longer carries a `domain` field (the namespace prefix
      is the category), and the `CliErrorDomain` type is deleted. Expected structured
      failures now exit 2 (user-abort 3); exit 1 is reserved for internal errors —
      update shell scripts that branch on exit 1 for expected failures.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,sh,yml,yaml}"
      contains:
        - "PN-CLI-"
        - "PN-RUN-"
        - "PN-MIG-"
        - "PN-CON-"
        - "PN-SCHEMA-"
      anyMatch: true
---

<!--
Error consolidation (TML-3067 / ADR 239): the examples/ touch is
`examples/prisma-next-postgis-demo/test/utils/test-database.ts` — one test
assertion updated from a numeric code to its dotted name. The change the
recipe above covers is the code rename itself; the example diff is that
rename applied, not a separate surface change.
-->
