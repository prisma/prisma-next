# Sub-agent registry — migrate-marker-ledger-to-typed-query-ast-commands

The Orchestrator's record of which spawned sub-agent ID belongs to which role/variant. Resume the same ID on subsequent dispatches of that role to preserve accumulated context.

## Sub-agent registry

| Role / variant | Sub-agent ID | Tier | Status | Last used |
|---|---|---|---|---|
| setup-specialist | 4ce08b98-ecd5-47fb-848e-866eb8e566f3 | thorough (claude-opus-4-8-thinking-high) | active | 2026-05-31 |
| implementer/fast | a8da9633-4786-4e99-9101-3b8f0c39d443 | mid (claude-4.6-sonnet-high-thinking) | retired (D1 R1 only) | 2026-05-31 |
| implementer/fast (composer) | 5d69c410-bfab-42a7-adc2-e96914a37921 | **composer-2.5-fast** | active (D1 R2) | 2026-05-31 |
| reviewer/fast | d1789b17-c0fe-4439-aea7-53381e729997 | **claude-opus-4-8-thinking-high** | active | 2026-05-31 |

## Model policy (operator, 2026-05-31)

- **Implementer:** `composer-2.5-fast` — fast; requires tight briefs + Composer constraints block (see `learnings.md`).
- **Reviewer:** `claude-opus-4-8-thinking-high` — judgment layer; catches Composer drift.

D1 was in flight on Sonnet before the policy landed; let it complete, Opus reviews. D1 rework (if any) and D2–D4: fresh Composer spawn with constraints block inlined in every brief.

## Notes

- `setup-specialist` authored the slice spec + plan for `sql-marker-ops-through-adapter` and recommended the 2-slice fan-out (foundation slice + sibling marker-write slice). Resume for subsequent slice-setup authoring (sibling slice, Mongo slice).
- `implementer/fast` — **Composer from D1 rework / D2 onward** (`composer-2.5-fast`, fresh spawn). D1 started on Sonnet (`a8da9633…`) before policy change; do not resume Sonnet for rework.
- **Reviewer:** Opus (`claude-opus-4-8-thinking-high`), fresh spawn at D1 R1 review. Persistent across rounds/dispatches via resume.
