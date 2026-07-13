# Brief: D7 R2 (resumed) — /runtime descriptor authorized; build the example

Orchestrator decision on your product-gap halt (specs amended per I12, visible in project spec § Non-goals and slice spec § Chosen design): **option (a)** — D7's scope extends into the extension package for exactly your proposed unblock:

1. `packages/3-extensions/better-auth/src/runtime/descriptor.ts` — `betterAuthRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'>` mirroring pgvector/supabase (id `'better-auth'` = pack id, `codecs: () => []`, version from package.json). **Descriptor only — no facade, no wrapped Db** (the amended non-goal's substance).
2. `src/exports/runtime.ts` + `./runtime` in package.json `exports` + tsdown entry.
3. Tests: descriptor id equals pack id; assignability into `postgres({ extensions })`; aggregate-contract construction test from your scratch repro (that's the "fails iff" surface).

Own commit for the package change, then proceed with the full original D7 brief (`07-example-app.md`) unchanged — `examples/better-auth` with `db.ts` doing `postgres<Contract>({ contractJson, url, extensions: [betterAuthRuntimeDescriptor] })`, honestly documented in the README.

Gates: original D7 gates + better-auth package build/test/typecheck/lint (the /runtime addition) + `pnpm lint:deps`. Time-box: fresh 90 min. Halt conditions from the original brief still stand.
