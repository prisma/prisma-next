# Slice: resolve-blocks-in-symbol-table

_Parent project: `projects/psl-cst-symbol-table/`. Outcome: block (`PslExtensionBlock`) resolution moves back into `buildSymbolTable` — where `parsePslDocument` had it on `main` — instead of being reconstructed downstream by consumers. `pslBlockDescriptors` becomes a required `buildSymbolTable` argument._

> **Operator note — recorded tension.** The operator approved adding the resolved block to the symbol table **temporarily** and is **not happy** that `PslExtensionBlock` is the carried shape. This slice restores the single-resolver shape (block resolution in `buildSymbolTable`, matching `main`); whether `PslExtensionBlock` is the right long-term carried shape (vs. a leaner resolved block symbol) is **deliberately left open** as a follow-up, not settled here.

## At a glance

On `main`, `parsePslDocument` resolved an `enum`/`policy_select` block into a `PslExtensionBlock` (name + descriptor-classified `parameters` + `blockAttributes` + spans). Slices 1–3 made the new parser NOT produce it, so consumers reconstruct it (`extension-block.ts` in psl-parser, `enum-block.ts` in SQL). This slice moves that resolution **into `buildSymbolTable`**: a `BlockSymbol` carries its resolved `PslExtensionBlock`, built once at symbol-table construction. Because descriptor-driven classification (`ref`/`option`/`value`/`list`) needs the block descriptors, `buildSymbolTable` gains a **required** `pslBlockDescriptors` argument — finally answering project Open Question #1 (descriptors live as a `buildSymbolTable` input, as the legacy parser had them).

```ts
const { table, diagnostics } = buildSymbolTable({
  document,
  sourceFile,
  scalarTypes,
  pslBlockDescriptors,   // NEW — required (AuthoringPslBlockDescriptorNamespace)
});
// BlockSymbol now carries the resolved block:
//   interface BlockSymbol { kind:'block'; name; keyword; node; span; block: PslExtensionBlock }
```

## Chosen design

1. **`pslBlockDescriptors` required on `BuildSymbolTableOptions`.** Type `AuthoringPslBlockDescriptorNamespace` (from `@prisma-next/framework-components/authoring`). Required, not optional — block resolution can't classify params without it, and every real caller has it (providers from `authoringContributions.pslBlockDescriptors`; tests pass it explicitly, empty `{}` when the schema has no blocks).
2. **`BlockSymbol` carries `block: PslExtensionBlock`.** `buildSymbolTable` resolves each generic block at construction: look up its descriptor by keyword (`findBlockDescriptor`), reconstruct the `PslExtensionBlock` (the existing `reconstructExtensionBlock` logic, **moved** from `extension-block.ts` into the symbol-table build path), and attach it to the `BlockSymbol`. A block whose keyword has no registered descriptor: keep current behaviour (the interpreter's unknown-top-level-block rejection still fires from the keyword; the `block` is still reconstructed descriptor-free so consumers see the parsed shape — match what `extension-block.ts` did with an absent descriptor).
3. **Descriptor-driven validation stays a separate concern.** `validateExtensionBlock` (framework) is NOT moved into `buildSymbolTable` — keep it where consumers invoke it (the `validateExtensionBlockFromSymbol` helper), now over `BlockSymbol.block` instead of re-reconstructing. (Validation needs `codecLookup` + ref-resolution context the symbol table doesn't carry; only the *reconstruction* moves.)
4. **Delete the downstream reconstruction.** `reconstructExtensionBlock` + `reconstructParamValue`/`reconstructFromExpression` move into the symbol-table build (psl-parser internal). `extension-block.ts` keeps only `findBlockDescriptor` (used by the build) + `validateExtensionBlockFromSymbol` (now reads `block.block`). SQL's `enum-block.ts` reconstruction is deleted — the SQL enum factory path reads `BlockSymbol.block` directly.
5. **All callers pass the new arg.** ~13 sites: the 2 providers (from `authoringContributions.pslBlockDescriptors`), and the test sites (explicit descriptors where the test uses blocks — e.g. the enum + policy_select tests — else `{}`).

## Coherence rationale

One PR, one outcome: "block resolution lives in `buildSymbolTable` (with descriptors as a required input); the downstream reconstruction is gone." A reviewer holds it as the block-level mirror of slice 4's field-resolution move. Builds directly on slice 4.

## Scope

**In:**
- `packages/1-framework/2-authoring/psl-parser/`: `BuildSymbolTableOptions` (+required `pslBlockDescriptors`), `BlockSymbol.block`, block resolution in the build, move `reconstructExtensionBlock` in, trim `extension-block.ts`, tests.
- SQL `contract-psl`: delete `enum-block.ts` reconstruction; the enum factory path reads `BlockSymbol.block`; provider passes descriptors; tests.
- Mongo `contract-psl`: provider passes descriptors (Mongo has no blocks, so `{}`-equivalent from its contributions); tests.
- All `buildSymbolTable` call sites pass the new required arg.

**Out:**
- The printer + introspection (`sqlSchemaIrToPslAst`) path — it builds `PslExtensionBlock` from the IR independently of the parser; untouched. `PslExtensionBlock` the **type** stays (printer/introspection own it).
- `validateExtensionBlock` framework function (unchanged; only its caller reads `block.block` now).
- The open question of whether `PslExtensionBlock` is the right carried shape (recorded follow-up; not settled).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Block keyword with no registered descriptor | Reconstruct descriptor-free (current `extension-block.ts` behaviour with `descriptor: undefined`); unknown-block rejection still fires interpreter-side from the keyword | Preserves the slice-3 `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK` behaviour. |
| Mongo passes `pslBlockDescriptors` but has no blocks | Required arg still passed (from Mongo's `authoringContributions`); no blocks → no `BlockSymbol.block` work | The arg is required for signature consistency; empty/contribution-derived is fine. |
| `policy_select` round-trip test | Reads `BlockSymbol.block` + `validateExtensionBlockFromSymbol` (now over `block.block`) | Must stay green at full parity — same codes, same validation. |

## Slice-specific done conditions

- [ ] `BuildSymbolTableOptions.pslBlockDescriptors` is required; `BlockSymbol.block: PslExtensionBlock` is populated by `buildSymbolTable`; psl-parser tests cover block resolution (enum + a descriptor-typed block + an unknown-keyword block).
- [ ] `rg 'reconstructExtensionBlock' packages/2-sql packages/2-mongo-family` is empty (no consumer-side reconstruction); SQL `enum-block.ts` reconstruction deleted.
- [ ] Workspace gate green (`pnpm build` + `pnpm typecheck` + `pnpm test:packages` + `pnpm lint:deps`), all diagnostic codes preserved; the four affected packages (psl-parser, both contract-psl, psl-printer) green.

## Open Questions

1. **[recorded, not settled] Is `PslExtensionBlock` the right carried shape on `BlockSymbol`?** The operator is unhappy carrying it. A leaner resolved-block symbol (not the legacy `PslExtensionBlock`) may be better long-term, but that requires changing the validator + printer + introspection contract too — out of this slice. Carried as the project's standing block-shape follow-up.

## References

- Slice 4 (`resolve-in-symbol-table`) — the field-resolution analogue this mirrors.
- Reconstruction being moved: `packages/1-framework/2-authoring/psl-parser/src/extension-block.ts`, `packages/2-sql/2-authoring/contract-psl/src/enum-block.ts`.
- Descriptor type: `AuthoringPslBlockDescriptorNamespace` in `@prisma-next/framework-components/authoring`.
- `PslExtensionBlock` (the carried shape, unchanged) + `validateExtensionBlock`: `framework-components/.../psl-extension-block.ts` / `psl-extension-block-validator.ts`.
