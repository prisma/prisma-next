# Slice: `migration graph` multi-space (all spaces by default, `--space <id>` to narrow)

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to the project's purpose: `migration graph` renders only the **app** contract space today, while `migration list` enumerates **all** on-disk spaces. This slice makes the read commands consistent — `graph` draws **every** on-disk contract space as a disconnected per-space tree by default, with `--space <id>` to narrow to one — matching `migration list`'s existing behaviour._

## At a glance

```
$ prisma-next migration graph
app:
○   3b2d98d            (contract)
│↑  add_phone         ef9de27 → 3b2d98d
○   ef9de27
│↑  init              ∅ → ef9de27
○   ∅

supabase-auth:
○   9f2a1c0
│↑  add_session       3bfce91 → 9f2a1c0
○   3bfce91
│↑  init              ∅ → 3bfce91
○   ∅
```

```
$ prisma-next migration graph --space supabase-auth
○   9f2a1c0
│↑  add_session       3bfce91 → 9f2a1c0
○   3bfce91
│↑  init              ∅ → 3bfce91
○   ∅
```

By default `migration graph` draws **all** on-disk contract spaces, each as its own disconnected tree under a `spaceId:` heading (spaces are independent histories — there is no cross-space topology). `--space <id>` narrows to a single space. This mirrors `migration list`, which already enumerates all spaces with `--space` to narrow.

## Chosen design

The space policy is **all-spaces-disconnected by default, `--space <id>` narrows** (the read-command-consistency decision — same shape `migration list` already implements). `migration graph` loads `aggregate.app.graph()` today — hard-wired to the app space. This slice:

- **Enumerates every on-disk space** (the same enumeration `migration list` uses — `migrationSpaceListEntriesFromAggregate` / `aggregate.space(id)`), rendering each space's `graph()` as its own tree under a `spaceId:` heading. Headings appear only when more than one space is present (matching the list renderer's `multiSpace` rule).
- **`--space <id>`:** render only the named space's tree, no heading. Unknown space id ⇒ a clear, listing error (enumerate the available space ids); invalid id ⇒ the existing `errorInvalidSpaceId`.
- The renderer itself is space-agnostic — it already consumes a single `MigrationGraph`. The work is per-space iteration + heading composition + `--space` resolution, reusing `migration list`'s space-enumeration and error helpers (`isValidSpaceId`, `errorSpaceNotFound`).

## Scope

**In:**

- All-spaces-by-default rendering on `migration graph` (per-space trees, `spaceId:` headings when multi-space).
- `--space <id>` flag (human + `--json`/`--dot` route through the selected space; multi-space JSON/DOT keys output by space id).
- Space resolution + unknown/invalid-id errors, reusing the `migration list` helpers.
- Help text / examples; tests across multi-space default, single `--space`, and unknown-space error.

**Out:**

- Cross-space edges / a unified multi-space topology (spaces are independent histories — disconnected trees only).
- The Tier-3 renderer's per-tree layout — untouched.

## Open Questions

1. **Flag spelling / value.** `--space <id>` is the established spelling on `migration list`; reuse it verbatim for consistency.
2. **`--space` + the eventual default tree renderer.** This slice should land after `--tree` becomes the default (TML-2748) or be written against `--tree` explicitly; confirm sequencing at pickup.
3. **Multi-space `--json`/`--dot` shape.** Single-space keeps today's shape; multi-space needs a per-space keyed envelope. Settle the exact shape at pickup (e.g. `{ spaces: [{ spaceId, nodes, edges }] }`).

## References

- Parent project: `projects/migration-graph-rendering/spec.md`.
- Predecessor slice that drops the old per-space graph view: `slices/remove-list-graph-renderer/spec.md` (TML-2765) — its Open Question #1 defers this work to here.
- Linear issue: _to be filed at pickup (standalone, related to TML-2765)._
