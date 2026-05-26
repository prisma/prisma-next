# Changelog

All notable changes to `@prisma-next/sqlite` will be documented in this file.

## [Unreleased]

### Breaking

**`verify` → `verifyMarker`** (TML-2680). `RuntimeVerifyOptions = { mode; requireMarker }` is removed; replaced by `verifyMarker?: 'onFirstUse' | false` (default `'onFirstUse'`). The runtime no longer throws `CONTRACT.MARKER_MISMATCH` on contract-marker drift; instead it emits a structured `warn`-level log line once per runtime and proceeds with the query. Callers that previously caught `CONTRACT.MARKER_MISMATCH` to detect deploy-skew must migrate to log scraping (filter on `code: 'CONTRACT.MARKER_MISMATCH'` / `code: 'CONTRACT.MARKER_MISSING'` from the runtime's `Log.warn` sink), or invoke the explicit `db-verify` CLI for fail-fast verification.

Migration:

```diff
- verify: { mode: 'onFirstUse', requireMarker: false }
+ verifyMarker: 'onFirstUse'   // or omit; this is the default

- verify: { mode: 'always', requireMarker: true }
+ verifyMarker: 'onFirstUse'   // 'always' is dropped; throw-on-mismatch
+                              // is no longer supported (drift now logs
+                              // a warning and queries proceed).
```

See TML-2682 for the in-flight follow-up that threads a `log` option through the SQL convenience wrappers, so operators using `sqlite()` / `postgres()` / `postgresServerless()` can observe the warnings.
