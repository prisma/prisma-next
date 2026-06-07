# Slice `entries-migration` — Dispatch Plan

**Slice spec:** Project spec [`../../spec.md`](../../spec.md) (Project-DoD item 10) + ADR 224. **Linear:** [TML-2849](https://linear.app/prisma-company/issue/TML-2849). **Branch:** `tml-2849-slice-3-psl-ast-entries-migration` (stacked on Slice 2).

## Design decision (operator-settled) — typed accessors stay

`PslNamespace`'s **canonical storage** becomes ADR 224's `entries[kind][name]`. But the **core entity kinds** (`model`/`enum`/`compositeType`) carry special framework semantics, so they keep **typed derived accessors** (`models`/`enums`/`compositeTypes`) over `entries` — each casts its `entries[kind]` slice to the concrete element type **once**, so framework code reads them at the right type with no per-call-site casts. Extension-contributed kinds are reached generically via `entries[discriminator]`. This mirrors ADR 224's IR (canonical `entries` + typed concretion accessors); the original "delete the typed slots in E4" was an oversight — deleting them forces a narrowing cast at every typed read across the SQL/Mongo families (a `lint:casts` regression for negative ergonomic value).

**Consequence — the migration is producer-side, and much smaller than first planned.** Because the typed accessors preserve the `.models`/`.enums` read interface, every **reader** (interpreters, validators, emitters) is unaffected. Only the **producers** that *construct* a `PslNamespace` must switch from building per-kind arrays to building `entries` (via the `makePslNamespaceEntries` builder), since the per-kind fields are now read-only derived getters. No getter-removal dispatch; no cross-family reader migration.

## Dispatches

### E1: `entries` canonical storage + typed accessors + framework surface  *(in progress — WIP in tree)*
- **Outcome:** `PslNamespace.entries[kind][name]` is the canonical, frozen store (ADR 224: singular essence-named keys `model`/`enum`/`compositeType` + contributed discriminators). `models`/`enums`/`compositeTypes` are **permanent typed derived accessors** (cast `entries[kind]` to the element type once each, via `blindCast<…, "reason">` — not bare `as`). The framework's own producers/consumers use `entries`: parser writes `entries` (via `makePslNamespaceEntries`); both printer phases + `psl-extension-block-validator` read `entries`; `generate-contract-dts` migrated. `framework-components` + `psl-parser` + `psl-printer` typecheck + tests green; `lint:casts` no regression (the accessor casts are `blindCast`).
- **Builds on:** Slice 2. ADR 224.
- **Hands to:** `entries` canonical + typed accessors; framework surface on `entries`. Readers elsewhere keep working via the accessors; only external **producers** still build per-kind arrays.
- **Focus (JUDGMENT):** the `entries` shape, kind-key naming, the entry union, freezing, and the accessor-cast pattern (`blindCast` once per accessor). `psl-ast.ts`, parser, both printer phases, validator, `generate-contract-dts`.

### E2: migrate the remaining producers to build `entries`
- **Outcome:** every site that *constructs* a `PslNamespace` builds `entries` (via the builder) instead of per-kind arrays: `sql/9-family` `sql-schema-ir-to-psl-ast`, any `contract-ts` path that produces a `PslDocumentAst`/`PslNamespace` (vs domain-IR — confirm), and the PSL-AST test fixtures across families (`sql-contract-json-fixture`, `mongo-contract-json-fixture`, emitter test contracts, `sql-orm-client` test helpers). Readers are untouched (accessors preserve their interface). Affected packages typecheck + tests green.
- **Builds on:** E1's `entries` + builder + accessors.
- **Hands to:** all producers on `entries`; no consumer constructs per-kind arrays.
- **Focus:** the producers only. Mechanical, grouped by where `PslNamespace` is constructed. (Distinguish PSL-AST producers from domain-IR builders — the latter are untouched.)

### E3: workspace verification + uniform-coordinate test + fixtures
- **Outcome:** `pnpm test:packages` workspace-wide green; `pnpm fixtures:check` clean. A test demonstrates **uniform coordinate access** — addressing a built-in kind (`entries['model'][name]`) and a contributed kind (`entries[discriminator][name]`) through the same expression — proving the coordinate system the migration exists to provide. A `rg` check confirms no producer still constructs the old per-kind arrays.
- **Builds on:** E1 + E2.
- **Hands to:** slice DoD — `entries` is the canonical uniform store, core kinds keep typed accessors, all producers on `entries`, generic coordinate access proven.
- **Focus:** verification + the coordinate-access test + fixtures.

## Slice-DoD coverage
Project-DoD item 10 (revised) ← E1 (canonical `entries` + typed accessors + framework surface) + E2 (producers on `entries`) + E3 (workspace green + uniform-coordinate proof). Items 11–12 (ADR/docs/close) are Slice 4 (TML-2806) — and the ADR must record the "canonical `entries` + typed accessors" decision, not "deleted slots."

## Sequencing rationale
E1 (shape + accessors + framework surface) first — it's the judgment and it establishes the builder + accessor pattern E2 follows. E2 (producers) next — mechanical, builds on E1's builder. E3 (verify) last — needs all producers migrated. The original E2/E3/E4 (migrate all readers, then remove getters) collapsed once the typed accessors were kept permanent: readers don't migrate, getters aren't removed. This both de-risks the slice and shrinks it.
