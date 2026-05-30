# Design decisions — migration-store

> Chronological log of **mid-flight** design decisions: I12 halts, falsified
> assumptions, and scope changes made after the spec/plan were first settled.
> The *settled* design (non-chronological) lives in [`design-notes.md`](./design-notes.md);
> this file records *why a decision changed* and when.

## DD-1 (2026-05-30) — Keep the app-contract stand-in; consolidate the list view-model into the CLI

**Trigger.** Mid-flight, falsified assumption (invariant I12), `triggered_by: operator-flagged`. Surfaced from operator review comments on PR #644 (slice `adopt-read-commands`).

**Falsified assumption.** The project design (`design-notes.md` § "Construction without a contract"; `spec.md` § "Construction") states the aggregate "constructs from disk alone, no eager contract." The implementation does **not** realise this for the app member: `loadContractSpaceAggregate` requires an eager `appContract: Contract`, and its doc-comment asserts "the caller always has it." That holds for online/write commands but is **false for the read commands** (`migration list` / `graph` / `log` run when `contract.json` may be absent or undeserializable). To satisfy the eager requirement, `buildReadAggregate` fabricates a placeholder `Contract` (the "shell"/husk). Separately, `migration list` adoption introduced a parallel view-model (`MigrationListEntry` / `MigrationSpaceListEntry`) living in the shared `migration-tools` package, mapped from the aggregate by a detached util — i.e. a second *representation* of migration state, against the project's "one model / no second representation" success signal.

**What was learned.** Two distinct smells, different fixes:
1. The husk is the honest representation of a real capability gap (the app is *defined* by its contract; a contract-less app is not something the model is equipped to represent). The eager-`appContract` requirement is load-bearing across apply/verify. So only the husk's **name** and **cast reason** are wrong, not its existence.
2. `MigrationListEntry` is a *legitimate* CLI presentation projection — it carries `operationCount` and a decorated `refs: string[]` the domain model (`ContractSpaceMember`: `ops[]`, `refs` map, `headRef`) does not. The smell is its **home** (a shared domain package) and the **detached mapper**, not the type itself.

**Decision.**
1. **Model unchanged.** Keep the eager `appContract`; keep the CLI fallback value. **Rename** it from `appContractShellForAggregateLoad` to a name describing what it is — an identity-only app-contract stand-in used when the live contract can't be loaded — with **no "offline"/"shell"** framing. The `blindCast` reason states the safety invariant: *read commands consume only `storage.storageHash` + `target`, never `models`.*
2. **Consolidate the view-model into the CLI (full relocation — Option A).** Grounding (2026-05-30, post-discussion) found the CLI-only view-model in `@prisma-next/migration-tools` is a *cluster*, not two types: `MigrationListEntry` / `MigrationSpaceListEntry` / `MigrationListResult` **plus** `classifyMigrationListGraphTopology` + `MigrationListGraphTopology` + `MigrationEdgeKind` (a DFS edge-classifier + its test). Every importer is in the CLI; `migration-tools` itself only defines them. Because the classifier depends on `MigrationListEntry` and `migration-tools` cannot import from the CLI, the type cannot move without the classifier. **Decision (operator, Option A): move the whole cluster** (types + classifier + its test + the `exports/` / `tsdown` / `package.json` wiring) into the CLI presentation layer, trimming the two now-unused `migration-tools` public exports. Inline the aggregate→view mapping into the `migration list` consumer (delete `migration-space-list-from-aggregate.ts`); keep the ref-decoration as one helper. The four `migration-list-*` formatters keep the same view shape (import home moves only).
3. **Folded into PR #644** — completing slice `adopt-read-commands` properly. No new slice, no follow-up ticket (invariant I1).

**Boundary rationale (Option A over B).** The edge-classifier reads as migration-graph reasoning, but it exists solely to drive `migration list --graph` rendering and has no consumer outside the CLI; keeping it (and the view types) in the shared package is what let the second representation leak in the first place. Relocating the whole presentation cluster puts the package boundary where the actual dependency edges are (CLI-only → CLI). #636 (the prior `migration list` rework) is **merged**, so there is no open-PR collision cost.

**Affected artefacts.** `slices/adopt-read-commands/spec.md` (scope + done conditions + Dispatch 4); this project's DoD in `spec.md`; the CLI loader/util/formatter sources under PR #644's branch. Also resolves CodeRabbit's `buildReadAggregate` try-boundary bug and the F11→F14 doc-link fixes on the same branch.

**Accepted trade-offs.** (a) The synthetic-`app` `readdir` in the list mapper **stays** — on-disk space-id enumeration is required because the frozen model always synthesises an `app` member; it is not a second read-model. (b) The husk remains a CLI-fabricated value rather than a model-native absent-contract state.

**Alternatives rejected.**
- *Model option A* (decouple the app head hash from the full `Contract`; husk dies, app member tolerates absence like extensions) — more change than warranted; reopens the loader signature across apply/verify.
- *Model option B* (model reads `migrations/app/` contract identity itself; live contract becomes an override) — maximally unifying but touches every online construction site.
- *Delete `MigrationListEntry` entirely; re-point the four formatters at `ContractSpaceMember`* — pushes `ops.length` + ref-decoration into the renderer (or duplicates the helper) and collides head-on with #636's fresh `migration list` rewrite. Worse factoring, larger blast radius.
- *Land #644 with the shim, file a follow-up* — the deferral the operator explicitly rejected.
