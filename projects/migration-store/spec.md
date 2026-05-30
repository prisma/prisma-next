# One tolerant contract-space model for the migration commands

## Purpose

Give the migration commands a single, queryable, fault-tolerant model of a project's on-disk migration state, so that "what spaces exist," "what refs point where," and "what graph do these packages induce" are answered once — by the contract-space aggregate the codebase already has — instead of being re-derived, divergently, at each command. Loading the model is not where integrity is judged: a half-broken project on disk is a real state every command must read and report consistently, not crash on.

## At a glance

There is **one** model here — project migration state on disk: contract spaces, each with its migration packages, its refs, and the graph those packages induce. The commands are progressive queries over it (`list` reads packages + refs; `graph` adds the linkages; `status` / `show` add the deserialized contract + DB markers). The codebase already has the model — `ContractSpaceAggregate` / `ContractSpaceMember` (`src/aggregate/`), used today by `status` and `show`.

It can't serve the other commands for one structural reason: **it fuses building the model with judging it.** `loadContractSpaceAggregate` requires the app `Contract` + the `extensionPacks` declaration up front, reconstructs every graph eagerly, and **refuses the whole load** on the first integrity problem — a useless `from === to` self-edge (hard-coded inside `reconstructGraph`, `migration-graph.ts:53-57`), layout drift, an undeserializable contract, disjointness, a missing head ref, a package hash mismatch (thrown deep in `readMigrationsDir`). The symptom is visible in `migration check` today: it catches the first thrown error and **bails after reporting one failure** (`migration-check.ts:140-166`), unable to enumerate the rest.

This project separates the three fused responsibilities — **build**, **query**, **judge** — so the one model serves every command tolerantly. The concrete design is below; there are no open design questions.

## Design

### Construction: tolerant; live contract supplied as always

```ts
function loadContractSpaceAggregate(input: {
  readonly migrationsDir: string;                        // project `migrations/` root
  readonly deserializeContract: (raw: unknown) => Contract; // family-aware; held, called lazily for on-disk contracts
  readonly appContract: Contract;                        // the project's live app contract (compiled from src/prisma/contract.psl)
}): Promise<ContractSpaceAggregate>;                     // never rejects on disk *content*
```

Construction reads migration **state** from disk: it enumerates spaces (`listContractSpaceDirectories` + reserved-name / `isValidSpaceId` filtering — `app` included, packages read from `migrations/app/`), and for each space loads its raw packages and its refs. The app's *live* contract is **not** a disk artifact — in Prisma Next it always comes from the project's central contract (compiled from `src/prisma/contract.psl`), so the caller always has it and passes it as `appContract`, exactly as before. The app's `headRef` is synthesised from `appContract.storage.storageHash` (as the old loader did). App migration *packages* are read from disk like every other space. Construction **never throws on disk content** — every integrity problem becomes a represented violation (below), not a load failure. The only rejections are catastrophic I/O (a `migrations/` that exists but is unreadable for reasons other than absence).

This is the crux of "one model": construction needs no config reconciliation (no `extensionPacks` declaration) and deserializes no on-disk contract eagerly — `list` / `graph` / `log` build the aggregate and simply never query `app.contract()` or the lazy facets, while `status` / apply / verify query them. The `appContract` is always in hand; what the read commands avoid paying for is reconciliation and lazy deserialization, not the live contract object itself.

### The model: value with lazy facets + query methods

```ts
interface ContractSpaceMember {
  readonly spaceId: string;                              // 'app' or extension id
  readonly packages: readonly OnDiskMigrationPackage[];  // raw, as-on-disk; never integrity-validated at load
  readonly refs: Refs;                                   // user-authored migrations/<space>/refs/*.json (name → {hash, invariants})
  readonly headRef: ContractSpaceHeadRecord | null;      // system migrations/<space>/refs/head.json; null if absent (represented, not fatal)
  graph(): MigrationGraph;                               // lazy, memoised; PURE structure — no integrity throw
  contract(): Contract;                                  // lazy, memoised; deserializes on demand
}

interface ContractSpaceAggregate {
  readonly targetId: string;
  readonly app: ContractSpaceMember;                     // retained for existing apply/verify/planner consumers
  readonly extensions: readonly ContractSpaceMember[];   // alphabetical by spaceId (apply-ordering convention)
  listSpaces(): readonly string[];                       // app first, then extension ids lex-asc
  hasSpace(id: string): boolean;                         // the single existence check (kills the --space divergence)
  space(id: string): ContractSpaceMember | undefined;
  spaces(): readonly ContractSpaceMember[];              // [app, ...extensions] in listSpaces() order
  checkIntegrity(opts?: IntegrityQueryOptions): readonly IntegrityViolation[]; // never throws
}
```

**Why a value with methods, not interface + factory.** This is a snapshot of disk state, not a stateful service with a lifecycle; the lazy memoisation on `graph()` / `contract()` is a pure cache (same disk → same result), not lifecycle state. So it is value-shaped, not the [interface + factory](../../docs/architecture%20docs/patterns/interface-plus-factory.md) pattern (which is for services that hide an implementation). `app` + `extensions` stay as fields so the existing planner / verifier / runner consumers keep working; the query methods + lazy facets are added for the read commands. `migrations: HydratedMigrationGraph` (eager) is replaced by raw `packages` + lazy `graph()`; planner / verifier call `.graph()` (they run only after the integrity gate, so it won't surprise them).

### Judging: integrity as a query, never a load gate

```ts
interface IntegrityQueryOptions {
  readonly declaredExtensions?: readonly DeclaredExtensionEntry[]; // enables layout-drift checks (config vs disk)
  readonly requireContracts?: boolean;                             // enables contract/disjointness/target checks
}

type IntegrityViolation =
  // recoverable — package/space retained, surfaced for policy
  | { readonly kind: 'sameSourceAndTarget'; readonly spaceId: string; readonly dirName: string; readonly hash: string }
  | { readonly kind: 'hashMismatch'; readonly spaceId: string; readonly dirName: string; readonly stored: string; readonly computed: string }
  | { readonly kind: 'providedInvariantsMismatch'; readonly spaceId: string; readonly dirName: string }
  | { readonly kind: 'headRefMissing'; readonly spaceId: string }
  | { readonly kind: 'headRefNotInGraph'; readonly spaceId: string; readonly hash: string }
  | { readonly kind: 'refUnreadable'; readonly spaceId: string; readonly refName: string; readonly detail: string } // corrupt/unparseable ref json (named ref or head.json); ref omitted, not fatal
  // config/contract-dependent — produced only when the matching opt is set
  | { readonly kind: 'orphanSpaceDir'; readonly spaceId: string }              // needs declaredExtensions
  | { readonly kind: 'declaredButUnmigrated'; readonly spaceId: string }       // needs declaredExtensions
  | { readonly kind: 'targetMismatch'; readonly spaceId: string; readonly expected: string; readonly actual: string } // needs requireContracts
  | { readonly kind: 'disjointness'; readonly element: string; readonly claimedBy: readonly string[] }                 // needs requireContracts
  | { readonly kind: 'contractUnreadable'; readonly spaceId: string; readonly detail: string }                         // needs requireContracts
  // genuinely unloadable — package omitted from member.packages
  | { readonly kind: 'packageUnloadable'; readonly spaceId: string; readonly dirName: string; readonly detail: string };
```

`checkIntegrity()` walks the loaded model and returns **all** violations (no first-failure bail). The throws relocated out of the load path:

| Was thrown by | Now |
|---|---|
| `errorSameSourceAndTarget` (`reconstructGraph`) | `reconstructGraph` builds pure structure; `sameSourceAndTarget` violation |
| `errorMigrationHashMismatch` (`readMigrationsDir`) | `hashMismatch` violation; package retained |
| `errorProvidedInvariantsMismatch` (`readMigrationsDir`) | `providedInvariantsMismatch` violation; package retained |
| `errorInvalidJson` / `errorInvalidManifest` / `errorMissingFile` (`readMigrationsDir`) | `packageUnloadable` violation; package omitted (per-package, not whole-aggregate fatal) |
| corrupt / unparseable ref json (`readRefs` / `readContractSpaceHeadRef`) | `refUnreadable` violation; that ref omitted (per-ref, not fatal). A genuinely *absent* head ref stays `headRefMissing`. |
| loader layout / disjointness / target / head-ref / contract-validation failures | matching violations, produced under the relevant `IntegrityQueryOptions` |

### Per-command consumption

| Command | Queries | Integrity policy |
|---|---|---|
| `migration list` | `spaces()` → `member.packages` + `member.refs` | none — render regardless |
| `migration graph` | `spaces()` / `space(id)` → `.graph()` + `.refs` | none |
| `migration log` | app `space()` → `.graph()` + packages (+ live marker) | none |
| `migration show` | `space(id)` → `.packages` / `.graph()` / `.contract()` / `.refs` | none |
| `migration status` | `spaces()` → `.graph()` + `.refs` + `.contract()` + markers | **report** drift via `checkIntegrity()` |
| `migration check` | `spaces()` + `checkIntegrity({ declaredExtensions, requireContracts })` | **render all** → `PN-MIG-CHECK-*` |
| apply / verify | `app` / `extensions` + `checkIntegrity({ declaredExtensions, requireContracts })` | **refuse** on the gating subset, then plan |

### Blast radius (enumerated, not open)

`reconstructGraph`'s self-edge throw is removed; the consumers that relied on it re-acquire it via `checkIntegrity()`: `migration check`, the apply path (`compute-extension-space-apply-path.ts:101`), and the aggregate-loader integrity path. The full `reconstructGraph` caller set to re-point: `migration-new`, `migration-show` (×3), `command-helpers.loadMigrationPackages`, `aggregate/loader` (×2), `compute-extension-space-apply-path`. The CLI's `mapLoadAggregateError` → `IntegrityViolation` mapping preserves the existing `5001` (layout) / `5002` (disjointness/integrity/validation) envelopes and `meta.violations[]` shape, plus `PN-MIG-CHECK-001..006`. Apply / verify change from "construction throws" to "explicit `checkIntegrity()` gate then plan."

## Non-goals

- **No mutation / write API on the model.** Read + query only. Writes stay in `writeMigrationPackage` / `writeRefPaired`; callers reload after a write. In-place mutation + invalidation are out of scope.
- **No new on-disk format, ref semantics, marker shape, or contract-space layout.** Existing layout read verbatim.
- **Not rewriting apply / verify planning** — only relocating the integrity gate they already enforce, and switching their aggregate construction to the tolerant signature.
- **No change to rendered output or structured error codes** for the five read commands, except the intended self-edge tolerance change (read/render commands render it; it surfaces as a structured violation only where integrity is asked).
- **No inconsistency repair / auto-recovery.** Consistent *reporting*, not fixing.
- **No second data model.** One aggregate, lazy facets, extracted integrity.

## Place in the larger world

- **Package:** `@prisma-next/migration-tools` (`packages/1-framework/3-tooling/migration`) — evolves `src/aggregate/*`; consumed by `@prisma-next/cli`. Same domain/layer/plane (validate with `pnpm lint:deps`).
- **Built on TML-2697 / PR #603.** Branch based on `tml-2697-improve-migration-list-output`; rebases onto `main` once #603 merges. #603's `enumerateMigrationSpaces` / `resolveRefsByContractHash` become the user-refs loading the model absorbs; the over-export carry-forward from the TML-2697 retro is resolved by folding ref-by-hash indexing into the model.
- **Ubiquitous language.** `ContractSpaceAggregate` / `ContractSpaceMember`; contract identity is the **storage hash** (glossary § Storage Hash), never "contract hash"; `db` is a **ref**, not a hash.
- **Reuses:** `readMigrationsDir`, `reconstructGraph` + `MigrationGraph`, `readRefs` + `RefEntry`/`Refs`, `readContractSpaceHeadRef` + `ContractSpaceHeadRecord`, `listContractSpaceDirectories`, `RESERVED_SPACE_SUBDIR_NAMES`, `spaceMigrationDirectory` / `spaceRefsDirectory` / `isValidSpaceId` / `APP_SPACE_ID`, `DeclaredExtensionEntry`.
- **Subsystem / ADR:** [Migration System](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md); [ADR 212 — Contract spaces](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md).

## Cross-cutting requirements

- **One model, queried progressively.** Every read command obtains spaces / packages / refs / graph from the single `ContractSpaceAggregate`; none re-derives that state from disk afterwards.
- **Tolerant construction.** Building never throws on disk content; every integrity problem is a represented `IntegrityViolation`. Genuinely unparseable packages are omitted per-package (`packageUnloadable`), not fatal to the aggregate.
- **Integrity is a query.** `reconstructGraph` is pure structure; `checkIntegrity()` returns all violations; consumers apply policy (ignore / report / refuse).
- **Behaviour preservation + relocation, integration-tested.** The relocated self-edge / hash / layout / disjointness checks are re-acquired by `check` + apply + verify. A self-edge migration, a hash-mismatched package, and an orphan space dir are integration-tested across consumer classes: `list` / `graph` / `show` / `log` tolerate-and-render; `check` reports **all** of them at once; apply / verify refuse with the structured violation.
- **Lazy cost.** A command pays only for facets it queries — `list` reconstructs no graphs and deserializes no contracts.
- **Net deletion** at the call sites; a command that grows after migrating is flagged in that slice's review.
- **Every merged slice leaves the workspace green and deployable.**

## Transitional-shape constraints

- **`reconstructGraph`'s self-edge throw is removed only in the same change that re-acquires it** in `check`, apply, and verify. No window where a useless self-edge silently applies to a database.
- **The tolerant model lands before, or with, its first read-command consumers**, proven against a raw-only reader (`list`) and a graph reader (`graph`) before the heavier consumers lean on it.
- **The loader signature change is atomic with its consumers.** `loadContractSpaceAggregate`'s move to the disk-only signature + explicit `checkIntegrity()` gate updates apply / verify / the CLI wrapper in the same change — no half-migrated construction site merges.
- **Each slice keeps the base branch green;** a command is fully on the model or fully on the old path within a slice.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] `reconstructGraph` builds pure structure and no longer throws on a `from === to` self-edge.
- [ ] `loadContractSpaceAggregate` has the tolerant signature (`{ migrationsDir, deserializeContract, appContract }`), never throws on disk content, and carries per-space raw `packages` + user `refs` + nullable `headRef` + lazy `graph()` / `contract()`. The live `appContract` is caller-supplied (compiled PSL) and always present; read commands receive it but don't query the app's lazy facets.
- [ ] `ContractSpaceAggregate.checkIntegrity()` returns the full `IntegrityViolation[]` (no first-failure bail); `migration check` reports all violations at once; apply / verify refuse on the gating subset; CLI mapping preserves `5001` / `5002` / `PN-MIG-CHECK-*`.
- [ ] All five read commands (`list`, `graph`, `status`, `show`, `log`) consume the one model via `space()` / `spaces()` / `hasSpace()` / lazy facets; per-command hand-rolled space/ref/graph I/O deleted (net deletion confirmed on the branch diff).
- [ ] Integration tests pin self-edge / hash-mismatch / orphan-dir behaviour across all consumer classes (tolerate-and-render / report-all / refuse).
- [ ] All five commands produce identical output, `--json`, and structured errors as before, modulo the intended self-edge tolerance change.
- [ ] Branch rebased cleanly onto `main` after TML-2697 / PR #603 merges.

## Open Questions

None. All design decisions are resolved above and recorded with rationale in [`./design-notes.md`](./design-notes.md).

## References

- Linear ticket: [TML-2709](https://linear.app/prisma-company/issue/TML-2709/unify-migration-read-commands-on-a-tolerant-contractspaceaggregate)
- Linear Project: [PN] May: Migrations
- Depends on: TML-2697 (PR #603) — `tml-2697-improve-migration-list-output`
- Existing model: `packages/1-framework/3-tooling/migration/src/aggregate/{types,loader}.ts`
- Self-edge throw: `packages/1-framework/3-tooling/migration/src/migration-graph.ts:53-57`
- Load-path throws: `packages/1-framework/3-tooling/migration/src/io.ts` (`readMigrationsDir`)
- CLI error mapping: `packages/1-framework/3-tooling/cli/src/utils/contract-space-aggregate-loader.ts`
- Subsystem: [`docs/architecture docs/subsystems/7. Migration System.md`](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- ADR: [ADR 212 — Contract spaces](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)
- Design notes: [`./design-notes.md`](./design-notes.md)
