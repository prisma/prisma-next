# Deferred / non-goals

Explicit list of things we've decided are **not** part of the Supabase integration work, with a one-line reason each. The point is to keep scope honest: a future reader can check whether their idea is here before proposing it.

## Out of v0.1 scope

- **Realtime support.** Supabase Realtime is a separate subsystem (WebSocket-based change feed); not on the v0.1 path. Decision recorded upstream from when this work started.
- **Storage API.** `storage.*` tables are visible via the `external`-control contract, but uploading/managing storage objects is not a database concern. We don't ship file-upload helpers.
- **`@supabase/supabase-js` parity for non-DB features.** Auth flows (sign in, password reset), edge functions, etc. — outside Prisma Next's remit.
- **Introspection-based emit of the Supabase contract.** We hand-author the shipped `contract.json` for v0.1. An emitter that introspects a Supabase Postgres database is plausible follow-up work, not v0.1.
- **`prisma-next adopt --from-database` introspection.** Same family of work as above; needed for users migrating from existing Supabase apps. Likely the next obvious project after this one.
- **Identity providers other than Supabase.** Auth0, Clerk, custom auth, JWT-from-anywhere. The control-policy/cross-contract-ref/RLS machinery is reusable for these (they'd each become their own extension package), but they're not v0.1 targets.
- **Typed `m.sql\`...\`` template tag for RLS predicates.** Plain strings only for v0.1. The typed template tag is real future polish; it's not on this project's critical path.
- **Visibility / encapsulation between contract spaces.** All extension contract spaces are visible to app contracts. Tooling-level "this extension's internals are private" controls are a future concern; for v0.1 every extension is fully visible.
- **Cross-contract-space FKs in PSL.** TS surface ships; PSL surface is deferred pending design work on the PSL `extension <name> from "<pkg>"` import grammar. App authors who need PSL can use the TS builder for the affected models in the interim.
- **Cascading actions across contract spaces.** Permitted at the DDL level (Postgres allows it), but we don't ship a polished UX around `ON DELETE CASCADE` from app tables into externally-managed extension tables. Users can write the SQL clause; the framework won't help reason about it.
- **Pre-canned RLS policy patterns.** "Owner can read/write" policy helpers, "public read, owner write" helpers, etc. Tempting but premature; we ship the raw API and revisit after user feedback.
- **Per-column control override.** Columns inherit their parent table's control policy. No per-column override in v0.1. (Tracked in [ADR 224 § "Alternatives considered"](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md).)
- **`observed` policy in v0.1.** Possibly drop to ship only `managed / tolerated / external` if the design pressure pushes that way. Decided when the control-policy spec is settled; the four-policy story is the working assumption.
- **RPC / Postgres function call surface.** No typed `rpc('fn_name', args)` equivalent. Not a regression from the status quo (users don't have this without Prisma Next either); raw SQL escape hatch is the v0.1 fallback.
- **`CREATE EXTENSION` statements.** Handled by target-specific extension packs (e.g., the existing pgvector extension). Not a Supabase-specific concern.
- **Runtime bound to the aggregate contract (the principled multi-root design).** Admin access to Supabase-internal tables ships as a *secondary root* — `db.asServiceRole().supabase.{sql,orm}`, implemented as two contract-bound runtimes sharing one pool ([decision C15](decisions.md)). That's the pragmatic interim. The principled end state is a single `Runtime` bound to the **aggregate contract** (the composed app + extension contract spaces) that serves all roots natively — and would be the substrate real cross-space querying rides on. Deferred; not v0.1.

## Stretch goals (in-scope if time permits)

- **Postgres triggers and functions as first-class IR.** Enables the canonical "create profile on signup" trigger pattern from the contract DSL instead of raw SQL migrations. Straightforward to model once TML-2459's polymorphic IR lands. See [`overview.md`](overview.md) § "Stretch goals."

## Carried by TML-2459 (not redone here)

To prevent confusion about where work lives:

- Polymorphic 3-layer IR (framework / family / target).
- `Namespace` as a first-class framework concept.
- Authoring DSL for namespace declarations and per-model namespace assignment.
- Cross-namespace FKs **within a single contract space** (via `constraints.foreignKey(cols.x, OtherModel.refs.y, …)` / `rel.belongsTo(OtherModel, …)`).
- `ContractSerializer` SPI; removal of `validateContract`.
- The `Target<TContract, TSchema>` aggregator interface.

If your concern is on this list, it's the IR project's problem, not this one's.

## Carried by the Control Policy project (not redone here)

- `ControlPolicy` enum (`managed | tolerated | external | observed`).
- `control` field on every persisted-object IR node and `defaultControl` at the contract level.
- Verifier and planner dispatch tables.
- Cross-cutting safety check: planner refuses to emit ops into an `external` namespace.

See [ADR 224](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md). Supabase consumes this primitive; it does not introduce it.

## Carried by other Linear tickets (not redone here)

- **TML-2397 / TML-2398 — Contract spaces machinery.** The aggregate-loading, contract-publish-and-consume pipeline. Cross-contract refs depend on this; we don't redo it.
- **TML-2457 / TML-2463 / TML-2408 / TML-2458 / TML-2464.** Various contract-spaces tickets sequenced relative to TML-2459 (see TML-2459's plan for sequencing). The Supabase project sits on top of all of them.
