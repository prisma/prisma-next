# PSL relation syntax

Rework PSL's relation declaration to a directional `from:`/`to:`/`through:` vocabulary,
backward-compatible with `fields:`/`references:` (old spelling still parses; the PSL
formatter rewrites it to the canonical form).

- `spec.md` — project spec (drafted via `drive-specify-project`, after design discussion)
- `plan.md` — project plan / slice composition (drafted via `drive-plan-project`)
- `design-notes.md` — settled design, principles, alternatives, open questions
- `slices/` — per-slice specs and plans

Sibling project: `projects/sql-orm-many-to-many/` (runtime M:N; retains slice 7 / TML-2933).
Design straw-man: `wip/mn-psl-changes.diff`.
