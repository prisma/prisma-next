# Dispatch 7 — Retire `hydrate?` redundancy + arktype refactor of namespace hydration

**Branch:** `tml-2584-s1a-substrate` (already checked out)
**Executor tier:** `composer-2.5-fast` (Composer-2.5)
**Reviewer tier:** `claude-opus-4-7-thinking-high` (Opus 4.7) — separate dispatch after executor finishes
**Sizing:** **M** — two coupled cleanups in the same surface (SQL family base + Postgres serializer + framework descriptor). Both ride F6: a descriptor field carrying redundant information, and a hand-rolled narrowing chain that a small arktype schema replaces.

**Tier calibration:** the design-judgment sites for both parts are pre-settled in this brief (Part A's `ctx` synthesis pattern with a `POSTGRES_AUTHORING_CTX` constant + factory wrapping at registration time; Part B's arktype schema shape with the `id` fallback positioning and `+:` directive guidance). The implementer's job is strict execution against the enumerated cleanup list — Composer-2.5's calibration target. Any genuine design-call surface that wasn't pre-settled fires a refusal trigger; the orchestrator pre-settles before re-dispatch.

---

## Intent

Two structural cleanups to the substrate surface introduced in this slice, both surfaced by review-time inspection:

### Part A — Drop `hydrate?` from `AuthoringEntityTypeDescriptor`

`hydrate?: (raw: unknown) => Output` was added to the descriptor alongside `output.factory: (input: Input, ctx) => Output` to thread a hydration function through the family-base registry. In practice every consumer's `hydrate` is a typed-input wrapper around the same constructor that `output.factory` calls — for the only concrete consumer (`postgresAuthoringEntityTypes.enum`), the two function bodies are literally `new PostgresEnumType(raw as PostgresEnumTypeInput)` and `new PostgresEnumType(input)`. The framework type carries duplicate information; the family-base serializer should call `descriptor.output.factory(validatedRaw, ctx)` directly, with `ctx` synthesized from the family's own bootstrap-time knowledge.

This is the same F6 pattern as the retired `storageSlotKey?` field — a descriptor surface field carrying information another descriptor field already carries, lifted into the framework type without being challenged at brief-assembly time.

### Part B — Refactor `hydrateSqlNamespaceEntry` to use arktype for raw narrowing

`SqlContractSerializerBase.hydrateSqlNamespaceEntry` (the namespace-hydration loop in `packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`, lines ~110–190) hand-rolls a chain of `as`-casts to narrow a `raw: unknown` namespace envelope into typed property access:

```ts
const obj = raw as Record<string, unknown>;
const id = (obj['id'] as string | undefined) ?? nsId;
const result: Record<string, unknown> = { id };

for (const [propertyKey, slotValue] of Object.entries(obj)) {
  if (propertyKey === 'id') continue;
  if (slotValue === null || typeof slotValue !== 'object') continue;
  // ...
}
```

The whole function is a hand-rolled validator. The replacement: define a small arktype schema for the raw namespace shape (`id` required string, every other property a `Record<string, unknown>` map), run `raw` through it once, work with typed destructuring after. Hydration runs **after** the family-base validator already validated `raw` against the family contract schema (so the schema here is ergonomics + defence-in-depth, not load-bearing safety) — but the cast-chain is exactly what arktype exists to replace.

---

## Files

### Part A — `hydrate?` removal

**Modify:**

1. **`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`**
   - Delete `readonly hydrate?: (raw: unknown) => Output;` field (and its JSDoc) from `AuthoringEntityTypeDescriptor`.
   - `isAuthoringEntityTypeDescriptor` guard does not currently inspect `hydrate`; verify and leave as-is.
   - Update the JSDoc on `AuthoringEntityTypeDescriptor` and `validatorSchema?` to note explicitly: "hydration uses `output.factory` directly — the descriptor's authoring factory is reused for the deserialization path because the wire shape conforms structurally to the factory's `Input` after `validatorSchema` validates it."

2. **`packages/3-targets/3-targets/postgres/src/core/authoring.ts`** (line ~47)
   - Delete the `hydrate: (raw: unknown) => new PostgresEnumType(raw as PostgresEnumTypeInput),` line from `postgresAuthoringEntityTypes.enum`. The factory below it already exists with the same body.

3. **`packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`** (the `collectEntityRegistryContributions` walker, lines 31–55)
   - Replace the `if (value.hydrate !== undefined)` registration with a registration that reads `value.output.factory`. The registry entry must remain a `(raw: unknown) => Output`-shaped function from the family-base's perspective. Synthesize the wrapper at registration time — something like:
     ```ts
     const factory = (value.output as AuthoringEntityTypeFactoryOutput<unknown, unknown>).factory;
     if (typeof factory === 'function') {
       const ctx: AuthoringEntityContext = { family: 'sql', target: 'postgres' };
       entityTypeRegistry.set(
         value.discriminator,
         (raw) => factory(raw, ctx) as Output,
       );
     }
     ```
     (Pseudo-code — pick the right type narrowing and avoid the `as` cast if possible. `AuthoringEntityTypeTemplateOutput` is the alternative `output` shape; this dispatch only handles the `factory` arm. If a descriptor's `output` is a template, skip it — there's no factory to invoke for hydration.)
   - The `ctx` value is `{ family: 'sql', target: 'postgres' }` for the Postgres pack; this is bootstrap-time metadata the pack already knows. Defining a `POSTGRES_AUTHORING_CTX` constant near the top of the file is cleanest.

4. **`packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`** (and any sibling export file)
   - The `SqlEntityHydrationFactory` type alias presumably already describes `(raw: unknown) => unknown` (or similar). Verify the call-site signature still works — the registry consumers in this file just call `factory(entry)` and use the result. The wrapping at registration time keeps the registry's call-site shape stable.

### Part B — Arktype refactor of `hydrateSqlNamespaceEntry`

**Modify:**

5. **`packages/2-sql/9-family/src/core/ir/sql-contract-serializer-base.ts`** (the `hydrateSqlNamespaceEntry` method, lines ~110–190)
   - Define a small arktype schema near the top of the file (or a sibling helpers file if the project's convention prefers it):
     ```ts
     const NamespaceRawSchema = type({
       id: 'string',
       'kind?': 'string',
       '+': 'delete',  // or 'allow' — whichever arktype primitive lets unknown properties pass through
     });
     ```
     **Verify the right `+:` directive** by reading arktype docs / existing schemas in the codebase (`packages/2-sql/1-core/contract/src/validators.ts` and `contract-schema.ts` should have examples). The intent: `id` is required string; everything else is opaque object/scalar that we'll iterate structurally.
   - Replace the `obj as Record<string, unknown>` + `(obj['id'] as string | undefined) ?? nsId` pattern with a schema invocation + typed access. The schema validates and returns a typed object; the slot-loop iterates `Object.entries(typedObj)` with typed values.
   - **Behavior must be byte-identical:**
     - Same handling of the `id` fallback to `nsId` if the raw envelope's `id` differs/is missing (current behavior is `??` — if `id` is `undefined`, fall back to `nsId`). The schema requires `id: 'string'`, so the schema would reject. Two options:
       - (a) Keep `??` for the `id` fallback before schema invocation
       - (b) Make `id` optional in the schema and apply the fallback after
     - Same skip behavior for `id` / non-object slot values inside the loop.
     - Same `entityTypeRegistry.get(kind)` dispatch.
     - Same `hasUnhydratedPostgresEnumEntry` guard at the end (lines 162–181) — left untouched unless the schema makes it tidier; do not change its semantics.
   - Keep the new schema **internal to this file** unless a sibling consumer can be deduplicated; do not add to package exports speculatively.

**Do NOT:**

- Touch `Storage`, `Namespace`, or any IR class.
- Touch the framework validator-composition surface (`namespaceSlotEntrySchema` in `validators.ts`) — that's a separate concern.
- Add `arktype` as a dependency anywhere it isn't already (the SQL family already depends on arktype for `validators.ts`; that's the only addition the SQL family base might need — verify `package.json` and report if it's missing rather than adding silently).
- Reframe the registry's call-site type signature (`SqlEntityHydrationFactory`) — the wrapping happens at registration time so call sites remain stable.
- Touch any test except to update direct consumers of the deleted `hydrate` field if any exist (there should be none — `hydrate?` was descriptor-side only).

---

## Done-when gates (all PASS; gate 4 is load-bearing)

```bash
# 1. Module + type resolution
pnpm typecheck

# 2. SQL family-base tests (the hydration path under refactor)
pnpm --filter @prisma-next/family-sql test

# 3. Postgres target tests (the descriptor consumer)
pnpm --filter @prisma-next/target-postgres test

# 4. ON-DISK BYTE-STABILITY (load-bearing — hydration must produce byte-identical IR instances)
pnpm fixtures:check

# 5. Framework-components tests
pnpm --filter @prisma-next/framework-components test

# 6. SQL + Mongo contract tests
pnpm --filter @prisma-next/sql-contract test
pnpm --filter @prisma-next/mongo-contract test

# 7. Layering
pnpm lint:deps

# 8. Aggregate
pnpm test:packages
```

Pre-existing flakes (`adapter-postgres` integration / `cipherstash` / `cli-telemetry`) are unrelated and have been confirmed pre-existing on `origin/main`.

---

## Verification greps

After the changes, run:

```bash
# No more references to the deleted field
git grep -n '\.hydrate\b\|hydrate?:\|hydrate: (raw' -- '*.ts' ':!**/*.md' ':!projects/'

# No more raw narrowing chain on Record<string, unknown> in hydrateSqlNamespaceEntry
git grep -n 'raw as Record<string, unknown>\|obj\[.id.\] as string' -- 'packages/2-sql/9-family/**'
```

Expected: zero hits for the first command (the `hydrate` field is fully retired); zero hits for the second command (the narrowing chain is gone from the SQL family base).

---

## Commit shape

**Two commits** — one per part, each signed-off (DCO required). Splitting makes review per-concern tractable.

Suggested messages:

```
refactor(framework-authoring): drop redundant hydrate? from AuthoringEntityTypeDescriptor

The hydrate field's function body was always a typed-input wrapper around
output.factory's body; the family-base serializer can call output.factory
directly with the validated raw value, with ctx synthesized from the pack's
own bootstrap-time {family, target} knowledge.

Same F6 pattern as the retired storageSlotKey? field — a descriptor surface
field carrying information another descriptor field already carries.
```

```
refactor(family-sql): replace hand-rolled narrowing in hydrateSqlNamespaceEntry with an arktype schema

The hydration loop's cast-chain (`raw as Record<string, unknown>` +
`obj['id'] as string | undefined ?? nsId` + per-slot `as` casts) is exactly
what arktype exists to replace. A small NamespaceRawSchema narrows `raw`
once; the slot loop iterates typed properties after.

Hydration still runs after the family-base validator, so the schema here is
ergonomics + defence-in-depth — behavior is byte-identical.
```

After both commits land locally and gates pass:

```bash
git push origin tml-2584-s1a-substrate
```

---

## Refusal triggers (HALT and report)

- **`pnpm fixtures:check` fails** — hydration's producing different bytes. Investigate; do not force fixture regen.
- **The `AuthoringEntityContext` type isn't exported from where you need it** — report the actual import surface and recommend the right export; don't synthesize a parallel context type.
- **`output.factory` invocation site has constraints you can't satisfy** (e.g. ctx requires fields the pack-bootstrap doesn't have, or the factory's `Input` type isn't reachable from the registry registration site without complex generic gymnastics) — report. The cast-at-registration approach is the fallback; clean generics is the aspiration.
- **arktype lacks a primitive for "validate `id` as string, pass through everything else"** — report the closest primitive and the gap. Don't write a custom validator wrapper to plug it.
- **The Postgres serializer test assertions reference `hydrate` directly** (e.g. via `expect(descriptor.hydrate).toBeDefined()`) — report. Tests should test behavior, not field presence.

---

## Out of scope

- **SQLite analogue** of the Mongo/SQLite plain-literal cleanup — TML-2648 retains the SQLite portion.
- **Any other `hand-rolled-validation → arktype` refactor in the SQL family base.** Only `hydrateSqlNamespaceEntry` is in scope. `hydrateStorageTypeEntry` (sibling method) has similar shape but is a separate concern.
- **PR description update.** Orchestrator handles this after the dispatch lands.
- **Retro entries.** Orchestrator logs after the dispatch lands.

---

## When you report back

1. Two commit SHAs (one per part) and confirmation push succeeded.
2. Eight gates' PASS/FAIL — gate 4 (`pnpm fixtures:check`) is load-bearing.
3. The two grep verifications (must show zero hits).
4. The actual ctx-synthesis shape you ended up with (was the cast clean? did you need a constant? did `AuthoringEntityContext` come from where the brief expected?).
5. The actual arktype schema you ended up with (what `+:` directive? did you need to handle `id` fallback in or out of the schema?).
6. Any refusal triggers fired or judgment calls.
