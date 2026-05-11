# Deferred / non-goals

Explicit list of things we've decided are **not** part of the Supabase integration work, with a one-line reason each. The point is to keep scope honest: a future reader can check whether their idea is here before proposing it.

## Out of v0.1 scope

- **Realtime support.** Supabase Realtime is a separate subsystem (WebSocket-based change feed); not on the v0.1 path. Decision recorded upstream from when this work started.
- **Storage API.** `storage.*` tables are visible via the externally-managed contract, but uploading/managing storage objects is not a database concern. We don't ship file-upload helpers.
- **`@supabase/supabase-js` parity for non-DB features.** Auth flows (sign in, password reset), edge functions, etc. — outside Prisma Next's remit.
- **Introspection-based emit of the Supabase contract.** We hand-author the shipped `contract.json` for v0.1. An emitter that introspects a Supabase Postgres database is plausible follow-up work, not v0.1.
- **`prisma-next adopt --from-database` introspection.** Same family of work as above; needed for users migrating from existing Supabase apps. Likely the next obvious project after this one.
- **Identity providers other than Supabase.** Auth0, Clerk, custom auth, JWT-from-anywhere. The posture/cross-contract-ref/RLS machinery built here is reusable for these (they'd each become their own extension package), but they're not v0.1 targets.
- **Typed `m.sql\`...\`` template tag for RLS predicates.** Plain strings only for v0.1. The typed template tag is real future polish; it's not on this project's critical path.
- **Visibility / encapsulation between contract spaces.** All extension contract spaces are visible to app contracts. Tooling-level "this extension's internals are private" controls are a future concern; for v0.1 every extension is fully visible.
- **Cross-contract-space FKs in PSL.** TS surface ships; PSL surface is deferred pending design work on the PSL `extension <name> from "<pkg>"` import grammar. App authors who need PSL can use the TS builder for the affected models in the interim.
- **Cascading actions across contract spaces.** Permitted at the DDL level (Postgres allows it), but we don't ship a polished UX around `ON DELETE CASCADE` from app tables into externally-managed extension tables. Users can write the SQL clause; the framework won't help reason about it.
- **Pre-canned RLS policy patterns.** "Owner can read/write" policy helpers, "public read, owner write" helpers, etc. Tempting but premature; we ship the raw API and revisit after user feedback.
- **Per-column posture.** Posture inherits from parent table. No per-column override in v0.1.
- **`drift` posture in v0.1.** Possibly drop to ship only `modeled / tolerated / externally-managed` if the design pressure pushes that way. Decided when we settle the spec; the four-posture story is the working assumption.

## Carried by TML-2459 (not redone here)

To prevent confusion about where work lives:

- Polymorphic 3-layer IR (framework / family / target).
- `Namespace` as a first-class framework concept.
- Authoring DSL for namespace declarations and per-model namespace assignment.
- Cross-namespace FKs **within a single contract space** (`m.constraints.ref(otherModel)`).
- `ContractSerializer` SPI; removal of `validateContract`.
- The `Target<TContract, TSchema>` aggregator interface.

If your concern is on this list, it's the IR project's problem, not this one's.

## Carried by other Linear tickets (not redone here)

- **TML-2397 / TML-2398 — Contract spaces machinery.** The aggregate-loading, contract-publish-and-consume pipeline. Cross-contract refs depend on this; we don't redo it.
- **TML-2457 / TML-2463 / TML-2408 / TML-2458 / TML-2464.** Various contract-spaces tickets sequenced relative to TML-2459 (see TML-2459's plan for sequencing). The Supabase project sits on top of all of them.
