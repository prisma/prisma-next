# Slice: check-single-target-multi-space

_In-project slice. Parent project: `projects/migration-graph-rendering/`. Outcome: `migration check <ref|path>` resolves a migration in **any** contract space, completing the multi-space `check` work TML-2801 began (which left single-target app-only)._

## At a glance

[TML-2801](https://linear.app/prisma-company/issue/TML-2801) made `migration check`'s **holistic** (no-arg) mode multi-space, but its **single-target** path — `checkSingleTarget` at `packages/1-framework/3-tooling/cli/src/commands/migration-check.ts:398` — was deliberately left app-space-only: it builds one hardcoded `appSpace: CheckSpace` (`:405`) and resolves the ref against the app graph + app refs only. This slice makes `check <ref>` resolve across **all** contract spaces (reusing the already-exported `enumerateCheckSpaces`), with `--space <id>` to narrow and a clear error when a ref is ambiguous across spaces.

PART 2 of [TML-2835](https://linear.app/prisma-company/issue/TML-2835) (document the custom exit codes) is **already satisfied** — TML-2801 put them in the `--help` long description (`migration-check.ts:483-484`). This slice confirms that and adds nothing there unless a per-command README reference section exists.

## Chosen design

Single-file change (`migration-check.ts`) plus a possible shared cli-errors factory, plus tests.

### Resolution becomes multi-space

The command shell already loads the read aggregate for the holistic path (`:353`, `enumerateCheckSpaces(loadedAggregate.value.aggregate, migrationsDir)`). Make that aggregate available to the single-target path too (load before dispatch, pass into `checkSingleTarget`), so single-target can enumerate spaces the same way.

`checkSingleTarget` then:

1. **Scope the spaces.** All spaces by default; if `--space <id>` is passed, validate it the same way the holistic path does (`isValidSpaceId` → `errorInvalidSpaceId`; existence → `errorSpaceNotFound`; both exit `PRECONDITION`) and narrow to that one.
2. **Resolve the target across in-scope spaces.**
   - `looksLikePath(target)` → resolve the path to a migration dir within whichever space's `migrationsDir` contains it (generalize `resolveAppTargetPath` over the space dirs; a path is explicit, so it lands in at most one space — inherently unambiguous).
   - else → `parseMigrationRef(target, { graph, refs })` against each in-scope space; collect every `(space, matchedPackage)` hit.
3. **Disambiguate the hits.**
   - 0 → not-found (`PRECONDITION`), same envelope as today.
   - exactly 1 → check that package (file-existence / hash / snapshot) in its space — the existing per-package checks, unchanged.
   - >1 (a dirName or hash-prefix that resolves in multiple spaces) → **new ambiguity error** (`PRECONDITION`): names the spaces and tells the user to qualify with `--space <id>`. Add a structured `errorAmbiguousMigrationRef` factory in `cli-errors.ts` mirroring the existing why/fix style.
4. **Indicate the resolved space** in the human header when the match is non-app (the header already prints the target; add a space detail row where it reads cleanly).

### Worked example

Before — a migration that lives in the `postgis` space:

```
$ prisma-next migration check 20260601T0000_install_postgis_extension
✖ Migration package for "20260601T0000_install_postgis_extension" not found on disk   (exit 2)
```

After:

```
$ prisma-next migration check 20260601T0000_install_postgis_extension
✔ All checks passed   (space: postgis, exit 0)
```

Exit codes (`OK=0` / `PRECONDITION=2` / `INTEGRITY_FAILED=4`, `migration-check/exit-codes.ts`) are unchanged and remain documented in `--help`.

## Coherence rationale

One reviewable change to one command's resolution path (`migration-check.ts`) plus its tests — it finishes the multi-space story the holistic path already established and shares that path's space-enumeration + validation. Rollback is one commit.

## Scope

**In:** `migration-check.ts` — `checkSingleTarget` + the aggregate-load/dispatch wiring + the human-output space hint; a new `errorAmbiguousMigrationRef` factory in `cli-errors.ts`; generalizing the path-resolution base over spaces; tests. Confirm exit-code docs.

**Out:** the holistic-path behaviour (TML-2801, done); the other five read verbs; arktype runtime schemas ([TML-2836](https://linear.app/prisma-company/issue/TML-2836)); any `--space` semantics for `show`/`log`. No change to exit codes or the `MigrationCheckResult` shape.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| A ref (dirName or hash-prefix) matches a migration in more than one space | New ambiguity error (`PRECONDITION`), names the spaces, says "qualify with `--space <id>`" | The headline new behaviour; needs a planted-fixture test. Mirrors git's ambiguous-ref UX. |
| Filesystem-path target (`looksLikePath`) | Resolve within the owning space's dir | A path is explicit → unambiguous. If generalizing `resolveAppTargetPath`'s base over spaces proves gnarly, keep it app-relative and file a sub-follow-up (non-app paths are rare) — escape hatch, surface it. |
| `--space <id>` given + ref not in that space | not-found within that space (`PRECONDITION`) | Mirrors the holistic path's `--space` narrowing. |

## Slice-specific done conditions

- [ ] `check <ref>` resolves + checks a migration planted in a **non-app** space (was `PRECONDITION` not-found before); `--space <id>` narrows single-target; a ref ambiguous across spaces errors `PRECONDITION` with the qualify-with-`--space` message; exit codes remain documented in `migration check --help`.

## Open Questions

1. **Path-target generalization vs app-relative.** Working position: generalize path resolution to the owning space's dir; if non-trivial, keep paths app-relative and note a sub-follow-up (paths are a rare way to name a non-app migration).
2. **README exit-code mirror.** Working position: exit codes already live in `--help` (a Style-Guide-acceptable home); only add to the CLI package README if it has a per-command reference section — otherwise `--help` suffices.

## Required-section notes

- **Contract-impact:** none. **Adapter-impact:** none — operates on hashes/graphs via the aggregate, target-agnostic. **ADR:** none.

## References

- Parent project: [`projects/migration-graph-rendering/spec.md`](../../spec.md)
- Prior slice (the multi-space foundation): [`../read-command-consistency/spec.md`](../read-command-consistency/spec.md) (TML-2801)
- Linear issue: [TML-2835](https://linear.app/prisma-company/issue/TML-2835)
- Standard: [`docs/CLI Style Guide.md`](../../../../docs/CLI%20Style%20Guide.md) § Exit Codes
- Surfaces: `migration-check.ts` — `checkSingleTarget:398`, `enumerateCheckSpaces:143`, `runMigrationCheck:264`, `CheckSpace:126`
