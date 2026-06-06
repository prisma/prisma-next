# Project Spec — Extension-contributed top-level PSL blocks

## What this is

Today the PSL parser and printer are framework-internal: they handle a fixed set of top-level block keywords (`model`, `type`, `types`, `namespace`, `enum`) and there's no way for an extension to add a new one. Anything that wants a new top-level PSL keyword — Postgres RLS wants `policy { … }`, post-RLS work wants `role { … }`, future Postgres-specific entity types might want others — has to either edit the framework parser (which leaks Postgres concerns into framework code that SQLite + MongoDB users carry), or skip PSL entirely and be authored only via the TypeScript builder (which breaks the framework's "PSL and TS surfaces stay structurally parallel" promise).

This project closes the gap. After it lands, an extension (or any framework component participating in `AuthoringContributions`) contributes a new top-level PSL block keyword by registering one descriptor that carries both a parser (recognises the keyword, produces an AST node) and a printer (renders that AST node back to source text). The framework doesn't need to know about the keyword; it routes parses and prints through the contributing extension at descriptor-build time.

The first real consumer is RLS. This project doesn't ship RLS — that's a separate project — but it ships the mechanism RLS (and roles, and any future Postgres-specific entity types) need.

```prisma
namespace public {
  model Profile {
    id       String @id
    userId   String @unique
  }

  policy profiles_select_anon {
    target    = Profile
    operation = select
    using     = "true"
  }
}
```

After this project lands, the example above is parseable, printable, and lowerable purely via extension contributions — the framework parser, printer, and lowering pipeline never learn about the `policy` keyword directly.

## Place in the world

Three architectural layers carry extension contributions; this project closes the corner that's missing.

| Layer | Mechanism today | Status |
|---|---|---|
| IR layer | Three-tier polymorphic class hierarchy (framework interface → family abstract base → target concrete class) per ADR 221 | Shipped |
| Semantic lowering (AST node → IR class instance) | `AuthoringContributions.entityTypes` registry — extensions ship factories keyed by a discriminator string | Shipped |
| Parsing + printing (source text ↔ AST node) | Framework-internal, hardcoded dispatch | **This project** |

An extension contributing the keyword `policy` ships two things, tied by a shared `discriminator` string:

- **A PSL-block descriptor** (`pslBlocks.policy`) carrying a `parser` (produces an AST node tagged `kind: 'postgres-policy'`) **and** a `printer` (renders that AST node back to PSL source). Parser and printer live on the *same* descriptor — they are one inseparable unit, not two contributions that happen to match (see below).
- **A lowering factory** (`entityTypes.policy`) that turns the parsed AST node into an IR class instance. This is the existing semantic-lowering registry — unchanged by this project.

### Parser and printer are one descriptor, not two

An earlier shape of this design split parser and printer into separate `pslBlocks` and `pslPrinters` namespaces, validated as matching by discriminator. That was wrong: a parser with no printer breaks `contract infer`, and a printer with no parser parses nothing — they cannot exist independently. Expressing them as two registrations tied by a cross-check is ceremony around a thing that is actually one thing. So a single descriptor carries both. (This collapse is the direct result of review on the first cut of this slice.)

### `entityTypes` stays a separate registry — for now

The lowering factory (`entityTypes`) is *not* folded into the PSL-block descriptor in this project, even though a PSL block always needs a factory to be useful. Two reasons:

1. The reverse isn't true today: `entityTypes` can exist *without* a PSL block. `enum` is contributed via `entityTypes` alone — its factory is reachable from the TypeScript builder (`entities.enum({ … })`), while its PSL representation is framework-parsed rather than extension-contributed. Folding the factory into the block descriptor would force every TS-builder entity to also ship PSL parser/printer.
2. The deeper question this raises — *should every entity that has a PSL representation contribute its parser/printer alongside its factory, rather than relying on framework-parsing?* — is real (it's why `enum`'s TS and PSL surfaces are divorced today) but belongs to the enum-as-domain-plane work in [TML-2815](https://linear.app/prisma-company/issue/TML-2815), not here.

So this project keeps the link as a validated reference: a PSL-block descriptor **requires** a matching `entityTypes` factory (same discriminator); an `entityTypes` factory does **not** require a PSL-block descriptor. Revisiting this asymmetry is explicitly TML-2815's domain.

### The PSL AST converges on the IR's `entries` coordinate shape

ADR 224 (merged) addresses contract-IR namespace concretions by coordinate: `storage.namespaces[id].entries[kind][name]`. That `entries` shape lives on the *lowered* IR objects (`PostgresSchema`, `MongoBoundNamespace`), and ADR 224 scoped itself to the IR layer — it left the PSL AST's `PslNamespace` on its per-kind slots (`models` / `enums` / `compositeTypes`).

The PSL AST should carry the same coordinate system. We have two near-identical IR trees and only one has a uniform entity coordinate; there is no principled reason the PSL AST can't address entities the same way, and a generic coordinate system is exactly what would let PSL consumers stop special-casing kinds. So the destination is explicit: `PslNamespace` migrates onto the `entries[kind][name]` shape, with built-in and extension-contributed kinds addressed uniformly.

That migration is framework-wide — it touches the parser, both printer phases, `sqlSchemaIrToPslAst`, and every PSL-AST consumer and test — so it does not ride in the substrate slice. The substrate ships the minimal generic `extensionBlocks` slot as a deliberate **interim** shape; the full migration is this project's closing slice, [TML-2849](https://linear.app/prisma-company/issue/TML-2849). The interim is safe to defer because the slot is framework-internal: extensions contribute AST *nodes* through the descriptor SPI and never touch `PslNamespace` directly, so the later migration changes the framework's storage shape without forcing changes on extension contributions.

### Why the printer is in scope, not just the parser

The CLI's `contract infer` command renders a contract IR back to PSL source text on disk. Without printer extensibility, every extension-contributed block kind would break that command — `contract infer` would silently drop unknown blocks, or crash, depending on how the printer happens to fail. Parser extensibility without matching printer extensibility ships an asymmetry that bites the moment a user runs the inference command. Parser and printer ship together — on one descriptor — for this reason.

## Cross-cutting design constraints

### Symmetry with the existing lowering registry

The `pslBlocks` namespace follows the same pattern as the existing `entityTypes` registry. It lives as a new namespace on `AuthoringContributions`, assembled at descriptor-build time via the same merge walker, so within-namespace duplicates throw at load time. Implementers should expect the new code to look structurally like the existing `entityTypes` code — the mechanism is a copy, not a redesign.

### Extension-owned AST types in a generic slot

When an extension contributes a parser for a new block keyword, the AST node it produces is typed by the extension, not by the framework. The framework's `PslNamespace` carries one generic slot for extension-contributed blocks; entries in that slot share a minimal base shape — a `kind` discriminator string, a required `name`, and a `span`. Downstream consumers (printer, lowering registry, tooling) narrow on `kind`.

`name` is mandatory because every block kind we've shipped or planned has one (`enum Status`, `policy ProfilesSelectAnon`, `role admin`, `model Article`). The mandatory name keeps the base type narrow and the lowering registry's index simple. If a future extension-contributed kind genuinely needs to be anonymous, the base shape can loosen then.

The alternative to a generic slot — a typed slot per contributed kind (the way `enums: readonly PslEnum[]` works today) — would force every new extension-contributed kind to ship a framework PR. That defeats the point. The generic slot keeps the framework AST stable as extensions add kinds. This is a structural break from how `enum` is modelled (`PslEnum` has its own typed slot); `enum` is unchanged by this project (see non-goals), so the generic slot is purely additive.

The generic slot is the interim shape, not the destination. A flat `extensionBlocks` array next to the built-in typed slots leaves `PslNamespace` two-tier — built-in kinds typed-and-named, contributed kinds in a generic array — which is a less-general second answer to the coordinate problem ADR 224 already solved one layer down. This project's closing slice ([TML-2849](https://linear.app/prisma-company/issue/TML-2849)) resolves that by folding the generic slot *and* the built-in per-kind slots into the IR's `entries[kind][name]` coordinate shape.

### Minimal-by-default parser/printer SPI

The descriptor's `parser` receives a context handle (line/token cursor, source-line access, span constructors, a diagnostic sink); its `printer` receives a context handle (indentation, string-literal escaping). Each handle exposes only what the integration-test fixture actually consumes. Framework-internal helpers stay framework-private until a real consumer demands lift.

The reason: this project ships the mechanism without a real-world migration to validate it. The first real consumer is RLS, in a downstream project. A maximalist SPI shipped now would publish a stable surface that turns out not to fit RLS's needs. Ship the minimum; let RLS surface gaps as it hits them; lift helpers into the SPI when there's a real second consumer.

### Discriminator string convention

Extension-contributed AST nodes carry a discriminator string of the form `<target-or-family>-<kind>` — e.g. `postgres-policy`, `postgres-role`, `mongo-collection-validator`. The string is opaque to the framework; the convention is documented as a golden rule, enforced by code review. It exists for collision-free routing (`postgres-policy` and `pgcrypto-policy` are distinct even if both keyword-named `policy`) and for diagnostic legibility (when a user sees an unrecognised discriminator, the prefix tells them which extension they're missing).

### Round-trip is load-bearing

The existing parser-to-printer-to-parser round-trip test must survive the change: `parsePslDocument → astDocumentToPrintDocument → serializePrintDocument → parsePslDocument` produces an equivalent AST today, and that property must hold for extension-contributed blocks too. The integration-test fixture is the regression test.

### Load-time validation, no silent precedence

- Two extensions contributing the same `pslBlocks` keyword fail at load time with a clear diagnostic naming both. No precedence rules.
- A `pslBlocks` descriptor with no matching `entityTypes` factory (same discriminator) fails at load time — the parser would otherwise produce AST nothing can lower. The reverse does not fail (an `entityTypes` factory may stand alone; see "Place in the world").
- Malformed descriptors must be rejected, not silently skipped: an object that looks like a descriptor (carries `kind` / `discriminator`) but doesn't satisfy the descriptor shape throws at load time rather than being treated as a sub-namespace.

The reasoning: silent precedence is a maintenance trap, and a missing factory or printer is a half-feature footgun. All these failure modes surface at load time, are diagnosed clearly, and are fixed by editing the extension's contributions — never by the user.

## What this project does not do

**Migrate the `enum` keyword.** An earlier framing migrated `enum` to a Postgres contribution as the proof-of-concept. That was wrong: `enum` is an application-level (domain-plane per ADR 221) concept that happens to have target-specific storage representations (Postgres native enum, SQLite TEXT, MongoDB string), not a Postgres feature. Cross-target `enum` support is tracked in [TML-2815](https://linear.app/prisma-company/issue/TML-2815). This project leaves `enum` framework-parsed. The integration-test fixture substitutes for the missing real migration; RLS is the first real consumer once it lands.

**Fold `entityTypes` into the PSL-block descriptor.** Kept as a separate registry for the reasons in "Place in the world." The "should every PSL-representable entity contribute its own parser/printer" question is TML-2815's domain.

**Migrate the PSL AST to an `entries` shape *in the substrate slice*.** The substrate ships the generic `extensionBlocks` slot as an interim. Converging `PslNamespace` onto ADR 224's `entries[kind][name]` coordinate shape — built-in and contributed kinds alike — is this project's closing slice ([TML-2849](https://linear.app/prisma-company/issue/TML-2849)), sequenced before the ADR + close-out so the ADR records the converged shape.

**Custom attribute parsers** (`@policy(…)`, `@auth(…)`). Attributes live inside other blocks and have a different SPI shape — they consume tokens within a parent parse rather than driving one. Separate concern.

**Pluggable expression grammar.** PSL's expression grammar (attribute arguments, default values) stays framework-owned.

**Migrating `model`, `type`, `types`, `namespace` to extension-contributed.** Framework primitives every multi-storage target needs; pushing them to extensions buys no semantic clarity.

**Real RLS implementation.** RLS is a separate project (`projects/postgres-rls/`). The integration-test fixture mimics RLS-shaped syntax to exercise the mechanism but ships no real RLS code.

**Per-target printer variation.** The printer is target-agnostic. Extension-contributed printers are too; target-specific rendering, if ever needed, belongs in the planner or emitter.

## Project-DoD

This project is done when:

1. **`AuthoringContributions` exposes a `pslBlocks` namespace** whose descriptors each carry both a `parser` and a `printer`. Structurally parallel to the existing `entityTypes` namespace. Type narrowing is end-to-end strong: a descriptor's parser return type narrows to the AST node shape its printer and the matching factory consume.

2. **Load-time validation is wired up.** Within-namespace duplicates throw via the existing merge walker. A `pslBlocks` descriptor with no matching-discriminator `entityTypes` factory throws, naming the contributing extension and the discriminator. Malformed descriptor objects are rejected rather than silently skipped. (There is no separate parser↔printer cross-check — they are one descriptor — and no cross-registry path-collision check for `pslBlocks`, which shares paths with `entityTypes` by design.)

3. **The framework parser's top-level dispatch consults `pslBlocks`** for unknown identifiers before falling back to the existing "unknown top-level keyword" diagnostic. Built-in keywords (`model`, `type`, `types`, `namespace`, `enum`) continue to be framework-parsed directly.

4. **The framework printer's two phases handle extension-contributed blocks.** The AST-to-PrintDocument phase carries them into the print-document intermediate; the PrintDocument-to-string phase renders each by dispatching to the owning descriptor's `printer`, keyed by discriminator.

5. **An integration test contributes a fixture extension** that ships a `pslBlocks.<keyword>` descriptor (parser + printer) and a matching `entityTypes.<keyword>` factory under one discriminator. The fixture's keyword and AST shape mimic RLS-style top-level blocks (block name, named-arg body, string-valued predicates). The test runs the round-trip parse → lower → IR class instance → serialize → hydrate → IR class instance → print → re-parse and asserts the result matches the original. The fixture lives in test-only code; no production contribution ships from this project.

6. **The existing parser-printer round-trip test continues to pass** for framework-parsed blocks (`model`, `enum`, `type`, etc.).

7. **A clean diagnostic surfaces** when a contract uses a top-level keyword that no in-scope extension contributes — naming the keyword, pointing at the offending span.

8. **`contract infer` works for extension-contributed block kinds.** Verified by the integration-test fixture's round-trip.

9. **Three-layer extensibility ADR lands.** Names IR / lowering / parsing+printing as the three corners; pins the discriminator convention; cites ADR 221 (IR) and ADR 224 (IR namespace `entries`) and is explicit that parsing+printing extends the *PSL-AST* layer, distinct from the IR `entries` layer. Subsystem docs reference it.

10. **`AGENTS.md` references `AuthoringContributions.entityTypes` correctly.** The current doc-bug (`AuthoringContributions.entities`) is fixed.

11. **Project directory deleted.** `projects/target-contributed-psl-blocks/` removed; in-tree references scrubbed per `.cursor/rules/doc-maintenance.mdc`.

12. **PSL AST namespace migrated to `entries` coordinate addressing.** `PslNamespace` converges on ADR 224's `entries[kind][name]` shape; the interim `extensionBlocks` slot and the built-in per-kind slots (`models` / `enums` / `compositeTypes`) fold into one coordinate container, so built-in and extension-contributed kinds are addressed uniformly and PSL consumers stop special-casing kinds. Tracked as [TML-2849](https://linear.app/prisma-company/issue/TML-2849); sequenced before item 9 (the ADR records the converged shape) and item 11 (close-out deletes the project dir last).
</content>
