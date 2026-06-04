# Sub-agent registry — migrate-marker-ledger-to-typed-query-ast-commands

The Orchestrator's record of which spawned sub-agent ID belongs to which role/variant. Resume the same ID on subsequent dispatches of that role to preserve accumulated context.

## Sub-agent registry

> **Re-scope boundary (2026-06-01).** PR #661 was rejected and the project re-spec'd (target-contributed DDL + adapter visitor; no generic-core enum; no `family-sql` shared surface). The implementer/reviewer below worked the **rejected** design and are **not resumed** — resuming would carry the wrong mental model (deliberate pivot of role intent per `drive-build-workflow § Subagent continuity`). Fresh spawns for slice `ddl-in-query-ast`.

### Slice `sql-marker-ops-through-adapter` (TML-2753) — active

> **Continuity:** project-level implementer + reviewer resumed from slice `ddl-in-query-ast` (same project; they carry the DDL-surface + contract-free-constructor mental model that this slice builds on). Not a pivot of role intent, so resume rather than fresh-spawn.

| Role / variant | Sub-agent ID | Tier | Status | Last used |
|---|---|---|---|---|
| implementer (opus) | f9bb427a-865c-4736-8bb1-580207f52b96 | **claude-opus-4-8-thinking-high** | active (slice 2 D1) | 2026-06-02 |
| reviewer (opus) | 4277daba-8e6d-476f-abe8-7a6ad4cdd694 | **claude-opus-4-8-thinking-high** | resumed for slice 2 | 2026-06-02 |

### Slice `ddl-in-query-ast` (TML-2761) — landed (PR #672, merged a04c042b0)

| Role / variant | Sub-agent ID | Tier | Status | Last used |
|---|---|---|---|---|
| implementer (opus) | f9bb427a-865c-4736-8bb1-580207f52b96 | **claude-opus-4-8-thinking-high** | resumed onto slice 2 | 2026-06-02 |
| reviewer/fast | 4277daba-8e6d-476f-abe8-7a6ad4cdd694 | **claude-opus-4-8-thinking-high** | resumed onto slice 2 | 2026-06-02 |

### Retired — slice `ddl-in-query-ast`

| Role / variant | Sub-agent ID | Tier | Status | Last used |
|---|---|---|---|---|
| implementer/fast (composer) | 802dcecf-9c0c-4fbc-bbd0-14fbf6945fa5 | composer-2.5-fast | retired (D5/D6; operator switched implementer to Opus at D7) | 2026-06-02 |

### Superseded — PR #661 (rejected design), retained for provenance

| Role / variant | Sub-agent ID | Tier | Status | Last used |
|---|---|---|---|---|
| setup-specialist | 4ce08b98-ecd5-47fb-848e-866eb8e566f3 | thorough (claude-opus-4-8-thinking-high) | retired (rejected design) | 2026-05-31 |
| implementer/fast | a8da9633-4786-4e99-9101-3b8f0c39d443 | mid (claude-4.6-sonnet-high-thinking) | retired (D1 R1 only) | 2026-05-31 |
| implementer/fast (composer) | 5d69c410-bfab-42a7-adc2-e96914a37921 | composer-2.5-fast | retired (rejected design) | 2026-05-31 |
| reviewer/fast | d1789b17-c0fe-4439-aea7-53381e729997 | claude-opus-4-8-thinking-high | retired (rejected design) | 2026-05-31 |

## Model policy (operator, 2026-05-31; revised 2026-06-02)

- **Implementer:** `claude-opus-4-8-thinking-high` as of **D7** — operator switched off Composer after repeated pattern-fidelity drift (frozen-object factories instead of frozen classes). Earlier dispatches (D2–D6) ran on `composer-2.5-fast` with a tight-brief + constraints block.
- **Reviewer:** `claude-opus-4-8-thinking-high` — judgment layer; persistent across rounds/dispatches via resume.

D1 was in flight on Sonnet before the policy landed; let it complete, Opus reviews. D1 rework (if any) and D2–D4: fresh Composer spawn with constraints block inlined in every brief.

## Notes

- `setup-specialist` authored the slice spec + plan for `sql-marker-ops-through-adapter` and recommended the 2-slice fan-out (foundation slice + sibling marker-write slice). Resume for subsequent slice-setup authoring (sibling slice, Mongo slice).
- `implementer/fast` — **Composer from D1 rework / D2 onward** (`composer-2.5-fast`, fresh spawn). D1 started on Sonnet (`a8da9633…`) before policy change; do not resume Sonnet for rework.
- **Reviewer:** Opus (`claude-opus-4-8-thinking-high`), fresh spawn at D1 R1 review. Persistent across rounds/dispatches via resume.
