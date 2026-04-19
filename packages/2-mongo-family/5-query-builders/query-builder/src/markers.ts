/**
 * Phantom capability markers for `PipelineChain`.
 *
 * `UpdateCompat`         — gates `.updateMany()` / `.updateOne()` no-arg form
 *                          (consume accumulated pipeline as an update-with-pipeline spec).
 * `FindAndModifyCompat`  — gates `.findOneAndUpdate(...)` / `.findOneAndDelete(...)`
 *                          (deconstruct pipeline into the wire command's filter/sort/skip slots).
 *
 * Each pipeline-stage method either preserves or clears these markers per the
 * marker table in the spec (see `query-builder-unification.spec.md`).
 *
 * The markers exist only at the type level; nothing reads them at runtime.
 */
export type UpdateCompat = 'compat' | 'cleared';
export type FindAndModifyCompat = 'compat' | 'cleared';
