# Discussion Notes

> Running notes from the [`drive-discussion`](../../.claude/skills/drive-discussion/SKILL.md) DDD pass on the migration domain model.
> Captures decisions, framings, and pivots in real time so the discussion's reasoning survives context-window pressure.

## Drives

- Linear: [TML-2546 — Review migration CLI commands and vocabulary](https://linear.app/prisma-company/issue/TML-2546)
- Project area: [`[PN] May: Migrations`](https://linear.app/prisma-company/project/d16ebd98-535e-440b-9a10-076f55468412)

## Personas loaded

Sequence so far:
- `pm` — scoping audience and journeys.
- `architect` — DDD pass; now driving.
- `devrel` — queued for the audit pass once vocabulary settles.

## Framing decisions to date

### Audience priority is agent-first

1. **Agents** acting on behalf of a developer — precise, unambiguous, machine-checkable vocabulary.
2. **Application developers** — higher-level, less exhaustive, learnable.
3. Tertiary: db admins reviewing pending migrations; operators running CD; extension authors owning a contract space.

**Consequence for the vocabulary work.** "Reign in" means *consolidate synonyms and disambiguate homonyms* — not *simplify*. Precise technical names are wanted; the dev-facing surface is a curated subset/relabelling of the precise one, not a parallel vocabulary.

### Mental-model anchor is Git

Refs, branches, HEAD, the DAG model — explicitly chosen as the analog. Where our model maps cleanly onto Git, we want Git's vocabulary rather than invent new terms. Goal: a user with Git fluency should be able to internalise our migration graph quickly.

### Load-bearing user journeys

- **J0 — Bootstrap empty DB** (`db init`). Greenfield only.
- **J1 — Dev inner loop.** Edit contract, advance local dev DB (`db update` style — no migration file produced, intentionally dev-only but first-class).
- **J2 — Author + promise.** When dev is satisfied: produce a migration package AND declare "this branch advances `<ref>` (typically `production`) to the new state". One committed unit per PR. The mechanic itself is *not* the core focus — the domain model under it is.
- **J3 — Pre-deploy review (db admin).** Read-heavy: *"what's pending? what does this do?"* — the interrogative-commands gap bites here.
- **J4 — Status landing.** "Where is the DB right now, and what's next?" Single interrogative landing pad.
- **J5 — Migrate DB to ref.** *The dominant CD operation.* User proposed: `prisma-next migrate --db URL --to <ref>` (e.g. `--to production`). Single dead-simple verb.
- **J6 — CI gating (read-only).** Set of checks:
  - Is the DB at the state the app bundle expects?
  - Are there pending migrations?
  - Is the migration graph internally consistent (hashes, ref integrity)?
- **J7 — CD execution.** Preview "what will run on merge" + execute against production. The preview is required to be **rock solid** — the CD's go/no-go signal.

### Domain operations to model (not yet pinned to commands)

- Mutating: applying / executing a migration; moving a ref.
- Interrogative: querying graph state, ref state, marker state, path resolution, graph integrity.
- Authoring: producing contracts and migration artifacts (and re-producing — emission is repeatable).

### Method: compressed DDD pass

Four phases:

1. **Domain Storytelling** — extract load-bearing nouns, verbs, events, queries from concrete narratives. *(In progress; catalog at [`domain.md`](./domain.md).)*
2. **Ubiquitous Language** — argue each term to a single, precise definition; consolidate synonyms; disambiguate homonyms.
3. **Aggregates / Entities / Value Objects / Events** — group terms into structural DDD shapes; pin consistency boundaries.
4. **Commands & Queries** — derive operations (mutating + interrogative) from the model. CLI naming falls out from this almost mechanically.

After the DDD pass: audit existing CLI commands against the resulting model (the ticket's stated goal). Switch `devrel` in for the audit.

## Corrections recorded

- **"Freeze" rejected.** Nobody talks about "freezing" a migration. Need a different verb for the author-time act of turning a contract change into a committed migration package.
- **Missing emission concepts.** Both contracts and migration artifacts are emitted; both have hashes. The first-cut catalog under-named this; expanded in [`domain.md`](./domain.md).
- **Missing data invariants.** First-cut catalog had no entry for the invariant primitive; ADRs 176 + 208 supplied the model.
- **Missing operations decomposition.** DDL vs data-transform, three-phase envelope, idempotency classes — added.
- **Missing contract spaces and pinned mirrors.** ADR 212 added.

## Open subthreads

- The "advance ref" verb. Picked deferred (not the core focus per the user); will be settled by the chosen analog (Git vocabulary suggests `move` or `update`).
- The collapse of `migration plan` / `migration new` and of `db update` / `migration apply` — both gated on the Phase 2 ubiquitous-language pass.
- Whether `head` is a useful ref name or whether environment-named refs (`production`, `staging`) carry the whole load.

## What's next

- Reference summaries of established migration systems land under [`references/`](./references/) (sub-agents dispatched).
- Once references are in, re-enter Phase 1 close-out: name what's *missing* from the catalog that established systems consider load-bearing, and what we should *reject* that they take for granted.
- Then transition into Phase 2 — Ubiquitous Language.
