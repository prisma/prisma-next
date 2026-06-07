# Project Spec — Extension-contributed top-level PSL blocks (declarative SPI)

## What this is

Today the PSL parser and printer are framework-internal: they handle a fixed set of top-level block keywords (`model`, `type`, `types`, `namespace`, `enum`) and there is no way for an extension to add a new one. Postgres RLS wants `policy { … }`, roles work wants `role { … }`, and future Postgres-specific constructs want others. Each is blocked on the same gap.

This project closes the gap with a **declarative SPI**. An extension contributes a new top-level PSL keyword by registering a **descriptor that describes the block as data** — its keyword, its name, and its typed parameters. The framework owns one generic parser, one generic validator, and one generic printer that interpret *any* declared block. The extension ships **no parsing or printing code**.

```prisma
namespace public {
  model Profile {
    id     String @id
    userId String @unique
  }

  policy_select profiles_select_anon {
    target = Profile
    as     = permissive
    roles  = [anon, authenticated]
    using  = "auth.uid() = user_id"
  }
}
```

After this project lands, the example above is parseable, printable, validatable, and lowerable to contract IR purely from a data descriptor the Postgres extension registers — the framework never learns the `policy_select` keyword directly, and no extension-supplied function runs during parse or print.

### Why declarative, not contributed functions

An earlier cut of this project (PR #718) had each extension ship imperative `parser(ctx): Node` and `printer(node, ctx): string` functions on the descriptor. That was the wrong shape, for reasons that only became clear once the grammar was examined:

- **The PSL grammar is closed and uniform.** A top-level block is a keyword + a name + a body of field declarations, `x = y` assignments, and double-quoted values. The framework parser already knows how to parse all of that for `model`/`enum`/`type`. A contributed `parser` function re-implements, by hand, a subset of parsing the framework already does.
- **A function can't be validated or analysed from its data.** The whole point of a contract-first, agent-friendly layer is that structure is inspectable. A descriptor that *describes* a `policy_select` block as "a name plus parameters `target` (a model reference), `as` (one of permissive/restrictive), `roles` (a list of role references), `using` (a string)" can be validated, documented, autocompleted, and reasoned about without executing anyone's code. A `parser` function is opaque.
- **Arbitrary parse-time code forces defensive machinery.** PR #718 had to catch thrown parsers, handle `undefined` returns, and assert `node.kind === descriptor.discriminator` — an entire class of failure that exists *only because* foreign code runs during parse. Describing blocks as data removes the foreign code and the defence with it.

The closed-grammar premise is the load this rests on, and it has been checked against the first real consumer: an RLS `policy` needs exactly the parameter kinds `ref`, `value`, `option`, and `list` — every one of which already exists somewhere in the grammar (field type references, `@default` literals, `@relation(onDelete: …)` keyword args, `@@index([…])` lists). Zero new primitives.

## The descriptor is data

A block descriptor declares: the keyword, a discriminator string, that the block has a name, and a set of **parameters**. Each parameter has a name, a value-kind, and whether it is required.

```ts
const policySelectDescriptor = {
  keyword: 'policy_select',
  discriminator: 'postgres-policy-select',
  name: { required: true },
  parameters: {
    target: { kind: 'ref',    refKind: 'model', scope: 'same-namespace', required: true },
    as:     { kind: 'option', values: ['permissive', 'restrictive'],     required: false },
    roles:  { kind: 'list', of: { kind: 'ref', refKind: 'role', scope: 'cross-space' }, required: false },
    using:  { kind: 'value',  codecId: 'String', required: true },
  },
};
```

### The parameter value-kind vocabulary

Four kinds, each a distinct operation. The split is principled, not incidental: `ref` *resolves a name*, `value` *serialises a typed datum*, `option` *picks an authoring token*, `list` *combines*.

| Kind | What it is | Backing machinery |
|---|---|---|
| **`ref`** | resolves to a declared entity, carrying `refKind` (what it must resolve to) + `scope` | resolution against the `(spaceId, namespaceId, entityKind, entityName)` coordinate model, with scope ∈ `same-namespace` / `same-space` / `cross-space` (see [PR #745](https://github.com/prisma/prisma-next/pull/745) / TML-2500) |
| **`value`** | a codec-typed value; the codec owns PSL parse / print / encode | the existing codec/type system — the same rails field types and `@default` literals already ride (`DefaultLiteralValue<CodecId, Encoded>`). Subsumes string, int, json, dates, etc.; opaque content (e.g. a SQL predicate string) stays opaque to the framework |
| **`option`** | one of a fixed set of allowed literal tokens (`as = permissive \| restrictive`) | an inline allowed-token list on the descriptor — **authoring-time parameter constraint only**. Not a codec, not a value-set, not a check constraint, **not an enum** (see Non-goals and [PR #748](https://github.com/prisma/prisma-next/pull/748)) |
| **`list`** | a bracketed list of any of the above | combinator |

### `value` rides the codec system; `option` does not

`value` is deliberately *not* a bespoke `string`/`number` kind. A value's type is a **codec**, exactly as a field's type is and a `@default` literal's type is. The codec owns the PSL text ↔ literal hooks. This gives structural parity across the three places PSL carries a typed value (field types, defaults, block parameters) and makes custom types available as parameter values for free, via their codecs.

`option` is the opposite: it is *not* a typed/persisted value. `as = permissive` is configuration of the policy node, not user data, and is never realised as a stored value-set or check constraint. It is a closed set of authoring tokens that constrains what the author may write (and may influence emission), nothing more. Modelling it as an enum would wrongly couple it to the enums-as-domain machinery (PR #748); it stays a lightweight inline constraint.

### Per-block-kind schemas, no conditional logic

Where a parameter's validity depends on context, the answer is **more block kinds, not conditional rules in the descriptor**. Postgres RLS applies `USING` to SELECT/UPDATE/DELETE and `WITH CHECK` to INSERT/UPDATE — so rather than one `policy` block with an `operation` parameter and a rule like "reject `check` when `operation = select`", the extension contributes separate keywords (`policy_select`, `policy_insert`, `policy_update`, `policy_delete`), each with a fixed, unconditional parameter set. The command is carried by the keyword; the wrong-parameter mistake becomes structurally impossible (a `policy_select` descriptor simply has no `check` parameter). The descriptor vocabulary therefore needs **no dependent/conditional-parameter support**, and the substrate must let one extension register **many keywords** (it already does).

## How the framework interprets a declared block

- **Parsing.** On an unknown top-level identifier, the framework consults the registry. If a descriptor claims the keyword, *one generic framework parser* reads the block into a uniform AST node — a name plus a parameter map — using the descriptor to know which parameters exist and their kinds. No contributed code runs.
- **Validation.** *One generic validator* reports unknown parameters, missing required ones, an `option` value outside its set, a `value` the codec rejects, and a `ref` that does not resolve within its declared scope. All at load/parse time, with spans.
- **Codec PSL-literal hooks.** A `value` parameter is parsed and printed through its codec. The encode half (literal → storage) already exists for `@default`; this project adds the PSL-text ↔ literal half (parse + print-back) on the codec/literal machinery — shared infrastructure, one hook per type, reused everywhere.
- **Printing.** *One generic printer* renders any declared block from its descriptor + AST node, for `contract infer`.
- **Lowering.** The uniform AST node lowers to a contract-IR class instance via the existing `entityTypes` factory (keyed by the shared discriminator), unchanged in spirit from #718.

## Place in the world

Three architectural layers carry extension contributions; this project closes the parsing/printing corner declaratively.

| Layer | Mechanism | Status |
|---|---|---|
| IR | three-tier polymorphic class hierarchy (ADR 221) | shipped |
| Semantic lowering (AST node → IR instance) | `AuthoringContributions.entityTypes` factories, keyed by discriminator | shipped |
| Parsing + printing (source text ↔ AST node) | framework-generic, driven by a **declarative block descriptor** | **this project** |

### Relationship to adjacent work

- **[PR #745](https://github.com/prisma/prisma-next/pull/745) / TML-2500 (cross-contract-space references).** `ref` scope (`same-namespace` / `same-space` / `cross-space`) resolves against the `(spaceId, namespaceId, …)` coordinate model and namespace-aware `disjointness` that #745 built. `target` is `same-namespace` (a policy and its table co-locate); `roles` is `cross-space` (Postgres roles are cluster-global, owned by the supabase space in the canonical shape). **#745 is merged, so this is a satisfied build-on, not a blocker** — and only the `cross-space` scope leans on it. `same-namespace` / `same-space` resolution (all `target` needs) is basic name resolution that predates it, so `cross-space` enforcement can be scoped to first-consumer need (RLS roles) without holding up the substrate.
- **[PR #748](https://github.com/prisma/prisma-next/pull/748) / enums-as-domain-concept.** Fully independent — **no dependency in either direction**. A domain enum is a codec + named `valueSet` restriction on *user data*, realised as a value-set + check constraint; an `option` parameter is none of that, and `value` uses ordinary scalar codecs, not enum codecs. Nothing in this project touches #748's machinery, and nothing in #748 touches this.
- **TML-2849 (PSL-AST → `entries`).** The uniform "name + parameter map" AST node a declarative block produces is naturally coordinate-addressable, so converging `PslNamespace` onto ADR 224's `entries[kind][name]` shape (TML-2849) aligns with this design rather than fighting it.
- **ADR 126 (PSL top-level block SPI).** The prior record; it described a `parseFn`/`validateFn`/`emitFn` function SPI. This project supersedes that shape with the declarative descriptor; ADR 126 is revised in the close-out slice to record the change against the as-shipped substrate.

## What this project carries over from PR #718

Cherry-picked (mechanism is sound): the generic `extensionBlocks` slot on `PslNamespace`; the unknown-keyword parser dispatch and clean diagnostic; the load-time validation (within-namespace duplicates, block↔factory matching, duplicate-discriminator rejection, malformed-descriptor rejection); the two-phase printer plumbing and `contract infer` threading; the `entityTypes` lowering link and discriminator convention; the round-trip test harness shape.

Replaced: the descriptor's `parser`/`printer` *functions* → the declarative `parameters` schema + one generic parser/validator/printer. Dropped: the contributed-parser failure-isolation machinery (no contributed code to isolate) and the per-extension parser/printer SPI context helpers (framework-internal now).

## Cross-cutting design constraints

- **Minimal-by-default vocabulary.** Ship exactly the parameter kinds the first consumer (RLS) exercises — `ref`, `value`, `option`, `list` — plus the scope machinery. Defer a `number` kind and field-declaration block bodies until a real consumer needs them. Same minimal-by-default discipline as before, now applied to a *data* vocabulary that is safe to extend later without breaking existing descriptors.
- **Discriminator convention.** Extension-contributed kinds carry a `<target-or-family>-<kind>` discriminator (`postgres-policy-select`); opaque to the framework, used for collision-free routing and lowering-factory matching.
- **Round-trip is required.** `parse → validate → lower → IR → serialize → hydrate → IR → print → re-parse` yields an equivalent block. The integration-test fixture is the regression test.
- **Load-time validation, no silent precedence.** Duplicate keyword, duplicate discriminator, a block with no matching `entityTypes` factory, and a malformed descriptor all fail at load time with clear diagnostics naming the contributing extension.

## Project-DoD

1. **`AuthoringContributions.pslBlocks` carries declarative descriptors** — keyword, discriminator, `name`, and a `parameters` map whose entries are `ref` / `value` / `option` / `list`. No `parser`/`printer` functions on the descriptor.
2. **One generic framework parser** reads any declared block into a uniform AST node (name + parameter map) on the `extensionBlocks` slot, dispatched on an unknown top-level keyword; built-ins stay framework-parsed.
3. **One generic validator** reports, at load/parse time with spans: unknown parameter, missing required parameter, `option` value outside its set, `value` rejected by its codec, and `ref` that does not resolve within its declared scope.
4. **`ref` scope is enforced** against the `(spaceId, namespaceId, …)` coordinate model — `same-namespace` / `same-space` / `cross-space` per #745.
5. **`value` parameters parse and print through their codec.** Codecs gain the PSL-text ↔ literal hooks (the encode half already exists for `@default`).
6. **One generic printer** renders any declared block for `contract infer`; the round-trip is preserved for built-ins and for declared blocks.
7. **The uniform AST node lowers to IR** via the matching `entityTypes` factory.
8. **Load-time validation** rejects duplicate keywords, duplicate discriminators, block-without-factory, and malformed descriptors, naming the extension.
9. **An integration-test fixture extension** registers a declarative descriptor (an RLS-shaped `policy_*` keyword) + a matching factory and round-trips end-to-end. Test-only; no production contribution ships from this project.
10. **PSL AST converges on `entries`** (TML-2849) — `PslNamespace`'s **canonical storage** is ADR 224's `entries[kind][name]`; built-in and contributed kinds are addressed uniformly through the coordinate for generic walkers. The **core entity kinds** (`model`/`enum`/`compositeType`) have special framework semantics, so they retain **typed derived accessors** (`models`/`enums`/`compositeTypes`) over `entries` — each casting its `entries[kind]` slice to the concrete element type once, so framework code reads them at the right type without per-call-site casts. Extension-contributed kinds are reached generically via `entries[discriminator]`. The per-kind array *storage* folds into `entries`; typed *access* to the core kinds is preserved. (This mirrors ADR 224's IR layer: canonical `entries` container + typed concretion accessors — not "delete the typed slots.")
11. **ADR 126 revised** to the declarative + codec-typed SPI; three-layer-extensibility ADR lands; subsystem docs reference it; `AGENTS.md` `entities`→`entityTypes` doc-bug fixed.
12. **Project directory deleted**; in-tree references scrubbed.

## What this project does not do

- **Ship contributed `parser`/`printer` functions.** The descriptor is data; the framework interprets it. (An escape hatch for a block that genuinely cannot be described declaratively is out of scope unless a real consumer needs it — the closed grammar says none should.)
- **Model `option` parameters as enums.** `option` is an authoring-time parameter constraint, not a domain or persistence enum. Enums-as-domain is PR #748, independent.
- **Conditional/dependent-parameter validation.** Context-dependent validity is expressed by separate block keywords with fixed parameter sets, not by rules inside a descriptor.
- **A `number` kind or field-declaration block bodies**, until a real consumer needs them (RLS does not).
- **Real RLS / roles / custom-Postgres-type implementations.** Downstream projects consuming this substrate; the fixture stands in for them.
- **Custom attribute parsers (`@policy(…)`) or a pluggable expression grammar.** Different SPI shapes; separate concerns. SQL inside a `value` string stays opaque to the framework.
- **Migrating `model`/`type`/`types`/`namespace`/`enum` to extensions.** Framework primitives stay framework-parsed.

## Alternatives considered

**Contributed `parser`/`printer` functions (PR #718, superseded).** Re-implements parsing the framework already does, opaque to validation/analysis, and forces parse-time failure-isolation machinery. Replaced by the declarative descriptor + generic interpreter. The mechanism around it is cherry-picked.

**A bespoke `string`/`number` value vocabulary.** Rejected in favour of codec-typed `value`. Field types and `@default` literals are already codec-identified; a parallel scalar enum would be a third type vocabulary. Codec-typed values also make custom types available for free.

**Modelling `as = permissive|restrictive` as an enum.** Rejected — it is a node parameter constraint, not a persisted domain value. Conflating it with enums-as-domain (#748) would create a false dependency. It is an `option`.

**One `policy` block with an `operation` parameter + conditional `using`/`check` rules.** Rejected — puts conditional logic in the descriptor. Replaced by per-command block keywords with fixed parameter sets, which makes invalid combinations structurally impossible and keeps the vocabulary free of dependent-parameter support.

**Migrating the PSL AST to `entries` inside the substrate slice.** Out of scope for the substrate; it is the project's own later slice (TML-2849). The declarative uniform AST node makes the convergence natural.
