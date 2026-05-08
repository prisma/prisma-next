# Migration factories — OBSOLETE (superseded by TML-2397 codec lifecycle hook)

> **This sub-spec is obsolete.** It originally described `cipherstash.addSearchConfig({...})` / `cipherstash.activatePendingSearches()` migration factories that users would invoke from hand-authored `migration.ts` files. The factories produced one `DataTransformOperation` per `(table, column)` carrying `invariantId` for invariant-aware ref routing.
>
> [TML-2397](https://linear.app/prisma-company/issue/TML-2397) (contract spaces) supersedes this entirely. Per-column search-config DDL is now emitted automatically by the **codec lifecycle hook** (`onFieldEvent` on `CodecControlHooks`) when the application emitter diffs the prior contract against the new contract.

# What replaced it

The cipherstash codec lifecycle hook (`packages/3-extensions/cipherstash/src/core/cipherstash-codec.ts` on the contract-spaces base) is a synchronous plan-time function that fires per-field-delta during `prisma-next migrate`'s emit step:

- On `'added'` of an `Encrypted<string>` field with `typeParams.searchable === true`: emits `cipherstash-codec:<table>.<field>:add-search-config@v1` carrying `SELECT eql_v2.add_search_config('<table>', '<field>', …)`.
- On `'dropped'` of a previously-`searchable: true` field: emits `cipherstash-codec:<table>.<field>:remove-search-config@v1`.
- On `'altered'`: emits a rotate op carrying drop-then-add SQL.

The emitted ops land inline in the **app-space** migration's `ops.json` — alongside the user's structural ops — so:

- The user **never writes** `cipherstash.addSearchConfig({ ... })` calls. There is no public migration-factory surface to design or expose.
- The framework's existing migration runner applies the emitted ops the same way it applies structural ops; no new op-class shape is needed.
- Invariant routing is intrinsic — each emitted op carries an `invariantId` of the form `cipherstash-codec:<table>.<field>:<verb>@v<n>`, and TML-2397's per-space planner consumes those when planning `db update` paths.

See [`spec.md` § Per-column search config](../spec.md) for Project 1's view of the codec-hook surface and the [open question](../spec.md#open-questions) on the public-flag-name → EQL-index-name mapping that Project 1 still needs to wire.

# Original spec

The original migration-factories design — `addSearchConfig` / `activatePendingSearches` factory shape, `RawSqlExpr` + `planFromAst` interactions, `DataTransformOperation` integration with PR #404's invariantId — is preserved in git history at `origin/tml-2373-project-1-part-2:projects/cipherstash-integration/project-1/specs/migration-factories.spec.md` for archaeology.

This file stays in the tree as a redirect during M1..M3 execution; M4 (close-out) deletes it.
