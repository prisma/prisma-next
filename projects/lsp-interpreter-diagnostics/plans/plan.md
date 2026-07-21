# lsp-interpreter-diagnostics — execution plan

## Assumptions

**Spec:** [`../spec.md`](../spec.md)

- **A1 — Capability home dependency edge.** `@prisma-next/psl-parser` gains a dependency
  on `@prisma-next/config` (downward: authoring → core), which it does not have today.
  `architecture.config.json` / dependency-cruiser already permit this direction;
  `pnpm lint:deps` is the arbiter (spec: "Place in the larger world").
- **A2 — No shared assembly: `ControlStack` exposes the missing property (settled,
  operator 2026-07-09).** `ContractSourceContext` is a pure property bag; the only
  non-pick was `composedExtensionContracts`, whose structural cast exists because
  core's `ExtensionDescriptor` doesn't declare `contractSpace` (family-level concern).
  Root-cause fix: `createControlStack` — which already structurally reads
  `contractSpace.contractJson` at `control-stack.ts:409–417` for load ordering —
  exposes `extensionContracts: ReadonlyMap<string, Contract>` on the stack
  (framework-components already depends on `@prisma-next/contract`). Context
  construction then becomes pure property-picking at every consumer, typecheck-policed;
  the one unavoidable cast relocates into `createControlStack` beside the existing
  structural read, and the CLI's two inline blindCasts are deleted (net ratchet ≤ 0).
  No helper, no shared module; `toExtensionInputs` and the CLI's descriptor-import
  boundary stay untouched. During M2, check whether the stack's existing
  `extensionIds` equals `extensionPacks.map(p => p.id)` (order included) — if so,
  `composedExtensionPacks` is a pick too.
- **A3 — Interpreter signature fit.** `interpretPslDocumentToSqlContract` /
  `interpretPslDocumentToMongoContract` already accept `symbolTable`, `sourceFile`,
  `sourceId`, `seedDiagnostics` plus context- and options-derived inputs (verified in
  both providers). `interpret` calls the same function with empty `seedDiagnostics` and
  returns the diagnostics side of the `Result` (both `ok` with warnings and `notOk`
  cases yield `readonly ContractSourceDiagnostic[]`).
- **A4 — Provider options capture.** The capability is attached inside
  `prismaContract()` where `options.target` / `createNamespace` / `enumInferenceCodecs`
  are in scope, so `PslInterpretInput` + `ContractSourceContext` suffice as the
  `interpret` parameters — no options plumbing through the LSP.
- **A5 — LSP interpret memoization site.** The per-document-version memo lives in
  `project-artifacts.ts` alongside `DocumentArtifacts` (same
  `documentChanged`/`documentClosed` invalidation), as an interpret slot populated
  lazily — not in `runPipeline`.
- **A6 — Config-failure diagnostics ride the existing push channel.**
  `sendDiagnostics` on the config-file URI, unconditionally (even when the client
  supports pull), per spec. The config URI is derived from `configPath` via the
  server's existing path/URI helpers.
- **A7 — Last-good retention is a `startProjectLoad`/`stopManagingProject` change.**
  Today a failed load funnels awaiters into `stopManagingProject` (deletes the entry,
  clears diagnostics). The change: on *reload* failure with `hadLoadedProject`, keep
  serving the previous `ProjectState`; only a project that never loaded is dropped.
- **A8 — Working branch / Linear.** Linear issue
  [TML-2984](https://linear.app/prisma-company/issue/TML-2984) (team Terminal,
  project "Language Tools Support Prisma Next PSL"); working branch
  `tml-2984-lsp-interpreter-diagnostics`. No release cut: the project is done when
  merged to `main` (operator, 2026-07-09).

## Test cases

Derived from the Project DoD (AC numbers = DoD order) and cross-cutting requirements.

| TC | Verifies | AC / requirement |
| --- | --- | --- |
| TC-1 | `hasPslInterpreter` narrows only on runtime evidence: psl provider with `interpret` → true; `typescript` provider → false; opaque/unknown `sourceFormat` → false; `sourceFormat: 'psl'` without the method → false | capability seam; zero-casts requirement |
| TC-2 | arktype config schema admits open `sourceFormat` strings and providers carrying `interpret`; existing configs (sql + mongo contract-ts/psl fixtures) validate unchanged | Contract impact |
| TC-3 | All in-repo `ContractSourceProvider` consumers compile against the union; exhaustive matches on the closed enum treat unknown strings as opaque | Transitional-shape constraint 1 |
| TC-4 | sql provider: `interpret` over parse+symbol-table artifacts returns exactly the interpreter-stage diagnostics `load` reports for the same content (seed diagnostics excluded) | AC7; build/editor parity |
| TC-5 | sql provider: `interpret` on malformed-but-parseable input returns diagnostics, never throws | interpreters-never-throw |
| TC-6 | mongo provider: same as TC-4 | AC7 |
| TC-7 | mongo provider: same as TC-5 | interpreters-never-throw |
| TC-8 | `ControlStack.extensionContracts` carries each contract-space-bearing extension's contract keyed by space id; CLI emit behavior unchanged (existing emit tests + `pnpm fixtures:check` green); grep gate: no `contractJson` casts outside framework-components | AC5 (amended) |
| TC-9 | LSP diagnostics response contains interpreter diagnostics with correct LSP ranges mapped from line/column spans | AC1 (positioning half) |
| TC-10 | Span-less interpreter diagnostic anchors at document start, not dropped | AC8 |
| TC-11 | Provider without the capability (typescript source, capability-less psl provider, opaque provider): LSP diagnostics byte-for-byte identical to pre-change behavior | AC3; graceful degradation |
| TC-12 | Semantic tokens / folding / completion never invoke `interpret` (spy); repeated diagnostic pulls on unchanged content interpret at most once; an edit invalidates the memo | AC4; lazy interpretation |
| TC-13 | Config load failure (throwing `createControlStack` / `loadConfig`) → push diagnostic on the config-file URI at (0,0)–(0,1); successful reload clears it | AC9 |
| TC-14 | Failed config *reload* keeps the last-good project serving schema diagnostics, config diagnostic alongside; first-load failure still yields no project | AC10 |
| TC-16 | Playground manual QA: unresolvable relation appears live positioned on the span, disappears on fix, no restart; config break/fix cycle on the config URI | AC1, AC9 (manual halves) |
| TC-17 | `pnpm lint:deps` green with the new psl-parser → config edge; cast-ratchet count unchanged | AC6 |

| TC-18 | Core `ControlExtensionDescriptor` declares `contractSpace?: ContractSpace`; both family overrides compile as covariant narrowings; `assembleExtensionContracts` + load-order reads use typed access; tightened grep gate: zero `contractJson` casts repo-wide | AC12 (scope addition) |

_TC-15 (end-to-end parity test, former AC2) dropped by operator decision (2026-07-09);
the spec's DoD is amended accordingly. Build/editor parity is held by construction
(one shared inner interpretation function per provider, pinned by TC-4/TC-6), span
mapping by TC-9, and the end-to-end story by playground QA (TC-16). AC numbering below
retains the original DoD order; AC2 is retired._

## Milestones

### Implement M1: Provider union + capability seam

**Status:** ✓ Complete — merged to main as PR #939 (2026-07-10)

_Outcomes_
`ContractSourceProvider` is a `sourceFormat`-keyed union (`Psl…`/`TypeScript…`/`Opaque…`
with open `sourceFormat?: string`); `@prisma-next/psl-parser/interpret` exports
`PslInterpretInput`, `PslInterpretCapable`, `hasPslInterpreter`; every in-repo consumer
compiles; repo green on `main`. Nothing implements the capability yet — the guard
returns `false` everywhere, by design.

**Shipping strategy:** purely additive types + a guard nobody calls yet. The union is
backwards-assignable for existing providers (they all set `'psl'`/`'typescript'` or
omit `sourceFormat`); the arktype widening accepts strictly more. The dead guard is the
gate separating old from new behavior.

**Tasks:**

- [ ] Rework `contract-source-types.ts`: split `ContractSourceProvider` into the
      three-member union with the opaque member's open `sourceFormat?: string`; adapt
      the arktype schema in `config-types.ts` (widen `sourceFormat` to `string`, no new
      required keys); adapt all in-repo consumers surfaced by typecheck
      (contract-ts/contract-psl config-types, LSP `schema-inputs.ts`, CLI `format`)
      (satisfies: TC-2, TC-3)
- [ ] Add `@prisma-next/psl-parser/interpret` export path (mirroring `/syntax`,
      `/format`): `PslInterpretInput` (document, sourceFile, symbolTable, sourceId),
      `PslInterpretCapable`, and `hasPslInterpreter` with discriminant + method-presence
      runtime evidence; add the psl-parser → config dependency (satisfies: TC-1)
- [ ] Gate: `pnpm lint:deps` (new edge + layering), `pnpm typecheck`,
      `pnpm test:packages`, cast-ratchet unchanged (satisfies: TC-17)

### Implement M2: ControlStack exposes extension contracts

**Status:** ✓ Complete — merged to main as PR #948 (2026-07-13, combined with M2b)

_Outcomes_
`ControlStack` carries `extensionContracts: ReadonlyMap<string, Contract>`, built by
`createControlStack` beside its existing structural read of
`contractSpace.contractJson`; the CLI emit path constructs `ContractSourceContext`
by pure property picks (its two inline blindCasts deleted); emit output is
bit-identical to before. "Context assembly" ceases to exist as a concept.

**Shipping strategy:** additive stack property + behavior-preserving simplification
of the CLI's lines 196–225, validated by the existing emit test suite and
`fixtures:check`. The LSP does not consume it yet. Test fixtures constructing
stack-shaped objects surface via typecheck and gain the new property.

**Tasks:**

- [ ] Add `extensionContracts` to `ControlStack`, populated in `createControlStack`
      from each contract-space-bearing extension descriptor, keyed by space id; the
      `contractJson → Contract` cast lives here and only here; adapt stack-shaped
      test fixtures surfaced by typecheck (satisfies: TC-8)
- [ ] Check whether `stack.extensionIds` equals `extensionPacks.map(p => p.id)`
      (order included); if yes, use it for `composedExtensionPacks`, else keep the
      id map inline (satisfies: TC-8)
- [ ] Simplify `contract-emit.ts` context construction to pure property picks,
      deleting its two blindCasts; add the grep gate (no `contractJson` casts outside
      framework-components) to the slice validation and
      `drive/calibration/grep-library.md` (satisfies: TC-8)
- [ ] Gate: existing emit/e2e tests, `pnpm fixtures:check`, `pnpm lint:deps`,
      cast-ratchet ≤ baseline

### Implement M2b: contractSpace declared on the core extension descriptor

**Status:** ✓ Complete — merged to main as PR #948 (2026-07-13; folded with M2 per operator — the stack rewrote slice 02's internals, so one PR was the coherent reviewable unit). Scope addition, operator-authorized 2026-07-10

_Outcomes_
Core `ControlExtensionDescriptor` carries `contractSpace?: ContractSpace`; sql + mongo
overrides remain as covariant narrowings; the `assembleExtensionContracts` `blindCast`
and the structural descriptor views in `control-stack.ts` are deleted — typed access
end-to-end; the grep gate tightens from "outside framework-components" to "nowhere".
`extensionContracts` stays the consumer surface; only its construction changes.

**Shipping strategy:** type-level addition; optional member, so every existing
descriptor remains valid; families' narrowed overrides are already assignable.
Behavior identical by construction (same values, typed instead of cast).

**Tasks:**

- [ ] Declare the member in core; delete the cast + structural views; verify the
      `MigrationPackage` fit and whether the load-order dependency view can go typed;
      tighten the grep-library gate (satisfies: TC-18)

### Implement M3: Providers implement the capability (sql + mongo)

**Status:** ✓ Complete — merged to main as PR #971 (2026-07-14; incl. review rounds: `interpret` returns the full Result, `load` delegates via `this.interpret`, seeds merge externally via `withSeedDiagnostics`)

_Outcomes_
Both `prismaContract()` factories return providers satisfying `PslInterpretCapable`
with **zero casts**; each provider's `load` and `interpret` share one inner
interpretation function; `hasPslInterpreter` returns `true` against real configs.
The two provider changes are indepenndent and may land in either order (spec:
transitional-shape constraint 3) — parallelizable dispatches.

**Shipping strategy:** additive method on the returned provider object; `load`
behavior is unchanged (same inner function, same seed diagnostics). No consumer calls
`interpret` in production yet.

**Tasks:**

- [ ] sql `contract-psl`: refactor `provider.ts` so `load` delegates to an inner
      `interpret`-shaped function (artifacts + context → diagnostics/contract); attach
      the typed `interpret` to the returned source object; empty `seedDiagnostics`,
      interpreter-stage findings only; no-throw on recovered input (satisfies: TC-4, TC-5)
- [ ] mongo `contract-psl`: same shape (satisfies: TC-6, TC-7)
- [ ] Guard integration test: `hasPslInterpreter` narrows a real
      `prismaContract(...)` config for both providers (satisfies: TC-1)
- [ ] Gate: `pnpm typecheck`, `pnpm test:packages`, cast-ratchet unchanged (TC-17)

### Implement M4: LSP interpreter diagnostics (lazy, mapped, degrading)

**Status:** ✓ Complete — merged to main as PR #972 (2026-07-14; incl. R2 offset-based span mapping after the framework-vocabulary ratchet)

_Outcomes_
The LSP serves interpreter diagnostics on pull and push for capability-bearing
configs: cached artifacts fed to `interpret`, results memoized per document version,
spans mapped line/column → LSP ranges, span-less diagnostics anchored at document
start. Capability-less configs behave byte-for-byte as today. Semantic
tokens/folding/completion untouched by the interpreter.

**Shipping strategy:** the `hasPslInterpreter` guard is the gate — configs whose
providers lack the method (older packages, typescript source) take the existing code
path unchanged. Diagnostics never ship without position mapping (spec:
transitional-shape constraint 2), so span mapping lands in the same slice as the
interpret stage.

**Tasks:**

- [ ] `config-resolution.ts`: build the full `ContractSourceContext` by property
      picks off the control stack (incl. M2's `extensionContracts`) and carry the
      guarded provider (when `hasPslInterpreter`) in `ConfigResolution`/`ProjectState`
      (satisfies: TC-9 groundwork)
- [ ] `diagnostic-mapping.ts`: map `ContractSourceDiagnostic` (line/column span,
      optional) to `LspDiagnostic` ranges; span-less → synthetic anchor at document
      start (satisfies: TC-9, TC-10)
- [ ] `project-artifacts.ts` + diagnostic assembly (`publish`,
      `buildDocumentDiagnosticReport`): lazy interpret stage at
      diagnostic-assembly time only, memoized per document version, invalidated with
      the existing `documentChanged`/`documentClosed` flow; `runPipeline` untouched
      (satisfies: TC-9, TC-12)
- [ ] Regression test: capability-less provider reproduces today's diagnostics
      byte-for-byte; laziness test with an interpret spy across semantic-token,
      folding, completion, and repeated-pull requests (satisfies: TC-11, TC-12)
- [ ] Gate: `pnpm typecheck`, `pnpm --filter language-server` typecheck of the test
      project, `pnpm test:packages`

### Implement M5: Config-failure surfacing + last-good retention

**Status:** ► In progress — slice 06 delivered (`353e5d4e7`, 4/4 SDoD), PR open; complete on merge

_Outcomes_
A throwing `loadConfig`/`createControlStack` surfaces as a push diagnostic on the
config-file URI at (0,0)–(0,1), cleared on successful reload; a failed *reload* keeps
the last-good project serving schema diagnostics (no wipe); a failed *first* load
behaves as today (no project, config diagnostic shown).

**Shipping strategy:** failure paths only — the success path through
`startProjectLoad`/`loadProject` is untouched, so a healthy config never sees the new
code. Retention replaces today's `stopManagingProject`-on-reload-failure funnel.

**Tasks:**

- [ ] Config-failure diagnostics: catch load/assembly failures in the project-load
      flow, publish on the config-file URI (0,0)–(0,1) via push unconditionally, clear
      on successful reload (satisfies: TC-13)
- [ ] Last-good retention: on reload failure with a previously loaded project, keep
      the prior `ProjectState` serving (schema diagnostics persist); first-load
      failure keeps today's drop behavior (satisfies: TC-14)
- [ ] Gate: `pnpm test:packages` (server test suite covers both failure classes)

### Implement M6: Playground proof, ADR, close-out

**Status:** ☐ Not started

_Outcomes_
The playground shows live interpreter + config diagnostics end-to-end (manual QA
report); the capability-intersection pattern is documented under
`docs/architecture docs/`; `projects/lsp-interpreter-diagnostics/` is deleted. The
project is **done when this is merged to `main`** — no release cut (operator,
2026-07-09); the playground demo is the user-visible proof.

**Shipping strategy:** M1–M5 are already on `main` and inert-or-guarded; this
milestone proves and documents rather than changes behavior.

**Tasks:**

- [ ] `drive-qa-plan` script + `drive-qa-run` report: playground live-diagnostic
      cycle (unresolvable relation appears positioned, disappears on fix, no restart)
      and config break/fix cycle on the config URI (satisfies: TC-16)
- [ ] Author the capability-intersection pattern doc (higher-layer capability type +
      structural attachment at the factory + evidence-based guard) under
      `docs/architecture docs/patterns/`, linked from the patterns index; run the ADR
      audit (AC11)
- [ ] Close-out: walk the Project DoD checklist verbatim (link each AC to its
      TC/test); repo-wide gates (`lint:deps`, `build`, `fixtures:check`); migrate
      long-lived docs into `docs/`; scrub `projects/lsp-interpreter-diagnostics/**`
      references; delete the project directory; Linear Project completed with final
      status update linking the retro

## Open Questions

None — all open flags resolved (OF1: Option A, ControlStack exposes
`extensionContracts`; OF2: end-to-end parity test dropped by operator; OF3: no
release cut; OF4: Linear issue TML-2984).

**Monitoring items** (not blockers):

- The union change (M1) makes `sourceFormat` non-narrowable via bare equality; any
  in-repo code that narrows that way today (`schema-inputs.ts`, CLI `format`) must be
  re-shaped in M1 — typecheck will surface every site (TC-3).
- The LSP currently builds only a *partial* control stack (`scalarTypes` +
  `pslBlockDescriptors`); M4 upgrades it to the full `ContractSourceContext`. Watch
  load-time cost on large configs — mitigated by context assembly happening once per
  config (re)load, not per keystroke.
