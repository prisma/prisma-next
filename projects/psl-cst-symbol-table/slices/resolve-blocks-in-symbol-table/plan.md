## Dispatch plan

**Slice spec:** `projects/psl-cst-symbol-table/slices/resolve-blocks-in-symbol-table/spec.md`
**Linear:** TML-2929

**Validation gate:** per-dispatch `pnpm --filter <pkg> typecheck` + `pnpm --filter <pkg> test` + `pnpm lint:deps`; slice DoD = workspace `pnpm build` + `pnpm typecheck` + `pnpm test:packages` + `pnpm lint:deps`, diagnostic codes preserved.

### Dispatch 1: resolve-blocks-in-buildSymbolTable

- **Outcome:** `BuildSymbolTableOptions` gains a **required** `pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace`. `BlockSymbol` gains `block: PslExtensionBlock`, populated by `buildSymbolTable` (look up descriptor by keyword via `findBlockDescriptor`; reconstruct via the `reconstructExtensionBlock` logic MOVED into the symbol-table build; descriptor-free fallback for unknown keywords). `reconstructExtensionBlock`/`reconstructParamValue`/`reconstructFromExpression` move out of `extension-block.ts` into the symbol-table build (psl-parser internal); `extension-block.ts` keeps `findBlockDescriptor` + `validateExtensionBlockFromSymbol` (now reading `block.block`, not re-reconstructing). ALL `buildSymbolTable` callers updated to pass `pslBlockDescriptors` (the 2 providers from `authoringContributions.pslBlockDescriptors`; the ~11 test sites explicitly — real descriptors where the test uses blocks, `{}` otherwise). psl-parser + both provider packages typecheck; psl-parser tests cover block resolution.
- **Builds on:** Slice 4's resolved symbol table.
- **Hands to:** `BlockSymbol.block` — the resolved block both the SQL factory path and the policy_select validation consume directly in D2.
- **Focus:** psl-parser symbol-table + `extension-block.ts` trim + every call-site arg update + tests. The SQL `enum-block.ts` deletion is D2.

### Dispatch 2: consume-resolved-block-delete-enum-block

- **Outcome:** SQL's enum factory path reads `BlockSymbol.block` directly; `packages/2-sql/2-authoring/contract-psl/src/enum-block.ts` (the reconstruction) is deleted (its `reconstructExtensionBlock` is now in the symbol-table build). The policy_select round-trip test + the SQL enum tests consume `BlockSymbol.block` / `validateExtensionBlockFromSymbol` over `block.block`. `rg 'reconstructExtensionBlock' packages/2-sql packages/2-mongo-family` empty. Slice DoD: workspace-wide gate green, all diagnostic codes preserved, the four packages (psl-parser, both contract-psl, psl-printer) green.
- **Builds on:** D1's `BlockSymbol.block`.
- **Hands to:** Slice complete — block resolution in `buildSymbolTable`, no downstream reconstruction.
- **Focus:** SQL interpreter enum path + `enum-block.ts` deletion + tests + the workspace gate. (Mongo has no blocks — only its provider's new arg, done in D1.)
