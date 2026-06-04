# Slice: remove flat fallback + facade projection (breaking cut)

_(Parent project `projects/explicit-namespace-dsl/`. Contributes: the builder surface becomes **always-qualified** and the facade projects the right ergonomic shape per target — the breaking half of the additive-then-cut split. Dispatch plan deferred until slice 01 merges and the exact removal surface is grep-known.)_

## At a glance

Removes the flat builder-layer accessors (`sql.<table>` / `orm.<Model>`) added-around in slice 01, leaving the namespaced facets as the only shape, and introduces the single `defaultNamespaceId`-keyed facade projection helper: unbound targets alias `db.sql = sql.__unbound__` / `db.orm = orm.__unbound__` to preserve flat ergonomics; non-unbound targets expose the qualified surface only. Ships the ADR and upgrade instructions. This is the deliberate breaking change (project FR6).

## Chosen design

- **Builder cut:** `Db<C>` collapses to the mapped half only — `{ [Ns in keyof storage.namespaces]: Namespace<C, Ns> }`; the flat intersection member and `sql()`'s flat fallback branch (`resolveTableForFlatName`) are removed. Mirror for the ORM client. After the cut, `TableNamesAcrossNamespaces` / `UnboundTables` flat indexing is dead and is deleted.
- **Facade projection (single shared helper, no per-target switch):** keyed solely on `defaultNamespaceId === UNBOUND_NAMESPACE_ID`. Unbound → `db.sql = sql.__unbound__`, `db.orm = orm.__unbound__` (flat shape recovered through the namespace facet). Non-unbound → `db.sql = sql`, `db.orm = orm` (qualified shape required at call sites). Wired identically into postgres / sqlite / mongo facades (project AC4 / AC5).
- **F1 watch:** removal must not relocate the flat fallback under a new name (failure-mode F1). Grep gates: `looksLikeFlat|normalizeStorageForHydration|resolveTableForFlatName` returns no surviving dual-shape accommodation; `'columns' in` discriminator probes absent from the new path.

## Coherence rationale

One reviewable PR = "the flat fallback is gone and the facade projects the end-state shape." The removal + the projection are inseparable: the projection helper only does work (alias vs qualified-only) once flat is removed, so they ship together.

## Scope

**In:** flat-accessor removal in `sql-builder` + `sql-orm-client`; the `defaultNamespaceId`-keyed projection helper wired into all three facades; negative type tests (project AC3); type-level projection assertions on the three packs (AC4 / AC5); ADR draft in this project dir; upgrade instructions (`record-upgrade-instructions`); single-namespace regression confirming the alias path; merge-candidate gate.

**Out:** anything delivered by slice 01; ADR final-home migration (project-close M2); emitter / `contract.json` shape changes (project FR7 — none).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Internal consumers that call `orm.<Model>` / `sql.<table>` flat on a multi-namespace contract | Must be migrated to qualified in this slice | Upgrade-instructions scope; grep `packages/3-extensions/*` + `examples/` for flat bypass sites. |
| Dual-shape relocated under a new name during removal | Hard stop (F1) | Grep gates above are dispatch DoD. |
| Unknown namespace id from a runtime-widened contract | Fail fast with a diagnostic naming the namespace (project FR11) | Lands with the removal of the flat fallback path. |

## Slice-specific done conditions

- [ ] Negative type tests confirm flat `orm.<Model>` / `sql.<table>` are gone; facade projection type-tests pass on postgres (qualified) + sqlite/mongo (flat-via-alias); the no-per-target-switch grep gate is clean.
- [ ] ADR drafted in `projects/explicit-namespace-dsl/`; upgrade instructions recorded.

## Open Questions

1. Exact upgrade-instructions scope (which internal extension packs bypass the facade). Working position: only consumers calling `orm`/`sql` directly on multi-namespace contracts; confirm via grep at slice start, widen if `packages/3-extensions/*` surfaces bypass sites.

## References

- Parent project: `projects/explicit-namespace-dsl/spec.md` (AC3, AC4, AC5, AC7; FR6, FR11)
- Depends on: slice 01 (additive surface) merged.
- Calibration: `drive/calibration/failure-modes.md` F1 (dual-shape relocated), F14 (gates mirror CI); `drive/calibration/grep-library.md` (IR substrate hygiene patterns).
