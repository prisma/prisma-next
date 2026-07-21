# Manual QA — TML-2986 (native types as bare scalars)

> **Be the user.** You are a Prisma Next developer authoring a `.prisma` schema who wants postgres-native column types (`Uuid`, `VarChar(191)`, `Numeric(10,2)`, …) without the `@db.*` attribute detour. You author schemas, run `prisma-next contract emit`, and read the emitted `contract.json` / `contract.d.ts` and the CLI's diagnostics.
>
> **Out of scope of this script.** Do NOT re-run the parity test suites, `pnpm fixtures:check`, `pnpm lint:deps`, or `pnpm typecheck` — CI owns those (see "Scenarios deliberately not in this script"). Do NOT drive the language server as a primary surface (completions/semantic tokens are secondary for this slice; the exploratory charter may touch them). Do NOT run migrations or connect to a database — this slice is contract-emission only.
>
> **Spec:** `projects/remove-db-attributes/slices/native-types-as-scalars/spec.md`
> **Project spec:** `projects/remove-db-attributes/spec.md`
> **Plan:** `projects/remove-db-attributes/plan.md`
> **PR:** https://github.com/prisma/prisma-next/pull/975

**Acceptance criteria** (the slice spec's "Slice-specific done conditions", in written order):

- **AC-1** — For each of the eleven mappings, bare-type authoring (both positions, with and without args where optional) emits the identical `{ codecId, nativeType, typeParams }` as the `@db.*` equivalent — including omitted-optional-arg forms.
- **AC-2** — `Json` → `pg/json@1` and `Jsonb` → `pg/jsonb@1`.
- **AC-3** — Operator gate resolved: symbol-table simplification either done, or an escalation with rationale is on the operator's desk.
- **AC-4** — `pnpm fixtures:check` clean; `pnpm lint:deps` clean.

## Table of contents

| # | Scenario                                                           | What it proves                                                                                              | Isolation | Covers           |
| - | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------- | ---------------- |
| 1 | Author all eleven native types + `Jsonb` and emit **(judgement)**  | A user can write every former `@db.*` type as a bare scalar, in both positions, and get a legible, spec-conformant contract | workspace | AC-1, AC-2       |
| 2 | Feed invalid type arguments and judge the diagnostics **(negative control, judgement)** | Bad args (`VarChar(0)`, `Uuid(1)`, `Timestamp(1.5)`) fail with diagnostics a user can act on without reading framework source | workspace | AC-1             |
| 3 | Re-enact the `Json` upgrade trap **(judgement)**                   | Bare `Json` now emits native `json` (not `jsonb`); `Jsonb` emits `jsonb`; legacy `@db.Json` is unchanged — the exact trap an upgrading user hits | workspace | AC-2             |
| 4 | Emit `@db.*` and bare spellings side by side **(judgement)**       | The old `@db.*` syntax still works and emits byte-identical type entries to the new bare spellings (coexistence until slice 4) | workspace | AC-1             |
| 5 | Exploratory: probe odd type combinations **(exploratory)**         | Probe unanticipated states (lists, optionals, defaults, type-alias chains, precedence)                       | workspace | (no AC; charter) |

> Scenarios marked **(negative control)** plant a violation, observe the gate fire, then restore. Scenarios marked **(judgement)** require runner evaluation against an explicit oracle that no test can easily assert. Scenarios marked **(exploratory)** are time-boxed charters with no scripted steps.
>
> The **Isolation** column tells the runner how to schedule the scenario in parallel: `tmpdir` (own scratch dir, shared read-only clone), `workspace` (own `git worktree`), `read-only` (no isolation needed), or `external` (network-bound; rate-limit-aware).
>
> **Why everything is `workspace`:** `prisma-next contract emit` loads a TypeScript config that imports `@prisma-next/postgres/config`, which must resolve against the repo's installed `node_modules`. Each scenario therefore works in its own disjoint scratch directory *inside* `examples/prisma-next-demo/` (`qa-scratch-<N>/`, gitignored-by-restore). Because the scratch directories are disjoint, a runner that wants to economize on worktrees may safely co-locate these scenarios in a single worktree; the tags state the strict contract, not a serialization requirement.

## Pre-flight

Run once per worktree the scenarios execute in:

1. From the repo root, confirm the branch: `git rev-parse --abbrev-ref HEAD` → expect `tml-2986-native-types-as-scalars` (or the merged state of PR #975).
2. `pnpm install` (populates `examples/prisma-next-demo/node_modules`, including the `prisma-next` CLI bin).
3. `pnpm build` (Turbo; cached rebuilds are cheap).
4. Sanity-check the CLI answers:

   ```bash
   cd examples/prisma-next-demo
   ./node_modules/.bin/prisma-next contract emit --help
   ```

   Expect the help panel for `contract emit` with `--config` and `--output-path` options.
5. Clean-tree baseline: `git --no-optional-locks status --short` from the repo root — note any pre-existing untracked files so the Restore steps can distinguish scenario debris from prior state.

**Path-resolution gotcha for all scenarios:** the `contract:` path inside a `config.ts` resolves relative to *the config file's directory*, not the CWD you invoke from. Keep each scenario's `schema.prisma` beside its `config.ts` and reference it as `./schema.prisma`.

## Scenario 1 — Author all eleven native types + `Jsonb` and emit

**What you're proving from the user's seat:** the headline journey of this slice, end to end: a developer writes every former `@db.*` type as a bare scalar type — in `types {}` declarations *and* directly in field position, with and without optional args — runs `prisma-next contract emit`, and gets a contract whose type entries match the spec's table exactly and whose files are legible. CI's parity tests assert the shapes structurally; what a human adds is the multi-command journey (litmus answer 4) and the judgement call on whether `contract.json` / `contract.d.ts` read sensibly to the person who will consume them (litmus answer 3).

**Covers:** AC-1, AC-2

**Isolation:** `workspace`

**Oracle:** the mapping table in the slice spec (`spec.md` § "Chosen design"), which itself mirrors `NATIVE_TYPE_SPECS` in `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts`. Expected emissions:

| Authored type      | codecId            | nativeType          | typeParams                    |
| ------------------ | ------------------ | ------------------- | ----------------------------- |
| `Uuid`             | `pg/uuid@1`        | `uuid`              | (none)                        |
| `SmallInt`         | `pg/int2@1`        | `int2`              | (none)                        |
| `Real`             | `pg/float4@1`      | `float4`            | (none)                        |
| `Date`             | `pg/timestamptz@1` | `date`              | (none)                        |
| `VarChar(191)`     | `sql/varchar@1`    | `character varying` | `{ "length": 191 }`           |
| `VarChar` (bare)   | `sql/varchar@1`    | `character varying` | **key absent**                |
| `Char(12)`         | `sql/char@1`       | `character`         | `{ "length": 12 }`            |
| `Numeric(10, 2)`   | `pg/numeric@1`     | `numeric`           | `{ "precision": 10, "scale": 2 }` |
| `Timestamp(3)`     | `pg/timestamp@1`   | `timestamp`         | `{ "precision": 3 }`          |
| `Timestamptz(6)`   | `pg/timestamptz@1` | `timestamptz`       | `{ "precision": 6 }`          |
| `Time(3)`          | `pg/time@1`        | `time`              | `{ "precision": 3 }`          |
| `Timetz(2)`        | `pg/timetz@1`      | `timetz`            | `{ "precision": 2 }`          |
| `Json`             | `pg/json@1`        | `json`              | (none)                        |
| `Jsonb`            | `pg/jsonb@1`       | `jsonb`             | (none)                        |

**Preconditions:**

- Pre-flight completed in this worktree.
- No `examples/prisma-next-demo/qa-scratch-1/` directory exists.

### Steps

1. Create the scratch project:

   ```bash
   cd examples/prisma-next-demo
   mkdir -p qa-scratch-1
   cat > qa-scratch-1/config.ts <<'EOF'
   import { defineConfig } from '@prisma-next/postgres/config';

   export default defineConfig({
     contract: './schema.prisma',
   });
   EOF
   ```

2. Author a schema exercising every type in **named-type position** (the `types {}` block) and every type in **field position** (directly on model fields), plus the bare-name form:

   ```bash
   cat > qa-scratch-1/schema.prisma <<'EOF'
   // use prisma-next

   types {
     TUuid        = Uuid
     TSmallInt    = SmallInt
     TReal        = Real
     TDate        = Date
     TVarChar     = VarChar(191)
     TVarCharBare = VarChar
     TChar        = Char(12)
     TNumeric     = Numeric(10, 2)
     TTimestamp   = Timestamp(3)
     TTimestamptz = Timestamptz(6)
     TTime        = Time(3)
     TTimetz      = Timetz(2)
     TJson        = Json
     TJsonb       = Jsonb
   }

   model ViaNamedTypes {
     id  TUuid        @id
     f1  TSmallInt
     f2  TReal
     f3  TDate
     f4  TVarChar
     f5  TVarCharBare
     f6  TChar
     f7  TNumeric
     f8  TTimestamp
     f9  TTimestamptz
     f10 TTime
     f11 TTimetz
     f12 TJson
     f13 TJsonb
   }

   model ViaFieldPosition {
     id  Uuid @id
     f1  SmallInt
     f2  Real
     f3  Date
     f4  VarChar(191)
     f5  VarChar
     f6  Char(12)
     f7  Numeric(10, 2)
     f8  Timestamp(3)
     f9  Timestamptz(6)
     f10 Time(3)
     f11 Timetz(2)
     f12 Json
     f13 Jsonb
   }
   EOF
   ```

3. Emit:

   ```bash
   ./node_modules/.bin/prisma-next contract emit --config qa-scratch-1/config.ts --output-path qa-scratch-1/out
   ```

4. Inspect the named-type entries:

   ```bash
   node -e "const c = require('./qa-scratch-1/out/contract.json'); console.log(JSON.stringify(c.storage.types, null, 2))"
   ```

5. Inspect the field-position columns (table keys are camelCased model names):

   ```bash
   node -e "const c = require('./qa-scratch-1/out/contract.json'); const t = c.storage.namespaces.public.entries.table; console.log(JSON.stringify(t.viaFieldPosition.columns, null, 2)); console.log(JSON.stringify(t.viaNamedTypes.columns, null, 2))"
   ```

6. Open `qa-scratch-1/out/contract.d.ts` in a pager/editor and read the type declarations that correspond to the two models.

### What you should see

- Step 3 exits 0 and reports both artifacts emitted with their hashes.
- Step 4: fourteen entries under `storage.types`, each `{ "kind": "codec-instance", ... }` matching the oracle table row for row — pay particular attention to: `TDate` carrying `pg/timestamptz@1` with `nativeType: "date"` (the explicit pin); `TVarCharBare` having **no** `typeParams` key at all (not `typeParams: {}`, not `length: null`); `TNumeric` carrying *both* `precision` and `scale`.
- Step 5: `viaFieldPosition` columns carry the same `{ codecId, nativeType, typeParams }` per the oracle, with no `typeRef`; `viaNamedTypes` columns carry the same shapes *plus* a `typeRef` naming the declared type (e.g. `"typeRef": "TUuid"`).
- Step 6 — **judgement**: `contract.d.ts` compiles the same information into readable type declarations; nothing looks corrupted, duplicated, or misnamed. A developer skimming it could tell which column is `varchar(191)` vs bare `varchar`.

### Failure modes (anything matching these = a finding the runner will classify)

- Emit fails or produces diagnostics on any of the fourteen spellings in either position.
- Any emitted `{ codecId, nativeType, typeParams }` deviates from the oracle table (wrong codec, wrong native type, extra/missing/renamed typeParams keys, `typeParams` present on an omitted-arg form).
- Field position and named-type position disagree with each other for the same spelling.
- `contract.json` or `contract.d.ts` is structurally legible but semantically confusing (e.g. bare vs parameterized forms indistinguishable in `contract.d.ts`).

### Restore

```bash
rm -rf qa-scratch-1
git --no-optional-locks status --short   # expect the baseline from Pre-flight step 5, nothing new
```

## Scenario 2 — Feed invalid type arguments and judge the diagnostics

**What you're proving from the user's seat:** the arg-validation guard actually gates, and its diagnostics are usable. CI proves invalid args are *rejected*; only a human can judge whether the message a user actually sees names the problem, points at the offending schema location, and is actionable without reading framework source (litmus answers 2 and 3).

**Coverage boundary:** this proves the guard fires on the three constructed violations below — an out-of-range int (`VarChar(0)`), args passed to a no-arg constructor (`Uuid(1)`), and a non-integer literal (`Timestamp(1.5)`). It does not prove every malformed argument shape is rejected; the exploratory charter (scenario 5) may probe further.

**Covers:** AC-1 (the "≥ 1" / "≥ 0" / no-arg constraints in the spec's contributions table)

**Isolation:** `workspace`

**Oracle:** the constraints column of the slice spec's contributions table (`length` ≥ 1, `precision` ≥ 0 for time-ish types, `Uuid` takes no args), plus the diagnostic-quality bar: *the message names the field, the constructor, the violated constraint, and the source location (`file:line:col`); a user could fix the schema from the message alone.*

**Preconditions:**

- Pre-flight completed in this worktree.
- No `examples/prisma-next-demo/qa-scratch-2/` directory exists.

### Steps

1. Set up the scratch project:

   ```bash
   cd examples/prisma-next-demo
   mkdir -p qa-scratch-2
   cat > qa-scratch-2/config.ts <<'EOF'
   import { defineConfig } from '@prisma-next/postgres/config';

   export default defineConfig({
     contract: './schema.prisma',
   });
   EOF
   ```

2. Plant violation 1 — out-of-range length:

   ```bash
   cat > qa-scratch-2/schema.prisma <<'EOF'
   // use prisma-next

   model T {
     id Uuid @id
     a  VarChar(0)
   }
   EOF
   ./node_modules/.bin/prisma-next contract emit --config qa-scratch-2/config.ts --output-path qa-scratch-2/out; echo "exit=$?"
   ```

3. Plant violation 2 — args on a no-arg constructor:

   ```bash
   cat > qa-scratch-2/schema.prisma <<'EOF'
   // use prisma-next

   model T {
     id Uuid @id
     a  Uuid(1)
   }
   EOF
   ./node_modules/.bin/prisma-next contract emit --config qa-scratch-2/config.ts --output-path qa-scratch-2/out; echo "exit=$?"
   ```

4. Plant violation 3 — non-integer precision:

   ```bash
   cat > qa-scratch-2/schema.prisma <<'EOF'
   // use prisma-next

   model T {
     id Uuid @id
     a  Timestamp(1.5)
   }
   EOF
   ./node_modules/.bin/prisma-next contract emit --config qa-scratch-2/config.ts --output-path qa-scratch-2/out; echo "exit=$?"
   ```

5. Repeat violation 1 in named-type position, to check the diagnostic quality holds there too:

   ```bash
   cat > qa-scratch-2/schema.prisma <<'EOF'
   // use prisma-next

   types {
     Bad = VarChar(0)
   }

   model T {
     id Uuid @id
     a  Bad
   }
   EOF
   ./node_modules/.bin/prisma-next contract emit --config qa-scratch-2/config.ts --output-path qa-scratch-2/out; echo "exit=$?"
   ```

### What you should see

- Every step exits non-zero; no contract artifacts are written for the failing schemas.
- Each failure prints a structured error with an `Issues` list. For reference, violation 1 on the branch under test produced: `[PSL_INVALID_ATTRIBUTE_ARGUMENT] Field "T.a" constructor "VarChar" Authoring helper argument at VarChar[0] must be >= 1, received 0 (./schema.prisma:5:6)`.
- **Judgement, per violation:** read each diagnostic as if you'd never seen this codebase. Does it name the offending field/type and constructor? Does it state the violated constraint and the received value? Does the span (`file:line:col`) point at the actual offending token? Would you know what edit to make? Note any diagnostic that describes internals ("Authoring helper argument at VarChar[0]") in vocabulary a schema author wouldn't recognize — legibility observations are findings even when rejection itself works.
- Step 5's diagnostic should be at least as clear as step 2's — the named-type indirection must not degrade the message or the span.

### Failure modes (anything matching these = a finding the runner will classify)

- Any invalid schema emits successfully (guard doesn't fire).
- A diagnostic omits the offending location, names the wrong construct, or states no actionable constraint.
- Diagnostic copy requires framework-internal knowledge to decode.
- Named-type position produces a materially worse diagnostic than field position for the same violation.
- Artifacts from a previous successful run are left in place after a failing run in a way that could mislead (stale `out/contract.json` newer than the last good schema — note what the CLI does here).

### Restore

```bash
rm -rf qa-scratch-2
git --no-optional-locks status --short   # expect the Pre-flight baseline, nothing new
```

## Scenario 3 — Re-enact the `Json` upgrade trap

**What you're proving from the user's seat:** the one deliberate semantic change of this slice, driven exactly the way an upgrading user will hit it. Before this slice, bare `Json` meant `jsonb` storage; now it means native `json`, and `Jsonb` is the new name for `jsonb`. A user who upgrades without reading the release notes and keeps `Json` in their schema will silently get a different native type. CI proves the new bindings; the human re-enacts the trap flow and confirms the contract makes the change *visible* on inspection (litmus answers 1 and 3 — this is the closest thing the slice has to a motivating-bug-report flow, in anticipation).

**Covers:** AC-2

**Isolation:** `workspace`

**Oracle:** the project spec's settled decision (2026-07-09): on postgres, `Json` = `pg/json@1` / native `json`, `Jsonb` = `pg/jsonb@1` / native `jsonb`, always — plus the slice spec's edge-case row: legacy `@db.Json` on a `Json` base still yields `pg/json@1` (untouched this slice).

**Preconditions:**

- Pre-flight completed in this worktree.
- No `examples/prisma-next-demo/qa-scratch-3/` directory exists.

### Steps

1. Set up:

   ```bash
   cd examples/prisma-next-demo
   mkdir -p qa-scratch-3
   cat > qa-scratch-3/config.ts <<'EOF'
   import { defineConfig } from '@prisma-next/postgres/config';

   export default defineConfig({
     contract: './schema.prisma',
   });
   EOF
   ```

2. Author the "upgrading user's" schema — a `Json` field written back when `Json` meant jsonb, alongside the new `Jsonb` spelling and the legacy `@db.Json` form:

   ```bash
   cat > qa-scratch-3/schema.prisma <<'EOF'
   // use prisma-next

   types {
     LegacyJson = Json @db.Json
   }

   model Doc {
     id       Uuid @id
     payload  Json
     payloadB Jsonb
     payloadL LegacyJson
   }
   EOF
   ```

3. Emit and inspect all three JSON columns:

   ```bash
   ./node_modules/.bin/prisma-next contract emit --config qa-scratch-3/config.ts --output-path qa-scratch-3/out
   node -e "const c = require('./qa-scratch-3/out/contract.json'); const cols = c.storage.namespaces.public.entries.table.doc.columns; for (const k of ['payload','payloadB','payloadL']) console.log(k, JSON.stringify(cols[k]))"
   ```

### What you should see

- `payload` (bare `Json`): `codecId: "pg/json@1"`, `nativeType: "json"` — **not** `jsonb`. This is the trap: if you see `jsonb` here, the re-bind didn't land.
- `payloadB` (`Jsonb`): `codecId: "pg/jsonb@1"`, `nativeType: "jsonb"`.
- `payloadL` (legacy `Json @db.Json`): `codecId: "pg/json@1"`, `nativeType: "json"` — the legacy path still accepts a `Json` base and emits identically to bare `Json` (byte-stable per the slice's edge-case table).
- **Judgement:** looking only at the emitted `contract.json`, can a user diagnose that their old `Json` field now means native `json`? The `nativeType` values are the visible signal — confirm they're present and unambiguous on all three columns.

### Failure modes (anything matching these = a finding the runner will classify)

- Bare `Json` still emits `pg/jsonb@1` / `jsonb` (re-bind missing) — the upgrade trap fires silently in the wrong direction.
- `Jsonb` fails to resolve or emits anything other than `pg/jsonb@1` / `jsonb`.
- `@db.Json` on a `Json` base is rejected (base-type validation broke when the scalar map entry changed codec) or emits a different shape than bare `Json`.
- The emitted contract gives no legible signal distinguishing `json` from `jsonb` columns.

### Restore

```bash
rm -rf qa-scratch-3
git --no-optional-locks status --short   # expect the Pre-flight baseline, nothing new
```

## Scenario 4 — Emit `@db.*` and bare spellings side by side

**What you're proving from the user's seat:** coexistence, from the seat of a user mid-migration: until slice 4 removes `@db.*`, a schema can carry both spellings, and mechanically rewriting `String @db.VarChar(191)` to `VarChar(191)` changes nothing in the emitted contract. CI's parity tests prove this pairwise in fixtures; the human proves it on a *single live schema mixing both syntaxes* — the actual halfway state a migrating user's schema will be in — and eyeballs the deep-equality of the emitted entries (litmus answers 3 and 4).

**Covers:** AC-1

**Isolation:** `workspace`

**Oracle:** deep equality (ignoring the type's name) between each `storage.types` entry pair produced by the legacy and bare spellings of the same native type. The step-5 `node` one-liner mechanizes the comparison; the spec's parity requirement ("identical `{ codecId, nativeType, typeParams }`") is the standard.

**Preconditions:**

- Pre-flight completed in this worktree.
- No `examples/prisma-next-demo/qa-scratch-4/` directory exists.

### Steps

1. Set up:

   ```bash
   cd examples/prisma-next-demo
   mkdir -p qa-scratch-4
   cat > qa-scratch-4/config.ts <<'EOF'
   import { defineConfig } from '@prisma-next/postgres/config';

   export default defineConfig({
     contract: './schema.prisma',
   });
   EOF
   ```

2. Author one schema carrying legacy/bare pairs — a parameterized case, a two-arg case, an omitted-optional-arg case, and a no-arg case:

   ```bash
   cat > qa-scratch-4/schema.prisma <<'EOF'
   // use prisma-next

   types {
     SlugOld    = String @db.VarChar(191)
     SlugNew    = VarChar(191)
     AmountOld  = Decimal @db.Numeric(10, 2)
     AmountNew  = Numeric(10, 2)
     FreeOld    = String @db.VarChar
     FreeNew    = VarChar
     IdOld      = String @db.Uuid
     IdNew      = Uuid
     StampOld   = DateTime @db.Timestamptz(6)
     StampNew   = Timestamptz(6)
   }

   model Pairs {
     id  IdNew @id
     a1  SlugOld
     a2  SlugNew
     b1  AmountOld
     b2  AmountNew
     c1  FreeOld
     c2  FreeNew
     d1  IdOld
     e1  StampOld
     e2  StampNew
   }
   EOF
   ```

3. Emit:

   ```bash
   ./node_modules/.bin/prisma-next contract emit --config qa-scratch-4/config.ts --output-path qa-scratch-4/out
   ```

4. Print the paired entries:

   ```bash
   node -e "const c = require('./qa-scratch-4/out/contract.json'); console.log(JSON.stringify(c.storage.types, null, 2))"
   ```

5. Mechanized pair comparison (stable-stringify each pair; expect five `MATCH` lines):

   ```bash
   node -e "
   const c = require('./qa-scratch-4/out/contract.json');
   const t = c.storage.types;
   const stable = (o) => JSON.stringify(o, Object.keys(o).sort());
   for (const [a, b] of [['SlugOld','SlugNew'],['AmountOld','AmountNew'],['FreeOld','FreeNew'],['IdOld','IdNew'],['StampOld','StampNew']]) {
     console.log(stable(t[a]) === stable(t[b]) ? 'MATCH ' + a + ' == ' + b : 'DIFF  ' + a + ' vs ' + b + '\n  ' + stable(t[a]) + '\n  ' + stable(t[b]));
   }"
   ```

### What you should see

- Step 3 exits 0 — the mixed-syntax schema is accepted whole; no diagnostic complains about either spelling.
- Step 5 prints `MATCH` for all five pairs.
- **Judgement on step 4's output:** the `FreeOld`/`FreeNew` pair both omit `typeParams` entirely (the omitted-optional-arg parity the AC calls out); nothing in any entry betrays *which* syntax produced it — the contract is spelling-agnostic.

### Failure modes (anything matching these = a finding the runner will classify)

- Any pair prints `DIFF` — parity broken for that mapping.
- The mixed schema is rejected, or `@db.*` produces a deprecation-style diagnostic already (slice 4's job, not this slice's).
- Omitted-optional-arg forms disagree between spellings (e.g. one emits `typeParams: {}`).

### Restore

```bash
rm -rf qa-scratch-4
git --no-optional-locks status --short   # expect the Pre-flight baseline, nothing new
```

## Scenario 5 — Exploratory: probe odd type combinations

**Charter.** Explore the new bare native types with a scratch project (same setup shape as scenarios 1–4, in `examples/prisma-next-demo/qa-scratch-5/`) for 30 minutes; discover resolution behaviours, diagnostics, or emitted shapes that surprise you. Candidate probes — pick freely, don't try to exhaust:

- Lists: `tags VarChar(10)[]`, `Uuid[]` — do arrays of native types resolve, and what does the contract say?
- Optionality: `nick VarChar(50)?`, bare `Char?` — nullable flags vs typeParams interplay.
- Defaults on native-typed fields: `createdAt Timestamp(3) @default(now())`, `id Uuid @id @default(uuid())` — do the classic attribute defaults still compose with the new types?
- Named type referencing another named type (`A = VarChar(10)` then `B = A`?) — alias chains: legal or diagnosed?
- Precedence: declare `types { Uuid = VarChar(10) }` — does a user-declared name shadow the target-contributed type, and is whatever happens comprehensible? Similarly an enum named `Real`.
- Argument edge values: `Numeric(1)` (one arg of two), bare `Numeric`, `Timestamp(0)` (spec says precision ≥ 0 — boundary should pass), `VarChar(1)` (boundary), huge values like `VarChar(1000000)`.
- Unknown names: `field VarCha(10)` (typo) — how good is the "unknown type" diagnostic now that native names are first-class?
- If time remains: open a schema using the new types in the language server (editor with the Prisma Next LSP) and note completions/semantic-token behaviour — secondary surface, observations welcome, no pass/fail.

**Covers:** (no specific AC; surfaces unknowns)

**Isolation:** `workspace`

**Time budget:** 30 minutes. Stop when the timer rings even if you have ideas left — log them as candidate scenarios for a future round.

**Notes capture:** Write what you tried (schema snippets + emitted/diagnosed results), what surprised you, and anything that "felt off" but you can't yet name. Findings get classified in the report the same way scripted-scenario findings do. Finish with `rm -rf qa-scratch-5` and a `git --no-optional-locks status --short` check.

## Scenarios deliberately not in this script

| AC   | Why it's not a manual-QA scenario                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 (the parity *test suites* themselves) | CI runs the eleven-mapping parity tests on every push; re-running them locally proves only that your machine matches CI. The user-observable behaviour behind them is covered by scenarios 1, 2, and 4. |
| AC-3 | Internal refactor decision (symbol-table `scalarTypes` retirement) with no user-observable surface. Verifying it means reading the PR diff or the operator escalation — a review activity, not manual QA. |
| AC-4 | `pnpm fixtures:check` and `pnpm lint:deps` are CI gates over today's clean tree; re-running them adds nothing a human can catch. No new guardrail was added by this PR that would warrant a negative control against these gates. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| AC-1  | 1 (journey + shape judgement), 2 (arg-constraint negative control), 4 (coexistence parity) — test suites themselves: see "Scenarios deliberately not in this script" |
| AC-2  | 3 (upgrade-trap re-enactment); touched by 1                                                                 |
| AC-3  | (internal; not manual-QA scope) — see "Scenarios deliberately not in this script"                           |
| AC-4  | (CI; not manual-QA scope) — see "Scenarios deliberately not in this script"                                 |
