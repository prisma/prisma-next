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
---

# 0.11 → 0.12 — User upgrade instructions

The `examples/` diff currently in flight also bumps a small group of dev-only Cloudflare-worker tooling (`pkg-pr-new`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `wrangler`) inside `examples/prisma-next-cloudflare-worker`. Those dependencies are confined to the demo app's own dev workflow; downstream Prisma Next consumers are unaffected and do not need to take any action.

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
