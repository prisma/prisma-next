# Migration Sequencing

In this design, migrations are still a linear history of transformations from an empty database to the latest schema, but the ordering and applicability are enforced semantically via from → to hashes instead of by physical order or timestamps.

Here's how it works conceptually:

## 1. Directed graph of contract transitions

Each migration is a node edge:

```
(from.contractHash) ──▶ (to.contractHash)
```

That forms a directed acyclic graph (DAG) of schema states.
In practice, this is usually a single straight line:

```
(empty) → A → B → C → D
```

but the graph structure allows for forks or squashes (e.g., rebase a new branch of schema evolution).

## 2. Sequential traversal emerges automatically

When you run `migrate apply`, the tool:
- Reads the current DB contract hash.
- Finds a migration whose from predicate matches that hash.
- Applies it, which updates the DB to the to hash.
- Repeats until no more applicable migrations exist.

So, order is not determined by file name or timestamp — it's determined by graph traversal:
- You can reorder folders freely.
- Squashes, rebases, or divergent histories are representable.
- Multiple baselines (e.g., "empty" and "legacy import") coexist naturally.

## 3. Why this is better than traditional sequential numbering
- **Deterministic**: No reliance on naming or timestamps to define order.
- **Declarative**: Each migration says what state it expects and produces.
- **Flexible**: You can rebase, squash, or skip branches without renumbering or editing previous migrations.
- **Self-healing**: The system can resolve the correct path based on hashes, even if environments drift or diverge.

## 4. Analogy

Think of it like git for schema contracts:
- Each migration = a commit edge (from → to)
- The current DB = a checked-out commit (hash)
- `migrate apply` = fast-forward merge to target contract

But crucially, it's still a sequence — there's always a deterministic path from (empty → latest), it's just declared explicitly, not assumed implicitly.

The sequence of migration programs is still there, but it's enforced by from → to graph traversal instead of blind iteration.

## A note on safety

One of the nicest properties of the from → to contract model is:
- A squashed "baseline" program has `from: { kind: "empty" }` (or "unknown").
In production, the DB already stores `contract_hash = sha256:<X>`, so it cannot match that from. The apply step simply skips it.
- Normal programs have `from: { kind: "contract", hash: "sha256:<A>" }`.
If prod is at `sha256:<C>`, only a program whose from is `sha256:<C>` is applicable. Everything else is ignored.

So you can't accidentally run "zero → latest" on prod—the applicability predicate won't match.

### Extra guardrails to make this bullet-proof

1. **Strict mode by default in prod**
   In meta.json: `"mode": "strict"`. The runner refuses to execute unless `DB.contract_hash === meta.from.hash`. No "best effort" skipping.

2. **Advisory lock + single session**
   Run migrations under an admin connection with a DB-wide advisory lock so you can't double-apply or overlap with another deploy.

3. **Immutable program checks**
   Verify opSetHash and a hash of the rendered SQL (sqlHash) before execute; record both in a small ledger table after success.

4. **No marker, no run**
   If the prisma_contract marker table is missing in prod, bailout with a clear error (don't fall back to `{kind:"empty"|"unknown"}` in prod).

5. **No "tolerant" in prod**
   Allow `"mode": "tolerant"` only for dev/staging via CLI flag or config; reject in prod.

6. **Explicit override path (rare, audited)**
   Provide `migrate mark --hash sha256:<H>` to adopt an existing DB state only with a manual, logged action—never implicitly.

## What happens when you squash

- You generate a new program:

```json
"from": { "kind": "contract", "hash": "sha256:<A>" },
"to":   { "kind": "contract", "hash": "sha256:<Z>" }
```

or (for fresh dev installs)

```json
"from": { "kind": "empty" }, "to": { "hash": "sha256:<Z>" }
```

- Production is already at `sha256:<Z>` (or beyond), so neither program applies there.
- New developer machines (empty DB) will match the empty baseline, which is exactly what you want.

Bottom line: the hash-keyed applicability makes misapplying migrations on production practically impossible, and "squash everything to zero → latest" is safe because from can never match prod's non-empty contract.

## For a fresh developer database, the workflow becomes trivial and safe:

1. **Empty DB = from.kind: "empty"**
   Since no prisma_contract marker exists yet, the migration system treats it as an empty state.

2. **Apply the squashed migration**
   Running:

   ```bash
   pn prisma-next migrate apply --env development
   ```

   finds the latest migration whose from matches `{kind: "empty"}` and applies it in full:

   ```
   Applying: baseline (empty → sha256:<latest>)
   ✔ Applied in 180ms
   ✔ DB contract updated to sha256:<latest>
   ```

3. **Marker table installed**
   The baseline migration writes:

   ```sql
   INSERT INTO prisma_contract (contract_hash) VALUES ('sha256:<latest>');
   ```

   After that, the database is versioned like any other environment.

4. **No risk to prod or staging**
   - Prod/staging have a contract hash (`sha256:<current>`), so they cannot match `from:"empty"`.
   - The runner skips that migration entirely.
   - Future migrations build on `sha256:<latest>` normally.

## Why this matters
- No branching logic for dev vs prod.
- No special bootstrap commands — the same `migrate apply` works everywhere.
- Self-describing state — any environment with no contract marker automatically qualifies as "empty," ensuring only the intended baseline applies.

So yes:
For a new developer environment, you simply run the squashed (empty → latest) migration once.
The contract table is created, the schema is applied, and you're in sync with the current PSL state — clean, deterministic, and zero configuration.
