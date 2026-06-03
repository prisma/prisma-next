# Slice: e2e-demonstration

_Parent project: [`projects/control-policy/`](../../spec.md). Outcome it contributes: the visible proof that all four control policies behave end-to-end through the public CLI / runtime against PGlite — the project-DoD condition that "all four policies behave end-to-end (verify + plan)" can only be satisfied here, where authoring + planner + verifier meet._

## At a glance

Two CLI integration tests — one PGlite-backed against the Postgres CLI surface, one mongodb-memory-server-backed against the Mongo CLI surface — that author contracts carrying every control policy at once (`managed`, `tolerated`, `external`, `observed`), run the family-appropriate migrate + verify CLI commands, and assert each policy's user-visible behaviour through the public CLI. The Postgres test additionally exercises the spec's motivating mis-declaration case (a `managed` object inside an `external`-defaulted namespace) and asserts both zero-DDL behaviour and the user-visible surfacing of the planner's "managed object suppressed in an external namespace" diagnostic.

To make that diagnostic observable through the CLI, the slice closes [TML-2792](https://linear.app/prisma-company/issue/TML-2792) inline: it threads `SqlPlannerConflict` from a successful plan through `MigrationPlannerSuccessResult.warnings` and surfaces them in the `db update` CLI output. Without that one wiring, the Postgres e2e test cannot assert the diagnostic through public surface; with it, the project's DoD condition closes cleanly. (The diagnostic surface is SQL-only because slice 3 only delivered planner-side control gating for the SQL family — Mongo's "applicable" end-to-end surface is verifier behaviour, which slice 2 shipped.)

## Chosen design

### Test surface

Two new test files under `test/integration/test/`, each authoring a contract with mixed policies and exercising the family-appropriate CLI surface end-to-end:

- **`cli.control-policy.postgres.e2e.test.ts`** — PGlite-backed; uses `withDevDatabase`, `withTempDir`, `setupCommandMocks`, `typescriptContract` from `@prisma-next/sql-contract-ts/config-types`, and the `runDbInit` / `runDbUpdate` / `createDbVerifyCommand` helpers used by `cli.db-update.e2e.test.ts` / `cli.db-verify.e2e.test.ts`. Drives `withClient` for direct DB introspection.
- **`cli.control-policy.mongo.e2e.test.ts`** — mongodb-memory-server-backed; mirrors the structure of `cli.mongo-db-verify.e2e.test.ts` and the Mongo CLI commands (`db schema` / `db verify`); uses the Mongo authoring surface from slice 4 and a Mongo client for direct state introspection.

Each fixture lives under its own subdir of `test/integration/test/fixtures/control-policy/{postgres,mongo}/`.

### Scenarios per family

The Postgres fixture exercises six scenarios; the Mongo fixture exercises four (the fifth and sixth — external-namespace planner safety floor + warning surfacing, and un-plannable-external input-filtering proof — have no Mongo analog because slice 3 didn't deliver Mongo planner-side control gating, and Mongo's "applicable" surface for end-to-end demo is verifier behaviour).

#### Postgres (`cli.control-policy.postgres.e2e.test.ts`)

| Scenario | Authoring | After `db init` | After mismatch + `db verify` |
|---|---|---|---|
| `managed` table | default `managed`; declares `app.users(id, email)` | table created with both columns | drop the table out-of-band → verifier returns **fail** |
| `tolerated` table | per-object `tolerated`; declares `app.audit_log(id, ts)` | created on first init; pre-existing extra column `note` preserved on a subsequent run | declare an **extra** column not in contract → verifier **passes** (extras allowed); drop a **declared** column → verifier **fails** |
| `external` table | `defaultControlPolicy: 'external'` namespace; declares `auth.users(id, email)` referencing a pre-seeded table | **zero DDL** into `auth.*` (table seeded out-of-band before init) | seeded shape matches declared columns → verifier **passes**; pre-seed a column-type drift on a declared column → verifier **fails**; pre-seed an **extra** column not in contract → verifier **passes** (extras allowed in external) |
| `observed` table | per-object `observed`; declares `app.legacy_jobs(id, status)` | **zero DDL** | drop the seeded table or alter a declared column → verifier emits **warning only**, exit code 0 |
| `managed`-in-`external`-namespace | `defaultControlPolicy: 'external'` namespace; declares one object as `controlPolicy: 'managed'` | **zero DDL** into the namespace; **`db update` CLI output surfaces a warning** identifying the suppressed call by table name | _n/a — the assertion is on plan output, not verify_ |
| `external` table in un-plannable state (input-filtering proof) | per-object `external`; declares `auth.opaque(id)`; pre-seeds the live table with column types / constraints / extensions the SQL diff engine does not model (e.g. a `tsvector` column, or a column whose type is provided by a Postgres extension the framework doesn't know) | `db update` succeeds with **zero DDL** into the table; the suppression warning is emitted; **the planner never errors on the un-plannable state** because the table never enters the planner's input | seeded shape diverges from declaration → verifier passes (per `external` semantics: declared shape match is verified, but the un-modeled state is not interpreted as drift); declared column dropped from the seeded table → verifier fails as in scenario 3 |

The fifth scenario is the cross-cutting safety floor named in the project spec ("a contract with `defaultControl: 'external'` plus a `managed` object mis-declared in that namespace produces zero DDL into the namespace and surfaces the conflict diagnostic") — it is the only place the planner's external-namespace suppression diagnostic becomes user-visible, and the slice's TML-2792 wiring exists to make this assertable through CLI output.

#### Mongo (`cli.control-policy.mongo.e2e.test.ts`)

| Scenario | Authoring | After `db schema` (Mongo's "init") | After mismatch + `db verify` |
|---|---|---|---|
| `managed` collection | default `managed`; declares `users` with declared schema | collection materialised with declared validator / indexes | drop the collection out-of-band → verifier returns **fail** |
| `tolerated` collection | per-object `tolerated`; declares `audit_log` | created on first run; pre-existing extra fields in stored documents are not interpreted as drift | seed an **extra** field not declared → verifier **passes**; drop a **declared** field/index → verifier **fails** |
| `external` collection | per-object `external`; declares `auth_users` referencing a pre-seeded collection | **no schema-management actions** on the collection | seeded shape matches declaration → verifier **passes**; seed a declared-field drift → verifier **fails**; seed an extra field → verifier **passes** |
| `observed` collection | per-object `observed`; declares `legacy_jobs` | **no schema-management actions** | drop the seeded collection or drift a declared field → verifier emits **warning only**, exit code 0 |

The fixture deliberately sets `controlPolicy` per object rather than via namespace defaults — Mongo's project spec non-goal "Namespace-level `control` inheritance" applies, and the mis-declaration scenario depends on namespace-defaulting which doesn't exist in Mongo. This matches the project DoD's "where applicable" qualifier.

### Architectural correction: input-side control-policy filtering

Reviewer pushback during PR #711 surfaced a load-bearing assumption in the slice's first cut that does not hold for real-world external schemas: the cut implemented control-policy filtering as a _post-planning_ pass — the planner generates DDL calls for every subject, then `filterCallsByControlPolicy` / `partitionCallsByControlPolicy` discard the calls whose subjects' policies forbid emission, recording the discarded calls as warnings. This works whenever the planner can _generate_ DDL calls for every subject. It fails whenever a subject the user marked `external` (or `observed`) is in a state the planner cannot reason about — exotic column types we don't model, constraints/extensions outside the diff engine's vocabulary, cross-schema FKs to objects the planner doesn't know — because the planner errors before the post-filter runs. Net effect: a user who declared a table `external` precisely so the framework would leave it alone is still blocked from running `db update` on the rest of the schema, because the framework tripped over the table on the way to deciding to ignore it. That inverts the meaning of `external` and `observed`.

The corrected shape is **input-side filtering**:

1. Before the SQL family planner runs, partition the contract's storage subjects (and the corresponding slice of the introspected current state) into `(plannable, suppressed)` by per-subject effective control policy. `managed` subjects go to `plannable`. `external` and `observed` subjects go to `suppressed` unconditionally. `tolerated` is a special case — see below.
2. The planner runs on the `plannable` partition only. It never observes the `external`/`observed` subjects, so it cannot trip on them.
3. Warnings come from the `suppressed` partition directly. We know what the user declared and we know we excluded it from planning — that's enough to construct a `controlPolicySuppressedCall`-equivalent warning per suppressed subject without having had to plan it. (The warning summary becomes `control policy suppressed: <subject> — namespace '<ns>' has effective control '<policy>'`; no planner-DDL-call shape is needed for the warning.)

`tolerated`'s create-if-absent semantics are tractable inside this shape: the planner sees the declared subject, but the planner's diffing logic is short-circuited for tolerated subjects to "if the object exists, emit nothing; if it doesn't exist, emit creation only." The planner never has to reason about the existing object's full state for tolerated subjects, which sidesteps the un-plannable failure mode. (This is a small specialised path inside the planner, not a separate pipeline.)

Postgres adapter implementation lives in the planner's entry point in `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` and the SQL family helpers in `packages/2-sql/9-family/src/core/migrations/control-policy.ts`. The framework planner-result type (`MigrationPlannerSuccessResult.warnings`) is unchanged from the first cut; only its population path moves from "post-filter the planner's output" to "construct warnings directly from the suppressed partition."

### Diagnostic-surfacing wiring (closes TML-2792)

The planner today suppresses control-policy-violating calls silently — `MigrationPlannerSuccessResult` carries only `plan`, with no channel for warnings (`packages/2-sql/9-family/src/core/migrations/types.ts:289–293`). To assert the diagnostic through the CLI, this slice extends the framework `MigrationPlannerSuccessResult` with an optional `warnings: readonly MigrationPlannerConflict[]` field, populates it in the SQL planner's success path with whatever calls `filterCallsByControlPolicy` dropped (carrying a new `SqlPlannerConflictKind: 'controlPolicySuppressedCall'` with the offending table location), and prints them in the `db update` CLI summary alongside the existing "Planned N operation(s)" line.

```text
$ pnpm prisma-next db update --dry-run
Planned 0 operation(s)

Warnings:
  - control policy suppressed: createTable(auth.users) — namespace 'auth' has effective control 'external' but table declared 'managed'
```

The wiring is additive: `warnings` is optional; existing callers and tests are unchanged.

### Authoring shape (illustrative)

```ts
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';

export default typescriptContract({
  target: 'postgres',
  defaultControlPolicy: 'managed',
  spaces: {
    app: {
      namespaces: {
        app: {
          tables: {
            users: t => t.id().column('email', textColumn),
            audit_log: t => t.controlPolicy('tolerated').id().column('ts', timestampColumn),
            legacy_jobs: t => t.controlPolicy('observed').id().column('status', textColumn),
          },
        },
        auth: {
          defaultControlPolicy: 'external',
          tables: {
            users: t => t.id().column('email', textColumn),
            // Mis-declared: per-object override pulls back to 'managed' inside an 'external' namespace.
            // Triggers the diagnostic without changing observable DDL (still zero into auth.*).
            sessions: t => t.controlPolicy('managed').id().column('user_id', textColumn),
          },
        },
      },
    },
  },
});
```

The exact authoring DSL spelling — particularly whether per-namespace `defaultControlPolicy` is a thing and how per-object override syntactically lives on the table builder — is what slice 4 (TML-2778) delivered; the implementer's grep on slice 4's tests is the source of truth and the code above is illustrative, not normative. If slice 4 did not ship per-namespace defaults (the project spec's non-goal "Namespace-level `control` inheritance" deliberately deferred them), this slice realises the `external` namespace by stamping `controlPolicy: 'external'` onto every table inside it; the fixture carries no behaviour change either way.

## Coherence rationale

Both family tests + the diagnostic wiring + the new CLI surface fit one reviewer sitting because they share a single shape — *"each control policy produces its observable, distinct end-to-end behaviour through the public CLI"* — applied to the two families that have public CLI surfaces. The diagnostic-channel wiring (TML-2792) is the load-bearing change without which the Postgres fifth scenario can't be asserted; splitting it into a separate PR would force this slice to assert against a private surface or skip the spec-DoD's "surfaces the diagnostic" condition. Splitting the two families across two slices would force a second slice to re-establish the same authoring + CLI-test scaffolding for one independent assertion file — not a meaningful rollback unit.

## Scope

**In:**

- Two new test files: `test/integration/test/cli.control-policy.postgres.e2e.test.ts` and `test/integration/test/cli.control-policy.mongo.e2e.test.ts` plus their fixture subdirs under `test/integration/test/fixtures/control-policy/{postgres,mongo}/`.
- Extend `MigrationPlannerSuccessResult` in `@prisma-next/framework-components` with optional `warnings: readonly MigrationPlannerConflict[]`.
- Restructure the SQL family planner pipeline so `external` and `observed` subjects are partitioned out of the planner's _input_ before any DDL is generated, not filtered from its _output_. `tolerated` subjects keep their planner entry but follow a create-if-absent short-circuit that does not require diffing the existing object's full state. Warnings are constructed from the suppressed partition directly. The post-filter helper (`filterCallsByControlPolicy`) is replaced by, or reduced to a thin wrapper around, the new input-side path; the existing `controlPolicySuppressedCall` warning kind and its location shape are retained.
- Surface those warnings in the `db update` CLI summary (the existing CLI command in `@prisma-next/cli`).
- Address PR #711 review hygiene items: drop the `isPlannerWarningList` runtime predicate in favour of a `blindCast` at the read site (the value is data the CLI itself wrote into `meta`); replace the bare `as unknown as` cast in the Mongo `defineContract` return with `blindCast` carrying a justification literal; rename the SQL family's `formatTargetRef` / `defaultTargetRef` (and the Postgres adapter's `formatPostgresControlPolicyTargetRef`) to use the existing `subject`/`Label` vocabulary so the names stop colliding with the codebase's "target" (= database target); replace the conditional-spread idiom in `buildSuppressionWarning`'s location/meta construction with the repo's `ifDefined` helper.
- Necessary builder-DSL touch-ups in `@prisma-next/sql-contract-ts` and the Mongo authoring surface if either fixture surfaces a real authoring gap (only what the e2e tests force; nothing speculative).
- TML-2792 closes alongside this slice (the wiring above is its delivery).

**Out:**

- The PSL authoring surface (slice 6 — TML-2779). The fixture authors via TS only.
- An example-app touchpoint. The supabase example is a design sketch (no `package.json` / no `pnpm test`); promoting it into a runnable example is supabase-integration-project work, not control-policy work. The integration test is the visible demonstration.
- New verifier or planner *behaviours* — only the warning-channel plumbing is new; verifier outcomes and DDL emission for the four policies were delivered in slices 2–4 and are merely **asserted** here.
- Per-column control-policy override (project spec non-goal).
- Mongo planner-dispatch scenarios. The control-policy project did not deliver a Mongo planner-dispatch slice (slice 3 was SQL-only); Mongo's "applicable" surface for end-to-end demonstration is the verifier dispatch that slice 2 (TML-2776) shipped — see the Mongo dispatch in the plan.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `external`-namespace seeding in PGlite must not race the migration | Fixture establishes seeded objects via raw `executeStatement` *before* `runDbInit`, mirroring the pattern in `cli.db-verify.e2e.test.ts`'s `createTestContract` flow. |
| `tolerated`-extra-column survival across `db update` reruns | The second `db update` must not drop the extra column (that is the policy's defining behaviour). The test asserts the column still exists in `information_schema.columns` after the second run. |
| `db verify` exit codes per policy | `managed` mismatch → non-zero; `observed` mismatch → zero (warn-only); `external` mismatch on declared column → non-zero; `external` extra column → zero. The test pins each via `getExitCode`. |
| Diagnostic surfacing on `--dry-run` vs. apply path | The warning must appear in both the dry-run summary and the apply summary (it is a property of the plan, not the apply). The test asserts both. |

Otherwise none pre-investigated — the implementer's dispatch-time grep on `cli.db-update.e2e.test.ts` and the planner-types module is the discovery mechanism.

## Slice-specific done conditions

- [ ] `pnpm --filter @prisma-next/integration-tests test test/integration/test/cli.control-policy.postgres.e2e.test.ts test/integration/test/cli.control-policy.mongo.e2e.test.ts` is green and pinned in CI under the existing `Integration Tests` gate.
- [ ] `pnpm fixtures:check` shows zero churn (the slice introduces no contract-fixture changes).
- [ ] TML-2792 is closed by this slice's PR (the warnings channel + CLI surfacing land here).
- [ ] `db update` succeeds when an `external` subject is in a state the SQL diff engine cannot model: the planner does not observe such subjects at all (input-side filtering), and the un-plannable-external scenario in the Postgres fixture pins this property.
- [ ] No bare `as unknown as` casts in Mongo `defineContract`'s return path; no runtime type predicate guarding data the CLI wrote into its own `meta` bag; no `formatTargetRef`/`defaultTargetRef` naming colliding with the codebase's "target" vocabulary; no inline ternary-spread idioms in `buildSuppressionWarning`'s location/meta construction.

## Open Questions

1. **Should the `controlPolicySuppressedCall` warning kind also fire for `tolerated` ALTERs the planner suppresses (not just the external-namespace floor)?** Working position: yes — every dropped call in `filterCallsByControlPolicy` becomes a warning; the kind plus `controlPolicy` field on the conflict tells the user *which* policy suppressed it. Asymmetry would be hard to explain in the CLI output.
2. **Should the warning be emitted only when calls were actually dropped, or always include an empty `warnings: []` for forward-compat?** Working position: omit the field entirely when empty (matches the omit-when-default idiom the project's contract-IR slice established) so existing callers and tests don't churn.
3. **Does the `db update --dry-run` exit code change when warnings are present?** Working position: no — warnings do not fail the command (they are warnings, not conflicts). The command exits zero; the warning text is in stdout. Operator can override if there's a real CLI-UX precedent for treating control-policy suppressions as exit-non-zero.

## References

- Parent project: [`projects/control-policy/spec.md`](../../spec.md)
- Linear issue: [TML-2796](https://linear.app/prisma-company/issue/TML-2796)
- Companion ticket closed by this slice: [TML-2792](https://linear.app/prisma-company/issue/TML-2792)
- Sibling specs: [`ir-primitive/spec.md`](../ir-primitive/spec.md) — substrate this slice asserts.
- Test infrastructure precedents: `test/integration/test/cli.db-update.e2e.test.ts`, `test/integration/test/cli.db-verify.e2e.test.ts`.
- Planner internals touched: `packages/2-sql/9-family/src/core/migrations/{types.ts,control-policy.ts}`; framework planner types in `packages/1-framework/1-core/framework-components/src/migrations/`.
- Project DoD conditions this slice closes: "All four policies behave end-to-end (verify + plan) for the SQL family (Postgres)"; "A contract with `defaultControl: 'external'` plus a `managed` object mis-declared in that namespace produces zero DDL into the namespace and surfaces the conflict diagnostic".
