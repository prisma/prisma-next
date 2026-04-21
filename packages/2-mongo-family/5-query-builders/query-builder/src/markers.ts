/**
 * Phantom capability markers for `PipelineChain`.
 *
 * `UpdateEnabled`          — gates `.updateMany()` / `.updateOne()` no-arg form
 *                            (consume accumulated pipeline as an update-with-pipeline spec).
 * `FindAndModifyEnabled`   — gates `.findOneAndUpdate(...)` / `.findOneAndDelete(...)`
 *                            (deconstruct pipeline into the wire command's filter/sort/skip slots).
 *
 * Each pipeline-stage method either preserves or clears these markers per
 * the marker table (and rationale per row) in
 * `docs/architecture docs/adrs/ADR 201 - State-machine pattern for typed DSL builders.md`.
 *
 * The markers exist only at the type level; nothing reads them at runtime.
 * Value literals are self-identifying so the two slots are distinguishable in
 * hover tooltips and error messages (e.g. `'update-ok'` vs `'fam-ok'`).
 */
export type UpdateEnabled = 'update-ok' | 'update-cleared';
export type FindAndModifyEnabled = 'fam-ok' | 'fam-cleared';
