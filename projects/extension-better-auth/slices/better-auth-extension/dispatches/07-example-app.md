# Brief: D7 example-app

## Task

Ship `examples/better-auth` — a minimal, real app proving the full consumer story **such that** a developer can clone the repo, follow the README verbatim, and reach an authenticated request with no manual SQL and no undocumented steps. Contents: `prisma-next.config.ts` with `extensionPacks: [betterAuthPack]`; an app contract with a `Profile` model carrying a cross-space FK onto the branded `User` handle (`/contract` import); `betterAuth()` configured with `prismaNextAdapter(db)` (email/password enabled); a minimal server exposing BetterAuth's handler plus one authenticated endpoint that reads the session AND joins `Profile → user` through the ORM (demonstrating both directions of the integration); a README documenting the real three-step schema flow — `contract emit` → `migration plan` → `db init` — then run + sign-up + authenticated request (curl-able), following `examples/supabase`'s conventions (structure, scripts, PGlite/dev-database wiring). Include an example-level test (mirroring how sibling examples self-test, e.g. supabase's `test/`) so the example is a regression surface in CI.

Resolve the D6 flag properly: the example's `db` must be constructed over the **app aggregate contract** (which requires the better-auth pack's runtime component wiring) — grep how the supabase example + the D6 harness solved contract-vs-aggregate client construction and do it through the public surface; if the public surface genuinely cannot construct an aggregate-contract client without manual pack plumbing that a real user couldn't discover, HALT and surface (that's a product-gap finding, not something to hack around).

## Scope

**In:** `examples/better-auth/**` (new); workspace registration if examples need it (grep `pnpm-workspace.yaml`); lockfile.

**Out:** the extension package, contract space, `test/integration/**` (bugs found → halt/finding); other examples; docs outside the example's README (D8).

## Completed when

- [ ] Example runs end-to-end per its own README steps (verify by executing them; the example test automates the flow: emit → plan → init → sign-up → authenticated request → Profile↔user join read).
- [ ] Cross-space FK visible: `Profile` in the app contract references the branded `User`; `db init` creates `profile` with the FK onto `"public"."user"(id)`.
- [ ] Gates: example test green + example typecheck + lint; workspace `pnpm typecheck`; `pnpm lint:deps`; `pnpm fixtures:check` (should be untouched — investigate any drift).

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes with a one-line note; drift halts and surfaces.

## References

(Resumed — new context only.)

- Slice plan § D7 (three-step README requirement from D2; the D6 aggregate-client flag).
- Precedent: `examples/supabase/**` (layout, scripts, config, db construction, tests), D2's fixture app (`better-auth-lifecycle` config), D6's e2e test (betterAuth wiring over PGlite).
- Calibration: F5, F14, F12 (README claims must match shipped behaviour — no aspirational steps), grep-library `projects/`-reference scrub (no `projects/…` links in the example).

## Operational metadata

- **Model tier:** mid — assembly against proven patterns; the aggregate-client flag is the one judgment point (halt rule above).
- **Time-box:** 90 min. Overrun → halt with snapshot.
- **Halt conditions:** aggregate-client construction requires non-public plumbing (product gap — surface); any extension-package defect; diff exceeds ~25 files excluding lockfile.
- **Progress notes:** heartbeats at phase transitions.
