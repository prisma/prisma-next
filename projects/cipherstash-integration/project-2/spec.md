# Project 2 — Expanded type/operator surface

> **Status: stub.** Project 2 is a forward-reference held by the [umbrella spec](../spec.md) and the [Project 1 spec](../project-1/spec.md). It will be shaped properly (full description, requirements, acceptance criteria) after Project 1 ships, since each new column type rides on the envelope/codec/PSL/TS/operator pattern Project 1 establishes.
>
> **Linear:** [TML-2375](https://linear.app/prisma-company/issue/TML-2375). Component-level tracking only — no per-task or per-milestone Linear sub-issues.

# Summary

Expand `@prisma-next/extension-cipherstash` from "one column type, two operators" (Project 1) to the full first-attempt surface: `EncryptedNumber`, `EncryptedDate`, `EncryptedBoolean`, `EncryptedJson` column types, plus `orderAndRange` (`gt` / `gte` / `lt` / `lte`) and `searchableJson` operator families. Each type and operator family ships with the same end-to-end-test gate Project 1 enforces (live Postgres + EQL).

# Description

Project 1 ships a deliberately narrow MVP: one column type (`EncryptedString`), two operators (`eq`, `ilike`). Project 2 expands that surface to match what cipherstash users have asked for in the first-attempt repo. Each addition is structurally simple — Project 1 establishes the pattern (envelope class + parameterized codec + bulk-encrypt middleware participation + PSL constructor + TS factory + parity test + operator lowering + end-to-end test), and Project 2 instantiates that pattern per type / operator family.

**What Project 2 does *not* need to do.** [TML-2397](https://linear.app/prisma-company/issue/TML-2397) (contract spaces) shipped the codec lifecycle hook (`onFieldEvent` on `CodecControlHooks`) that emits per-column DDL automatically from contract diffs — for any extension, not just cipherstash. The previous Project 2 mandate to implement `planTypeOperations` integration (and the framework prerequisites it implied — per-column input, prior-state contract for destructive DDL) is obsolete: each new type's codec descriptor wires its own `onFieldEvent` hook the same way the `cipherstash:string@1` codec does on TML-2397. There is no separate "planner integration" milestone — adding a type means adding its codec, which carries its own hook.

The work cleaves cleanly along type / operator family lines:

- **`EncryptedNumber`** — codec round-trip for numeric values; `eq` + `orderAndRange` operators.
- **`EncryptedDate`** — codec round-trip for date/time values; `eq` + `orderAndRange` operators (range queries on dates are the typical use case).
- **`EncryptedBoolean`** — codec round-trip for booleans; `eq` operator only (range / ilike not meaningful).
- **`EncryptedJson`** — codec round-trip for JSON values; `searchableJson` operator family. Carries its own design subtleties (token-policy / path-filter configuration on the PSL constructor that is richer than Project 1's two booleans).

Per the umbrella's "ship only what's tested end-to-end" principle, no constructor lands in the public surface without a corresponding round-trip test. Each type and each operator family is independently shippable; Project 2 sequences them by customer demand once Project 1 lands.

# Dependencies

| Source | Subject | Project 2 dependency |
|---|---|---|
| Project 1 | Envelope class pattern, codec encode/decode pattern, PSL constructor / TS factory / parity test pattern, operator-lowering pattern, bulk-encrypt middleware (already filters by codec id, transparently handles new types) | **Hard** — Project 2 instantiates Project 1's patterns per type. |
| TML-2397 (contract spaces) | Codec lifecycle hook `onFieldEvent`; cipherstash contract space mechanics; per-space verifier; EQL bundle install in the cipherstash contract space's baseline migration | **Hard, satisfied** — already on the contract-spaces base each project rebases against. New types add their own `onFieldEvent` arms. |
| First-attempt repo | EQL search-config index-name mappings for non-string types (e.g. `EncryptedJson` → `'ste_vec'`); operator-lowering templates for `gt`/`gte`/`lt`/`lte` and JSON search; PSL constructor argument shape for `searchableJson` | **Hard, vendored** — `reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts` is the source of truth. |
| `sql-raw-factory` | Optional public `raw\`...\`` factory | **Soft, none** — Project 2 doesn't consume it. |

# Open questions (deferred to shaping)

Recorded here so the shaping driver doesn't have to rediscover them. Each is scoped to a specific type / operator and answered when that type / operator is shaped, not all at once.

- **Mode-flag downgrade semantics** *(applies to all types, not just JSON).* When a contract revision flips a search-mode flag from `true` to `false` (e.g. `equality: true` → `equality: false`), the codec lifecycle hook on TML-2397 fires `onFieldEvent('altered', …)` and emits drop-then-add SQL. The current stub emits *unconditional* drop SQL. The policy question — plan-time warning vs hard error vs unconditional silent drop, when downstream consumers may depend on the index — is unresolved. Owned by whichever Project 2 sub-spec ships the first dropped-flag scenario; likely `EncryptedNumber` since it's the simplest case.
- **Re-encryption migration story** *(applies to all types).* Adopting cipherstash for an existing populated column — flipping a column from plain `Number` to `EncryptedNumber` with rows in place — requires re-encrypting data. The codec hook fires `'altered'` for the type change and emits drop-then-add search-config SQL, but does not touch existing row data. The framework primitive for "re-encrypt existing rows" is unspecified. Could be a hand-authored `dataTransform` op the user invokes once, or a generated planner-emitted op. Plausibly in scope for Project 2; plausibly a future framework primitive. Needs design discussion.
- **Column-key-id surface** *(applies to all types).* Project 1's resolution: routing key is `(table, column)`, no per-column key-id override. Project 2 inherits this default across the expanded type surface. If customer demand surfaces for per-column key-id overrides, the surface is added once on `encryptedString({...})` and inherited by all `encrypted<X>({...})` factories.
- **`searchableJson` semantics** *(applies to `EncryptedJson` only).* EQL's JSON-search-token (`ste_vec`) configuration has more shape than Project 1's two booleans (`equality`, `freeTextSearch`). The PSL constructor for `EncryptedJson` may need richer arguments (path filters, token policy). Concrete shape TBD. Owned by the `EncryptedJson` sub-spec.
- **Order of type rollout.** Customer demand is the right driver. Suggested default: `EncryptedNumber` first (simplest after string; exercises `orderAndRange`), `EncryptedDate` next (similar shape to Number), `EncryptedBoolean` next (smallest scope), `EncryptedJson` last (carries the biggest design open question on `searchableJson`). Reorder freely as customer signals dictate.

# References

- [Umbrella spec](../spec.md)
- [Project 1 spec](../project-1/spec.md) — establishes the patterns Project 2 expands
- [TML-2397 — contract spaces](https://linear.app/prisma-company/issue/TML-2397) — the codec lifecycle hook foundation
- [Framework gaps assessment](../../../reference/framework-gaps.md)
