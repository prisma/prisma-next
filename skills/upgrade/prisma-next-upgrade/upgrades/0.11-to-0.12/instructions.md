---
from: "0.11"
to: "0.12"
changes:
  - id: replace-verify-with-verify-marker
    summary: |
      The SQL runtime's `verify: { mode; requireMarker }` option is removed; replaced by `verifyMarker?: 'onFirstUse' | false` (default `'onFirstUse'`). The runtime no longer throws on contract-marker drift — instead it emits a structured `warn`-level log line once per runtime instance and proceeds with the query. Callers that previously caught `CONTRACT.MARKER_MISMATCH` to detect deploy-skew migrate to log scraping (filter on `code: 'CONTRACT.MARKER_MISMATCH'` / `code: 'CONTRACT.MARKER_MISSING'` from the runtime's `Log.warn` sink) or invoke the explicit `db-verify` CLI for fail-fast verification.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "verify:"
        - "requireMarker"
      anyMatch: false
  - id: remove-capabilities-from-define-contract
    summary: |
      The `capabilities` field on the first argument of `defineContract({...}, ...)` is removed. Capabilities are now contributed automatically by extension packs and target components; declaring them by hand is no longer accepted and the contract builder will refuse the literal. Delete the `capabilities: { ... }` block from every `defineContract` call site, then re-emit your contract artefacts (`pnpm emit`, which runs `prisma-next contract emit`) to refresh `contract.json` / `contract.d.ts`. The regenerated artefacts pick up the contributor-declared capabilities — including two new ones in the 0.12 line, `postgres.distinctOn` and `sql.lateral`, which extensions contribute on your behalf when their pack is in `extensionPacks`.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "defineContract"
        - "capabilities:"
      anyMatch: false
---

# 0.11 → 0.12 — User upgrade instructions

## `replace-verify-with-verify-marker`

Starting at the 0.12 release, the SQL runtime's marker-verification API is simplified. The previous `verify: { mode; requireMarker }` option carried two concerns — *when* to verify and *whether to throw on absent markers* — both of which leaked internal implementation detail into the public API. The new option is a single discriminated union: `verifyMarker?: 'onFirstUse' | false`, with `'onFirstUse'` as the default.

The runtime's response to contract-marker drift also changes. Previously the runtime threw `CONTRACT.MARKER_MISMATCH` (or `CONTRACT.MARKER_MISSING`) on every query when the database's contract hash didn't match the runtime's. From 0.12 onward, the runtime emits a structured `warn`-level log line **once per runtime instance** and proceeds with the query. The intent is to make rolling deploys safe by default: a drifted-but-running app surfaces the warning loudly without crashing every query for the duration of the deploy window.

### Migration

Walk every call site that constructs a SQL runtime via `createRuntime(...)` or the convenience wrappers (`sqlite(...)`, `postgres(...)`, `postgresServerless(...)`).

For each call site that passes `verify: {...}`:

- `verify: { mode: 'onFirstUse', requireMarker: false }` → `verifyMarker: 'onFirstUse'` (or simply omit the option — `'onFirstUse'` is the default).
- `verify: { mode: 'onFirstUse', requireMarker: true }` → `verifyMarker: 'onFirstUse'`. The `requireMarker: true` semantics (throw on absent marker) is removed; if you need fail-fast verification, use the `db-verify` CLI command at deploy time instead of relying on the runtime to crash.
- `verify: { mode: 'always', requireMarker: ... }` → `verifyMarker: 'onFirstUse'`. The `'always'` mode (re-verify on every query) is dropped; verification is now once-per-runtime regardless of mode. The CLI `db-verify` command remains the explicit-verification surface.
- `verify: { mode: 'startup', requireMarker: ... }` → `verifyMarker: 'onFirstUse'`. The `'startup'` mode is dropped for the same reason — without the throw-on-mismatch semantic, the `'startup'` vs `'onFirstUse'` distinction collapsed to "same behaviour, different timing." Verification fires lazily on the first `execute()` call.
- If you explicitly want to skip marker verification entirely (e.g. during a known-skewed deploy window where contract drift is expected and tolerated): `verifyMarker: false`.

### Before 0.12

```ts
const runtime = createRuntime({
  stackInstance,
  context,
  driver,
  verify: { mode: 'onFirstUse', requireMarker: false },
});

try {
  for await (const row of runtime.execute(plan)) {
    // ...
  }
} catch (err) {
  if (err.code === 'CONTRACT.MARKER_MISMATCH') {
    // deploy-skew detected — crash and let the orchestrator restart us
    process.exit(1);
  }
  throw err;
}
```

### Starting at 0.12

```ts
const runtime = createRuntime({
  stackInstance,
  context,
  driver,
  log: {
    info: console.info,
    warn: (payload) => {
      console.warn(payload);
      if (
        payload.code === 'CONTRACT.MARKER_MISMATCH' ||
        payload.code === 'CONTRACT.MARKER_MISSING'
      ) {
        // optional: forward to your observability surface
        sendToTelemetry(payload);
      }
    },
    error: console.error,
  },
  // verifyMarker omitted — 'onFirstUse' is the default
});

for await (const row of runtime.execute(plan)) {
  // ...
}
```

The runtime now does not crash on drift — it emits one structured log line per runtime instance, then proceeds. Operators who want fail-fast verification at deploy time (rather than as a per-runtime diagnostic) should invoke the `db-verify` CLI as part of their deployment pipeline.

### Type-level change

The `RuntimeVerifyOptions` type is removed from `@prisma-next/sql-runtime` exports; replaced by `VerifyMarkerOption = 'onFirstUse' | false`. Any consumer code that imports `RuntimeVerifyOptions` will fail to compile after the bump.

```diff
-import type { RuntimeVerifyOptions } from '@prisma-next/sql-runtime';
+import type { VerifyMarkerOption } from '@prisma-next/sql-runtime';
```

### Validation

After applying the rule above, run `pnpm typecheck && pnpm test` (or your application's equivalent). The change is mechanical: TypeScript flags every `verify: {...}` call site as a type error after the bump, and every `RuntimeVerifyOptions` import similarly. Once those errors are resolved, the behaviour change (warn-log instead of throw on drift) shows up only at runtime when a marker mismatch actually occurs.

## `remove-capabilities-from-define-contract`

Starting at the 0.12 release, the `capabilities` field on the first argument of `defineContract({...}, ...)` is removed. Capabilities are now contributed automatically by the target's components and the extension packs you load via `extensionPacks: { ... }`; the contract builder will refuse a literal `capabilities` key. Hand-declaring capabilities was redundant with — and frequently drifted from — the contributor-declared set, so the authoring surface drops the field outright.

Two consumer-visible consequences:

- **Source change**: delete the `capabilities: { ... }` block from every `defineContract` call site.
- **Emitted artefacts**: the regenerated `contract.json` / `contract.d.ts` will pick up the contributor-declared capabilities. In the 0.12 line, two new capability keys land automatically — `postgres.distinctOn` and `sql.lateral` — when the matching adapter / target component is in the contract's component graph.

### Before 0.12

```ts
import { defineContract } from '@prisma-next/postgres/contract-builder';
import { pgvector } from '@prisma-next/pgvector';

export const contract = defineContract(
  {
    extensionPacks: { pgvector },
    capabilities: {
      postgres: {
        lateral: true,
        jsonAgg: true,
        returning: true,
        'pgvector.cosine': true,
      },
    },
  },
  ({ field, model }) => {
    // … model definitions …
  },
);
```

### Starting at 0.12

```ts
import { defineContract } from '@prisma-next/postgres/contract-builder';
import { pgvector } from '@prisma-next/pgvector';

export const contract = defineContract(
  {
    extensionPacks: { pgvector },
  },
  ({ field, model }) => {
    // … model definitions …
  },
);
```

If your first argument becomes `{}` after the deletion (the only field it carried was `capabilities`), simplify to `defineContract({}, ({ field, model }) => { … })`. TypeScript flags any remaining `capabilities:` key on a `defineContract` call as an excess-property error after the bump, so every affected site is pinpointed at compile time.

### Re-emit your contract

After updating the source, regenerate the emitted artefacts so the new contributor-declared capabilities land in `contract.json` and `contract.d.ts`:

```bash
pnpm emit
# (runs `prisma-next contract emit` under the hood)
```

You should see capability keys appear in the regenerated `contract.json` — for SQL targets, expect `postgres.distinctOn: true` and `sql.lateral: true` to show up if your contract uses the matching adapter / extensions.

### Validation

After applying the rule above, run `pnpm typecheck && pnpm test` (or your application's equivalent). The change is mechanical and TypeScript pinpoints every affected call site; the regenerated `contract.json` diff confirms the capabilities flowed through unchanged.
