# ADR 189 — Structural index matching for MongoDB migrations

## At a glance

The migration planner matches indexes by structure — keys, directions, and options — not by name. Two indexes with different names but identical structure are the same index. This prevents unnecessary drop-and-create cycles when names differ but behavior is identical.

## Context

The migration planner diffs two `MongoSchemaIR` snapshots (see [ADR 187](ADR%20187%20-%20MongoDB%20schema%20representation%20for%20migration%20diffing.md)) to determine which indexes to create and which to drop. It needs a rule for when two indexes are "the same."

MongoDB auto-generates index names from key fields (e.g., `email_1` for `{ email: 1 }`), but users can override them. This creates a question: if the origin has an index named `email_1` on `{ email: 1, unique: true }` and the destination has an index named `idx_users_email` on `{ email: 1, unique: true }`, is that a rename (no-op) or a drop-and-create?

On a large collection, dropping and recreating an index can take minutes and blocks writes during foreground builds. Getting this wrong has real operational consequences.

## Decision

The planner matches indexes structurally. Two indexes are equivalent if and only if they produce the same **lookup key** — a string built from their structurally significant properties:

```ts
function buildIndexLookupKey(index: MongoSchemaIndex): string {
  const keys = index.keys.map((k) => `${k.field}:${k.direction}`).join(',');
  const opts = [
    index.unique ? 'unique' : '',
    index.sparse ? 'sparse' : '',
    index.expireAfterSeconds != null ? `ttl:${index.expireAfterSeconds}` : '',
    index.partialFilterExpression ? `pfe:${JSON.stringify(index.partialFilterExpression)}` : '',
  ]
    .filter(Boolean)
    .join(';');
  return opts ? `${keys}|${opts}` : keys;
}
```

For example:

| Index | Lookup key |
|---|---|
| `{ email: 1 }`, unique | `email:1\|unique` |
| `{ email: 1 }`, not unique | `email:1` |
| `{ lastName: 1, firstName: 1 }` | `lastName:1,firstName:1` |
| `{ createdAt: 1 }`, TTL 86400s | `createdAt:1\|ttl:86400` |

Two indexes with the lookup key `email:1|unique` are equivalent regardless of their names. The planner builds a `Map<string, MongoSchemaIndex>` for both origin and destination, then diffs the key sets:

- Key in destination but not in origin → `createIndex`
- Key in origin but not in destination → `dropIndex`
- Key in both → no-op

This gives O(1) per-index comparison and deterministic results.

## What structural identity includes

Each component matters because it changes the index's behavior:

- **Key fields and order.** `{ a: 1, b: 1 }` and `{ b: 1, a: 1 }` are different compound indexes with different query optimization characteristics. MongoDB treats them as distinct.
- **Direction.** `{ a: 1 }` (ascending) and `{ a: -1 }` (descending) are different indexes. Direction matters for sort-order optimization in compound indexes.
- **`unique`.** A unique index enforces a constraint; a non-unique index does not. Changing uniqueness changes behavior.
- **`sparse`.** A sparse index omits documents missing the indexed field. Changing sparseness changes which documents are indexed.
- **`expireAfterSeconds`.** A TTL index with a 24-hour expiry is different from one with a 7-day expiry.
- **`partialFilterExpression`.** A partial index scoped to `{ status: "active" }` is different from one scoped to `{ status: "archived" }`.

## What structural identity excludes

**Name.** Index names are metadata, not behavior. An index named `email_1` and an index named `idx_users_email` with identical keys and options serve the same purpose — keeping both would be redundant. This follows [ADR 009 (Deterministic Naming Scheme)](ADR%20009%20-%20Deterministic%20Naming%20Scheme.md), which establishes that names are derived metadata, not identity.

## Operation ordering

When the planner produces operations, it emits them in a deterministic order:

1. **Drops** before **creates** — drop obsolete indexes before creating replacements, avoiding transient duplicate indexes.
2. **Lexicographic** within each category — sorted by collection name, then by lookup key.

This ensures identical contracts always produce identical plans.

## Trade-off

Intentional name-only changes cannot be expressed through the planner. If a team wants to rename `email_1` to `idx_users_email` without changing the index's structure, the planner sees a no-op. Achieving the rename requires a hand-authored migration that drops the old name and creates the new one. This is rare — index names are almost never meaningful to application code — and the cost of getting structural matching wrong (unnecessary rebuilds on large collections) is far higher.

## Alternatives considered

### Name-based matching

Match indexes by name: same name = same index, different name = different index. This is simpler to implement but produces worse behavior:

- **Renames cause rebuilds.** Changing an index name would appear as a drop + create, potentially rebuilding a large index and blocking writes. Structural matching correctly treats this as a no-op.
- **Auto-generated names are fragile.** MongoDB's default naming convention (`field_direction`) can differ between driver versions or manual creation. Two identical indexes created in different ways could have different names, causing the planner to emit redundant operations.
- **Names aren't semantically meaningful.** Unlike table or column names in SQL, index names are rarely referenced in application code. They're an implementation detail of the database, not part of the application's contract with the data layer.

### Hybrid matching (name as tiebreaker)

Match by structure first, use name as a tiebreaker when structure is identical. This adds complexity without benefit — if two indexes have identical structure, they're functionally identical regardless of name. There's nothing to "break."
