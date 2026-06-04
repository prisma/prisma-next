# Project Spec — Target-contributed PSL blocks

## What this is

Today the PSL parser and printer are framework-internal: they handle a fixed set of top-level block keywords (`model`, `type`, `types`, `namespace`, `enum`) and there's no way for a target pack to add a new one. Anything that wants a new top-level PSL keyword — Postgres RLS wants `policy { … }`, post-RLS work wants `role { … }`, future Postgres-specific entity types might want others — has to either edit the framework parser (which leaks Postgres concerns into framework code that SQLite + MongoDB users carry), or skip PSL entirely and be authored only via the TypeScript builder (which breaks the framework's "PSL and TS surfaces stay structurally parallel" promise).

This project closes the gap. After it lands, target packs (and any pack participating in `AuthoringContributions`) can contribute their own top-level PSL block keywords by shipping two functions: a parser that recognises the keyword and produces an AST node, and a printer that renders that AST node back to source text. The framework doesn't need to know about the keyword; the registry routes parses and prints through the contributing pack at descriptor-build time.

The first real consumer is RLS. This project doesn't ship RLS — that's a separate project — but it ships the substrate RLS (and roles, and any future Postgres-specific entity types) need.

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

After this project lands, the example above is parseable, printable, and lowerable purely via pack contributions — the framework parser, printer, and lowering pipeline never learn about the `policy` keyword directly.

## Place in the world

Three architectural layers carry pack contributions today; this project closes the corner that's missing.

| Layer | Mechanism today | Status |
|---|---|---|
| IR layer | Three-tier polymorphic class hierarchy (framework interface → family abstract base → target concrete class) per ADR 221 | Shipped |
| Semantic lowering (AST node → IR class instance) | `AuthoringContributions.entityTypes` registry — packs ship factories keyed by a discriminator string | Shipped |
| Parsing + printing (source text ↔ AST node) | Framework-internal, hardcoded dispatch | **This project** |

Each layer has its own contribution surface. The `discriminator` string ties them together: a pack contributing the keyword `policy` ships `pslBlocks.policy` (the parser, which produces an AST node tagged `kind: 'postgres-policy'`), `pslPrinters.policy` (which renders that AST node back to PSL source), and `entityTypes.policy` (which lowers that AST node to an IR class instance). All three carry the same discriminator string; pack-load-time validation rejects mismatches.

The three contributions are a single logical bundle. `pslBlocks` parses; `pslPrinters` prints; `entityTypes` lowers the parsed AST node to an IR class instance. None of the three is useful on its own — a parser without a factory produces AST that nothing can interpret; a factory without a parser is reachable only via the TS builder; a parser without a printer breaks `contract infer`. A pack contributing a new top-level keyword ships all three, with matching discriminators, or pack-load-time validation refuses to load the pack.

`entityTypes` is the existing semantic-lowering registry; it's not new. Today it's reached via the TS builder (`entities.enum({ … })` calls the factory directly) and via the framework parser's built-in `enum` lowering. This project adds a third path — pack-contributed PSL blocks — without changing the registry itself.

### Why the printer is in scope, not just the parser

The CLI's `contract infer` command renders a contract IR back to PSL source text on disk. Without printer extensibility, every pack-contributed block kind would break that command — `contract infer` would silently drop unknown blocks, or crash, depending on how the printer happens to fail. Parser extensibility without matching printer extensibility ships an asymmetry that bites the moment a user runs the inference command. Parser and printer mechanisms ship together as one project for this reason.

## Cross-cutting design constraints

Six commitments thread through the implementation.

### Symmetry with the existing lowering registry

`pslBlocks` and `pslPrinters` follow the same pattern as the existing `entityTypes` registry. They live as new namespaces on `AuthoringContributions`. They're assembled at descriptor-build time via the same merge walker, so within-namespace duplicates throw at pack-load time. They participate in the same cross-registry collision check.

Implementers reading this spec should expect the new code to look very much like the existing `entityTypes` code, structurally. The mechanism is intentionally a copy, not a redesign.

### Pack-owned AST types

When a pack contributes a parser for a new block keyword, the AST node it produces is typed by the pack, not by the framework. The framework's `PslNamespace` carries a generic slot for pack-contributed blocks; entries in that slot share a minimal base shape — a `kind` discriminator string, a required `name`, and a `span`. Downstream consumers (printer, lowering registry, tooling) narrow on `kind`.

`name` is mandatory because every block kind we've shipped or planned has one (`enum Status`, `policy ProfilesSelectAnon`, `role admin`, `model Article`). The mandatory name keeps the base type narrow and the lowering registry's index simple. If a future pack-contributed kind genuinely needs to be anonymous, the base shape can loosen then.

The alternative to a generic slot — adding a typed slot to `PslNamespace` for every contributed block kind (the way `enums: readonly PslEnum[]` works today) — would force every new pack-contributed kind to ship a framework PR. That defeats the point of pack-contributed extensibility.

This is a structural break from how `enum` is modelled today (`PslEnum` lives in the framework's AST types and `PslNamespace` carries a typed `enums` slot). `enum` does not get migrated as part of this project — see the explicit non-goal — so its current shape is unchanged. The new generic slot is purely additive.

### Minimal-by-default parser SPI

A pack-contributed parser receives a parser-context handle (token cursor, source text, diagnostic sink) and a small set of helpers — only what the integration-test fixture's parser actually consumes. Framework-internal helpers stay framework-private until a real consumer demands lift.

The reason: this project ships the substrate without a real-world migration to validate it. The first real consumer is RLS, in a downstream project. A maximalist SPI shipped now would publish a stable surface that turns out not to fit RLS's needs (or fits them awkwardly). Ship the minimum; let RLS surface gaps as they hit them; lift helpers into the SPI when there's a real second consumer.

### Discriminator string convention

Pack-contributed AST nodes use a discriminator string of the form `<target-or-family>-<kind>` — e.g. `postgres-policy`, `postgres-role`, `mongo-collection-validator`. The string is opaque to the framework; the convention is documented as a golden rule, enforced by code review.

The convention exists for namespace hygiene (`postgres-policy` and `pgcrypto-policy` are distinct discriminators) and for diagnostic legibility — when a user sees `unknown discriminator 'postgres-policy'` in a contract that doesn't include the Postgres pack, the error tells them which pack they're missing.

### Round-trip is load-bearing

The existing parser-to-printer-to-parser round-trip test must survive the change: `parsePslDocument → astDocumentToPrintDocument → serializePrintDocument → parsePslDocument` produces an equivalent AST today, and that property must hold for pack-contributed blocks too. The integration-test fixture is the regression test.

### Pack-load-time validation, no silent precedence

Two packs contributing the same `pslBlocks` keyword fail at pack-load time with a clear diagnostic naming both packs. There are no precedence rules.

A `pslBlocks` contribution without a matching `pslPrinters` contribution (same discriminator) fails at pack-load time. Same for the reverse. Same for either of those without a matching `entityTypes` factory.

The reasoning: silent precedence is a maintenance trap, and a missing printer is a half-feature footgun (the user can write the syntax but `contract infer` produces broken output for it). All these failure modes surface at pack-load time, are diagnosed clearly, and are fixed by editing pack contributions — never by the user.

## What this project does not do

**Migrate the `enum` keyword.** An earlier framing of this project was "migrate `enum` from the framework parser to the Postgres pack as the load-bearing proof-of-concept." That framing was wrong: `enum` is an application-level concept that happens to have target-specific storage representations (Postgres native enum, SQLite TEXT, MongoDB string), not a Postgres-flavoured feature that should live only in the Postgres pack. Making `enum` work uniformly across targets is tracked separately in [TML-2815](https://linear.app/prisma-company/issue/TML-2815). This project intentionally leaves `enum` framework-parsed.

That decision means this project ships the substrate without a real-world migration to validate it. The integration-test fixture (described in the project DoD) substitutes for that validation; RLS becomes the first real consumer once it lands.

**Custom attribute parsers** (`@policy(…)`, `@auth(…)`, etc.). Attributes live inside other blocks and have a different SPI shape from top-level block parsers — they consume tokens within a parent parse rather than driving one. Different lifecycle, different error-recovery model. This project covers top-level blocks only; attribute extensibility is a separate concern.

**Pluggable expression grammar.** PSL's expression grammar (used in attribute arguments, default values) stays framework-owned.

**Migrating `model`, `type`, `types`, `namespace` to pack-contributed.** These are framework primitives every multi-storage target needs; pushing them to packs would mean every target ships the same parser. No semantic clarity is gained.

**Real RLS implementation.** RLS is a separate project (`projects/postgres-rls/`). This project's integration-test fixture mimics RLS-shaped syntax to exercise the substrate, but ships no real RLS code (no DDL emission, no migration verifier, no runtime enforcement).

**Per-target printer variation.** The printer is target-agnostic. Pack-contributed printers are also target-agnostic; if target-specific rendering is ever needed, it belongs in the planner or emitter, not the printer.

## Project-DoD

This project is done when:

1. **`AuthoringContributions` exposes `pslBlocks` and `pslPrinters` namespaces.** Each is structurally parallel to the existing `entityTypes` namespace. Type narrowing is end-to-end strong: a pack's contributed parser's return type narrows to the AST node shape its printer and factory consume.

2. **Pack-load-time validation is wired up.** Within-namespace duplicates throw via the existing merge walker. Cross-namespace collisions surface via the existing collision check, extended to cover the new namespaces. Discriminator mismatches between `pslBlocks`, `pslPrinters`, and `entityTypes` are caught at pack-load time with a diagnostic naming the contributing pack and the offending discriminator.

3. **The framework parser's top-level dispatch consults `pslBlocks`** for unknown identifiers before falling back to the existing "unknown top-level keyword" diagnostic. Built-in keywords (`model`, `type`, `types`, `namespace`, `enum`) continue to be framework-parsed directly.

4. **The framework printer's two phases consult `pslPrinters`.** The AST-to-PrintDocument phase consults the registry to populate the print-document intermediate for pack-contributed blocks; the PrintDocument-to-string phase consults the registry to render those entries to text.

5. **An integration test contributes a fixture target pack** that ships a `pslBlocks.<keyword>` parser, a matching `pslPrinters.<keyword>` printer, and a matching `entityTypes.<keyword>` factory — all using the same discriminator. The fixture's keyword and AST shape mimic RLS-style top-level blocks (block name, named-arg body, string-valued predicates) so the SPI gets exercised on a realistic shape. The test runs the round-trip parse → lower → IR class instance → serialize → hydrate → IR class instance → print → re-parse and asserts the result matches the original. The fixture lives in test-only code; no production-pack contribution ships from this project.

6. **The existing parser-printer round-trip test continues to pass** for framework-parsed blocks (`model`, `enum`, `type`, etc.).

7. **A clean diagnostic surfaces** when a contract uses a top-level keyword that no in-scope pack contributes. Diagnostic shape names the unknown keyword and points at the offending span.

8. **`contract infer` works for pack-contributed block kinds.** Verified by the integration-test fixture's round-trip.

9. **Three-layer extensibility ADR lands.** Names IR / lowering / parsing+printing as the three corners; pins the discriminator convention; cites ADR 221 as the IR layer's authority. Subsystem docs reference it.

10. **`AGENTS.md` references `AuthoringContributions.entityTypes` correctly.** The current doc-bug (`AuthoringContributions.entities`) is fixed.

11. **Project directory deleted.** `projects/target-contributed-psl-blocks/` removed; in-tree references scrubbed per `.cursor/rules/doc-maintenance.mdc`.
