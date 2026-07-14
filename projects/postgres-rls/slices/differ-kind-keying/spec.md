# Slice: the schema differ pairs siblings by node kind, not by a globally-unique id

Status: ready — TML-3008, branch `slice/differ-nodekind-keying`
Kind: orphan substrate slice — sibling of the postgres-rls tickets, not a sub-issue.
Blocks: PR #950 (`slice/rls-policy-operations-and-roles`) rebases onto this and deletes its sigil + `withCleanRoleMessage`.

## The problem

The generic SQL schema differ (`diffSchemas`, `packages/1-framework/1-core/framework-components/src/control/schema-diff.ts`) walks two schema-IR trees and pairs a node against whatever occupies the same structural position on the other side. It reaches nodes through `DiffableNode` (`{ id; isEqualTo; children() }`), a lossy projection that exposes only a bare `id`. `diffChildren` keys a parent's children into one flat `Map<string, DiffableNode>` on `node.id` and **throws on any duplicate id among siblings** (`insertNode`, line 29).

That uniqueness requirement is wrong. `PostgresDatabaseSchemaNode.children()` returns `[...namespaces, ...roles]` (postgres-database-schema-node.ts:51) — two **distinct kinds of child in distinct slots**. A role named `public` and a namespace named `public` are different objects that are never paired against each other, but `children()` concatenates every slot into one undifferentiated list, so the two `public`s collide in the flat map and the differ throws.

Everything downstream is a workaround for that lost slot information:

- The role node folds a `role:` **sigil** into its `id` (postgres-role-schema-node.ts:26, 52) so it can't collide with a namespace id.
- The sigil then leaks into the issue path, so `withCleanRoleMessage` (postgres/.../diff-database-schema.ts:28, 142) rewrites the issue message to strip it.

## The fix (settled)

Give the differ the per-node discriminant it needs, so it pairs siblings by `(nodeKind, id)` instead of `id` alone. A role `public` and a namespace `public` no longer collide because their `nodeKind`s differ; `insertNode` throws only on a genuine same-kind-same-id duplicate.

**Field name is `nodeKind`, not `kind`** (correcting brief #2): `SqlSchemaIRNode` already carries `kind = 'sql-schema-ir'` — a *family-level* discriminator identical for every SQL node (sql-schema-ir-node.ts:25, 39). Keying on that `kind` would collapse to id-only and would NOT fix the collision. The per-node discriminant is `nodeKind` (`abstract readonly nodeKind: string` on the base, line 35), which every SQL node already declares. So surfacing `nodeKind` on the walkable interface is **zero change for every SQL node**.

Consequences that land in the same change (they are the point):

- **Delete the `role:` sigil** — `PostgresRoleSchemaNode.id` returns the bare `name`.
- **Delete `withCleanRoleMessage`** — with no sigil, there is nothing to launder.
- **Stop baking a message on the issue.** `SchemaDiffIssue.message` is populated everywhere by `pathMessage(path)`, and the differ's own comment (schema-diff.ts:37) says turning the diff into a human sentence is the renderer's job. `message` has exactly **one** real consumer — sqlite `operations/tables.ts:212` (`issues.map(i => i.message).join('; ')`). Remove `message` from `SchemaDiffIssue`; that one consumer renders its own string from `path`/`reason`.

## Interface: keep `DiffableNode` unified (settled)

Add required `readonly nodeKind: string` to `DiffableNode`. SQL nodes satisfy it for free — they already declare `nodeKind`. `MongoSchemaIRNode` also `implements DiffableNode` and gains `nodeKind` too.

Do **not** split the interface into a narrow payload bound + a walkable bound. Mongo will be moved onto this same generic diff walk later, so its conformance is **not** dead weight to shed — it is forward-looking, and its `nodeKind` is a real down payment on that convergence. Mongo nodes therefore get a **genuine per-node `nodeKind`** (each concrete node declares its own literal — collection / index / validator / options / …, matching the SQL pattern), not one shared constant that would mislead the later convergence. Mongo's diff *algorithm* is untouched in this slice; only the nodes gain the field.

## Why ids no longer need to be globally unique

Within one slot ids are already unique by construction — you cannot declare two roles named `public`, two namespaces named `public`, or two columns named `id` on one table. Cross-slot reuse (a role and a namespace both `public`) is legal and now harmless. No node ever folds its slot/kind into its id string again.

## Scope

- In: the generic differ (`diffSchemas`/`diffChildren`/`insertNode`), the `DiffableNode` interface (gains `nodeKind`), `SchemaDiffIssue.message` removal, the `role:` sigil, `withCleanRoleMessage`, the sqlite `message` consumer, `nodeKind` on the Mongo nodes, the differ unit tests, CLI verify output tests where the sigil appeared in a path segment, and the schema-diff ADR.
- Out: Postgres RLS behavior (#950's job), the planner (verify/diff-shape only — no migration op moves), Mongo's diff *algorithm* (untouched — nodes gain `nodeKind`, the walk is unchanged), verify verdict grading (`DiffSubjectGranularity` — that is the separate granularity-deletion slice).

## Acceptance criteria

1. The differ pairs siblings by `(nodeKind, id)`; a same-name/different-kind sibling pair (role `public` + namespace `public`) diffs without throwing; a genuine same-kind/same-id duplicate still throws.
2. `PostgresRoleSchemaNode.id` is the bare role name; the `role:` sigil constant is gone.
3. `withCleanRoleMessage` is gone; role issue paths carry the bare name.
4. `SchemaDiffIssue` no longer carries `message`; the sole sqlite consumer renders its own string.
5. Every existing sibling pairing is unchanged — no existing pairing was id-globally-unique-dependent except the role/namespace case this fixes.
6. The schema-diff ADR is amended: nodes carry `nodeKind`; the differ keys on `(nodeKind, id)`; sibling ids need only per-kind uniqueness; nodes never encode kind into their id. (Its rejection of keying on the *contract* `EntityCoordinate` stays — that is a different domain.)

## Definition of done

- All AC met; the sigil, `withCleanRoleMessage`, and `SchemaDiffIssue.message` are deleted.
- Full CI gate green: `pnpm build`, forced typecheck, whole Lint job, `fixtures:check`, all three suites, multi-space guards.
- **Byte-identity proven** by a golden `plan()` diff (base-vs-HEAD real planner output, unchanged) plus the verify verdict suites — not `fixtures:check` alone. This is verify/diff-shape only; no migration operation moves.
- PR opened; merge order coordinated so this lands before #950 rebases.
