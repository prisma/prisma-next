# Dispatch D18 R2 — fix the emit lowering gap, then complete the example setup

Continuation of D18 (the prior round surfaced a real production gap mid-work; partial work is on disk uncommitted). Implementer tier: sonnet.

## The gap (diagnosed — don't re-investigate from scratch)

`prisma-next contract emit` parses `policy_select` (D18 R1 fixed parse by passing `pslBlockDescriptors`/`codecLookup` in `provider.ts`) but does **not lower** it into `contract.json`. Root cause: in `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` (~2235), `createNamespaceWithExtensions` is built **only when `input.createNamespace` is defined**:

```
const createNamespaceWithExtensions =
  input.createNamespace !== undefined ? (nsInput, enumTypes) => { ...inject extensionEntities... } : undefined;
```

The emit path (the example's `prismaContract` config) supplies **no** custom `createNamespace`, so the wrapper is `undefined`, the lowered entities in `namespaceExtensionEntities` are never injected, and they're dropped. The adapter tests only worked because they passed `postgresCreateNamespace`. This is review-finding **F05** (parsed block silently dropped) on the real CLI path.

## Fix (must stay generic — no RLS/target symbols in `contract-psl`)

Make lowered extension entities reach `entries[kind]` **even when no custom `createNamespace` is supplied**. Promote `extensionEntities[kind] → entries[kind]` generically (the entities are already keyed by entity kind in `namespaceExtensionEntities`). Concretely: when `input.createNamespace` is undefined, still construct a namespace builder (or augment `buildSqlContractFromDefinition`'s default namespace construction) that merges the namespace's `extensionEntities` into its `entries` generically — for ALL kinds, by string key, with zero knowledge of `rlsPolicy`/RLS. Confirm:
- The change names no target concept (grep: no `rls`/`policy` added to `contract-psl`).
- When a custom `createNamespace` IS passed (adapter tests, `postgresCreateNamespace`), behavior is unchanged (it still handles extensionEntities itself — don't double-inject).
- The promoted entries serialize into `contract.json` under `entries.rlsPolicy` (the emitted JSON is generic; the typed `PostgresSchema` is reconstructed on deserialize by the serializer, which already handles it).

If the cleanest fix would require RLS-specifics in `contract-psl`/SQL-family, or a refactor materially larger than "promote extensionEntities generically in the no-custom-createNamespace path" — **halt and surface** the design question.

## Then complete D18 (the on-disk partial work)

The shim (roles + `auth.uid()`), `examples/supabase/src/contract.prisma` (owner column + `policy_select`), and the `provider.ts` parse-fix are already on disk — keep them. After the lowering fix:
1. **Re-emit** the example (`pnpm --filter <example> emit`) → `contract.json` MUST now contain the `rlsPolicy` entry with a content-addressed wire name. Commit the regenerated `contract.json` + `contract.d.ts`.
2. **Skeleton test** `examples/supabase/test/skeleton.integration.test.ts`: `db init` apply emits ENABLE RLS + CREATE POLICY for `public.profile`; `db verify` passes (`verifyResult.ok === true`); profile round-trip handles the new `owner_id`.

## Gates (run once, foreground)

`pnpm build` → workspace `pnpm typecheck` → the example test suite → `contract-psl` unit tests (the no-custom-createNamespace promotion — add/extend a unit test there proving a lowered extension entity lands in `entries[kind]` WITHOUT a custom createNamespace) → both walking-skeleton + lifecycle e2es (unchanged) → `pnpm lint:deps` → `pnpm fixtures:check`.

## Scope

In: the interpreter promotion fix + its unit test; complete D18 (re-emit, skeleton create+verify-clean). **Out:** the runtime filtering + out-of-band-drop→verify-fails behavioral e2e (D19).

## Constraints

Explicit-staging — do NOT stage `test/integration/.../cipherstash-encrypted-*` or `trace.jsonl`. `tml-2868:` prefix, no amend, **no push**. No `any`/bare casts. Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt`. Low budget → commit the fix + re-emit first, report the rest.

## Return shape

The promotion fix (where + how it stays generic, grep-confirmed); the contract-psl unit test; the re-emitted `contract.json` rlsPolicy fragment (quote it); skeleton-test result; gate results; `git show --stat HEAD` (no cruft); commit SHA(s); anything surprising. Begin.