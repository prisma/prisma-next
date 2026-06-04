# Project learnings — migrate-marker-ledger-to-typed-query-ast-commands

Working ledger for patterns surfaced during this run. Reviewed at close-out; cross-cutting lessons migrate to durable docs.

## Subagent model policy (operator, 2026-05-31)

| Role | Model | Rationale |
|---|---|---|
| **Implementer** | `composer-2.5-fast` | Speed; acceptable when the brief is tight and the reviewer catches drift. |
| **Reviewer** | `claude-opus-4-8-thinking-high` | Judgment; compensates for implementer shortcut risk. |

**Variant switch = fresh spawn.** Composer cannot resume a Sonnet/Opus transcript; record the swap in `subagent-registry.md`.

D1 started on `claude-4.6-sonnet-high-thinking` before this policy landed. Let it finish; Opus reviews D1. Any D1 rework and all of D2–D4 use Composer under the constraints below.

## Composer implementer constraints (load-bearing)

Composer is fast but prone to bad autonomous decisions. Every Composer dispatch brief MUST include this block verbatim (adapt file lists per dispatch):

```markdown
### Composer constraints (mandatory — no creative freedom)

- **Pattern clone, not design.** Before writing a node/class/module, open the reference named in the brief (e.g. `InsertAst` in `types.ts`) and mirror its structure: constructor shape, `freeze` call, `rewrite`/`collectParamRefs`/`toQueryAst`, static factory, export site. Do not invent a parallel pattern.
- **Closed file list.** Touch ONLY paths listed under Scope → In. A file not listed is out of bounds even if "obviously related."
- **No drive-by refactors.** Do not rename, reformat, or "clean up" adjacent code. Do not add comments unless the reference file has them at the same site.
- **No new abstractions.** No helpers, base classes, or shared utilities beyond what the brief names. If you feel one is needed, HALT — do not implement it.
- **No scope expansion.** No DML builder methods, no adapter lowering, no routing, no deleting bootstrap constants unless this dispatch's brief explicitly says so.
- **No API surface beyond the brief.** Export only what the brief lists. Do not add convenience re-exports or barrel files outside the named module.
- **Decisions are closed.** Open questions marked RESOLVED in the slice spec are not yours to reopen. If the brief and the reference file disagree, HALT with file:line citations — do not pick an interpretation.
- **Tests pin behaviour, not architecture.** Write tests from the brief's completed-when checklist only. Do not add speculative edge-case suites.
- **Validation gate is the definition of done.** Run only the commands in the brief. Do not substitute "equivalent" checks.
```

Escalate to Opus implementer (`claude-opus-4-8-thinking-high`, fresh spawn) only when: (a) the brief requires genuine design judgment with no reference pattern, or (b) two Composer rounds on the same dispatch still fail Opus review on the same must-fix theme.

## Adding a kind to a discriminated union has a workspace-wide blast radius (and per-package gates + turbo cache hide it)

Surfaced at D4b: adding `create-schema`/`create-table` to `AnyQueryAst` (D1) broke two **exhaustive** `AnyQueryAst` consumers in a *different* package (`sql-runtime`): `codecs/decoding.ts` (`projectionListFromAst` fell through to `ast.returning`, which DDL nodes lack → TS2339) and `middleware/lints.ts` (a `default: throw … (ast satisfies never)` → TS1360 **and a latent runtime throw on DDL**, contradicting the operator's "DDL is first-class, no throw" decision). 

Why it stayed hidden through D1→D4a: each dispatch's gate ran **per-package** typecheck (`pnpm --filter <pkg> typecheck`), and the **workspace** `pnpm typecheck` was turbo-cached/stale — the cross-package break only surfaced when D4b edited `sql-runtime` and invalidated the cache. D1's AC-6 ("no runtime throw on DDL") was also verified **in-package only**, so the out-of-package throw site was never checked.

**Lessons for next time:**
1. **When a dispatch widens a core discriminated union, its gate MUST include a fresh (non-cached) workspace `pnpm typecheck`** — not just the owning package's. Consider `turbo … --force` or clearing the cache for that gate.
2. **"No runtime throw on kind X" must be verified workspace-wide**, by grepping every exhaustive switch / `satisfies never` over the union, not just in the package that defines it.
3. Treat the union-member addition and the sweep of all its exhaustive consumers as **one logical unit** when decomposing — or explicitly schedule the consumer sweep as its own gated step. Here it became an unplanned follow-up dispatch (D4c).

## Mongo slice (TML-2825) ran clean in 2 dispatches — the up-front discussion + grounding paid off

The Mongo marker/ledger slice (parallel group A) shipped SATISFIED in **one round per dispatch, zero findings** — a sharp contrast to the SQL sibling's three corrective rounds (F16–F21). What made the difference, for next time:

1. **The F21 risk (contract-free surface) was de-risked before any code.** The design discussion settled that Mongo's `createFieldAccessor` is *already* contract-free, so the surface **reuses** it (vs SQL, which was forced to build its own because its field machinery is contract-bound). The D1 brief asserted the *property* ("a surface that earns its keep by reusing the accessor and producing canonical nodes") — F17/F21 framing — and the reviewer's first job was the F21 litmus. No option-bag wrappers shipped.
2. **Plan-time verification killed the phantom risks.** What looked load-bearing (a "wire-dispatch seam") turned out to be composing two existing pieces (`createMongoAdapter().lower()` + `MongoDriverImpl.fromDb(db).execute()`); `CodecCallContext` was `{}`; `$type`/`$expr`/`$setUnion` all rode generic AST nodes (zero new nodes, zero lowerer changes). Verifying these *before* writing the plan meant neither dispatch hit a surprise.
3. **`extractDb`-elimination judgment.** "Deleted, not wrapped" was satisfied by removing `extractDb` from all six methods and centralizing the (intrinsic) `Db` resolution once inside the dispatch helper — *not* by exposing wire `execute` on the control driver (a larger SPI change). The reviewer confirmed this is genuine elimination, not a rename. The cleaner control-driver-`execute` shape remains a possible future refactor.
4. **Harness note:** this environment exposes no subagent-resume, so D2 spawned a fresh implementer + reviewer with self-contained briefs (continuity via on-disk spec/plan + D1's committed surface). Worked fine for a 2-dispatch slice; would cost more context re-derivation on a longer one.

**Follow-up surfaced at review (non-blocking, optional hygiene):** the new `controlDriverDb` error string cites `createMongoControlDriver() from @prisma-next/adapter-mongo/control` while the older `extractDb` string cites `mongoControlDriver.create() from @prisma-next/driver-mongo/control` — both accurate; harmonize if the team cares.
