# Faithfulness audit — every ported test (as of wave G–K)

Read-only audit of all 33 ported test files (~158 tests) against upstream source, under the hardened `spec.md` § "No workarounds" + "Type-level assertions are ported, not dropped". Per-batch detail with line citations in `batch-{1..5}.md`. Findings spot-verified against source (onDelete:Cascade drop, 5-vs-6 test count) — confirmed real.

## Verdict: the corpus is mostly faithful on runtime behaviour, but has systematic faithfulness debt in two areas — **dropped type-level assertions** and the **naming-conflict matrices** — plus a cluster of **extended-where** deviations and one accounting break.

## Violations to fix

### A. Dropped type-level assertions → port as sibling `.test-d.ts` (spec now requires this)
| Suite | Dropped assertion (upstream) | Fix |
| --- | --- | --- |
| default-selection › does not include relations | `expectTypeOf(model).not.toHaveProperty('relation')` | add `default-selection.test-d.ts` |
| enum-array › can retrieve enum array | `expectTypeOf(data.plans).toEqualTypeOf<Plan[]>()` | add `.test-d.ts` |
| methods-findFirstOrThrow › finds existing | `expectTypeOf(record).not.toBeNullable()` | add `.test-d.ts` |
| methods-findUniqueOrThrow › finds existing | `expectTypeOf(record).not.toBeNullable()` | add `.test-d.ts` |
| legacy-aggregations › invalid min/max/sum/count/avg (×5) | `@ts-expect-error` on invalid agg field | port as negative type tests in `.test-d.ts` (currently non-ported — WRONG-DISPOSITION) |
| composites-object-create › set null required (×2) | `@ts-expect-error` on null into required composite | port as `@ts-expect-error` (currently non-ported) |
| naming-conflict-builtin-vs-enum | `expectTypeOf(value).toEqualTypeOf<'ONE'\|'TWO'>()` | add `.test-d.ts` |
| naming-conflict-builtin-vs-model (×16) | `.not.toBeAny()` + `.toMatchTypeOf<{id;isUserProvidedType}>()` | add `.test-d.ts` |
| naming-conflict-model-vs-model | `.not.toBeAny()` + `.toMatchTypeOf<{name;id}>()` (was replaced by runtime `typeof`) | add `.test-d.ts`, drop the `typeof` stand-ins |

### B. Under-ported matrices with no ledger accounting (naming-conflict)
Upstream parametrizes over the full built-in name list; the ports cover a handful and the remainder is neither ported nor in `non-ported.md`:
- built-in-types-vs-enum: **4 / 67** name-cases
- built-in-types-vs-model: **8 / 134** (67 names × 2 tests)
- model-vs-model: **1 / 12**
Fix: either port every case, or add an individual `non-ported.md` line per dropped case with a real reason. (Fixtures/headers also mis-cite "63 names"; actual `_builtInNames.ts` = 67.)

### C. extended-where passing-port deviations (5)
- 2 filtered nested-1:1-`include` tests replaced by standalone queries → **FEATURE-SUBSTITUTION** → non-ported or `test.fails`.
- empty `data:{}` update swapped for a non-empty update → **INPUT-SUBSTITUTION** → `test.fails`.
- `create … connect` with 2 uniques dropped its second key → **WEAKENED** to the 1-key case.
- fixture dropped `onDelete: Cascade` (prisma-next supports it) → **SCHEMA-SIMPLIFICATION**, which forced a manual child-delete workaround in the PK-delete test.

### D. Accounting break
- legacy-optional-relation-filters: 6 upstream tests, **5** ported; the 6th (`filter empty optional relation`, a `bio:null` duplicate) is checked `[x]` in the checklist pointing at the port file, but no `it()` exists. Either port the 6th or fix the checklist/ledger.

### E. Stale/cosmetic (low severity)
- multiple-types: header comment says a test is non-ported "uses queryRaw", but it IS ported (only the comment is stale); minor per-row null-column assertion narrowing.
- composites-object-create: one optional `set null shorthand` asserts `null || undefined` vs upstream strict `null` (mild weakening).

## Clean (no fixes)
- All 6 issue ports (issues-4004, 11974, 12378, 12557, 12572, 16535) — faithful, incl. the `it.fails` gaps and the `updateMany`→`updateAll(isNotNull)` tautology.
- distinct, methods-count, methods-createMany, methods-upsert-simple, methods-upsert-native-atomic, multiple-types (test itself), string-filters (`.ilike`), legacy-json, optimistic-concurrency-control, mixed-string, blog-update, decimal-* (post-fix), create-default-date, bytes-upsert (`it.fails`), extended-where cursor `it.fails`.

## Rough fix effort
~9 `.test-d.ts` files (A), naming-conflict matrix decision + accounting (B, largest), 5 extended-where fixes incl. a fixture re-emit (C), 1 accounting fix (D), 2 cosmetic (E).
