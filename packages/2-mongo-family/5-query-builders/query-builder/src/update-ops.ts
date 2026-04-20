import type { MongoUpdatePipelineStage } from '@prisma-next/mongo-query-ast/execution';
import type { MongoValue } from '@prisma-next/mongo-value';

/**
 * Per-field update operations produced by `Expression`'s update methods
 * (`set`, `inc`, `push`, …). A write terminal folds an array of these into a
 * `MongoUpdateSpec` record (`{ $set: { … }, $inc: { … }, … }`) before
 * constructing the underlying `UpdateManyCommand` / `UpdateOneCommand` AST node.
 *
 * One `TypedUpdateOp` value corresponds to one Mongo update operator applied
 * to one field path. The `op` string is the wire-level operator name (`$set`,
 * `$inc`, …); the `path` is the dot-path to the field (or its top-level name).
 */
export type TypedUpdateOp =
  | { readonly op: '$set'; readonly path: string; readonly value: MongoValue }
  | { readonly op: '$unset'; readonly path: string }
  | { readonly op: '$rename'; readonly path: string; readonly newName: string }
  | { readonly op: '$inc'; readonly path: string; readonly amount: number }
  | { readonly op: '$mul'; readonly path: string; readonly factor: number }
  | { readonly op: '$min'; readonly path: string; readonly value: MongoValue }
  | { readonly op: '$max'; readonly path: string; readonly value: MongoValue }
  | { readonly op: '$push'; readonly path: string; readonly value: MongoValue }
  | { readonly op: '$addToSet'; readonly path: string; readonly value: MongoValue }
  | { readonly op: '$pop'; readonly path: string; readonly direction: 1 | -1 }
  | { readonly op: '$pull'; readonly path: string; readonly value: MongoValue }
  | { readonly op: '$pullAll'; readonly path: string; readonly values: ReadonlyArray<MongoValue> }
  | { readonly op: '$currentDate'; readonly path: string }
  | { readonly op: '$setOnInsert'; readonly path: string; readonly value: MongoValue };

export const setOp = (path: string, value: MongoValue): TypedUpdateOp => ({
  op: '$set',
  path,
  value,
});
export const unsetOp = (path: string): TypedUpdateOp => ({ op: '$unset', path });
export const renameOp = (path: string, newName: string): TypedUpdateOp => ({
  op: '$rename',
  path,
  newName,
});
export const incOp = (path: string, amount: number): TypedUpdateOp => ({
  op: '$inc',
  path,
  amount,
});
export const mulOp = (path: string, factor: number): TypedUpdateOp => ({
  op: '$mul',
  path,
  factor,
});
export const minOp = (path: string, value: MongoValue): TypedUpdateOp => ({
  op: '$min',
  path,
  value,
});
export const maxOp = (path: string, value: MongoValue): TypedUpdateOp => ({
  op: '$max',
  path,
  value,
});
export const pushOp = (path: string, value: MongoValue): TypedUpdateOp => ({
  op: '$push',
  path,
  value,
});
export const addToSetOp = (path: string, value: MongoValue): TypedUpdateOp => ({
  op: '$addToSet',
  path,
  value,
});
export const popOp = (path: string, direction: 1 | -1): TypedUpdateOp => ({
  op: '$pop',
  path,
  direction,
});
export const pullOp = (path: string, value: MongoValue): TypedUpdateOp => ({
  op: '$pull',
  path,
  value,
});
export const pullAllOp = (path: string, values: ReadonlyArray<MongoValue>): TypedUpdateOp => ({
  op: '$pullAll',
  path,
  values,
});
export const currentDateOp = (path: string): TypedUpdateOp => ({ op: '$currentDate', path });
export const setOnInsertOp = (path: string, value: MongoValue): TypedUpdateOp => ({
  op: '$setOnInsert',
  path,
  value,
});

/**
 * Fold an array of `TypedUpdateOp` into the `Record<string, MongoValue>`
 * shape that `MongoUpdateSpec` accepts as the non-pipeline form.
 *
 * Result: `{ $set: { 'foo': 1, 'bar.baz': 2 }, $inc: { 'count': 1 }, … }`.
 *
 * Throws if the same operator targets the same path twice — a clear authoring
 * error that Mongo would otherwise silently coalesce.
 */
export function foldUpdateOps(ops: ReadonlyArray<TypedUpdateOp>): Record<string, MongoValue> {
  const buckets: Record<string, Record<string, MongoValue>> = {};
  const seen = new Set<string>();

  const ensure = (key: string): Record<string, MongoValue> => {
    let bucket = buckets[key];
    if (!bucket) {
      bucket = {};
      buckets[key] = bucket;
    }
    return bucket;
  };

  const claim = (op: string, path: string): void => {
    const k = `${op}::${path}`;
    if (seen.has(k)) {
      throw new Error(
        `Update spec collision: ${op} on '${path}' was specified more than once. Combine the operations into a single call site.`,
      );
    }
    seen.add(k);
  };

  for (const entry of ops) {
    claim(entry.op, entry.path);
    switch (entry.op) {
      case '$set':
      case '$min':
      case '$max':
      case '$push':
      case '$addToSet':
      case '$pull':
      case '$setOnInsert':
        ensure(entry.op)[entry.path] = entry.value;
        break;
      case '$unset':
        ensure('$unset')[entry.path] = '' as unknown as MongoValue;
        break;
      case '$rename':
        ensure('$rename')[entry.path] = entry.newName as unknown as MongoValue;
        break;
      case '$inc':
        ensure('$inc')[entry.path] = entry.amount;
        break;
      case '$mul':
        ensure('$mul')[entry.path] = entry.factor;
        break;
      case '$pop':
        ensure('$pop')[entry.path] = entry.direction;
        break;
      case '$pullAll':
        ensure('$pullAll')[entry.path] = entry.values as unknown as MongoValue;
        break;
      case '$currentDate':
        ensure('$currentDate')[entry.path] = true as unknown as MongoValue;
        break;
    }
  }

  return buckets as unknown as Record<string, MongoValue>;
}

export type UpdaterItem = TypedUpdateOp | MongoUpdatePipelineStage;

/**
 * The return type for updater callbacks. Typed as a union of homogeneous
 * arrays so mixed-shape updaters (operator + pipeline stage in the same
 * array) are a compile error. The runtime guard in `resolveUpdaterResult`
 * remains as defence-in-depth.
 */
export type UpdaterResult = ReadonlyArray<TypedUpdateOp> | ReadonlyArray<MongoUpdatePipelineStage>;

/**
 * Classify an array of updater items and produce a `MongoUpdateSpec`.
 *
 * - All `TypedUpdateOp` → fold via `foldUpdateOps` (classic `{ $set, $inc, … }`)
 * - All `MongoUpdatePipelineStage` → return as-is (pipeline-style update)
 * - Mixed → throw (also a type error at the call site via the union shape)
 */
export function resolveUpdaterResult(
  items: ReadonlyArray<UpdaterItem>,
): Record<string, MongoValue> | ReadonlyArray<MongoUpdatePipelineStage> {
  if (items.length === 0) {
    throw new Error(
      'Updater returned no operations. Return at least one update from the callback (e.g. `[f.amount.set(0)]`).',
    );
  }

  const isOp = (item: UpdaterItem): item is TypedUpdateOp =>
    'op' in item && typeof (item as TypedUpdateOp).op === 'string';

  const first = items[0];
  if (first === undefined) {
    throw new Error('Unreachable: items.length > 0 but first is undefined');
  }
  const firstIsOp = isOp(first);

  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;
    if (isOp(item) !== firstIsOp) {
      throw new Error(
        'Cannot mix TypedUpdateOp values and pipeline stages in a single updater. ' +
          'Use either `[f.amount.set(0)]` (operator form) or `[f.stage.set({...})]` (pipeline form), not both.',
      );
    }
  }

  if (firstIsOp) {
    return foldUpdateOps(items as ReadonlyArray<TypedUpdateOp>);
  }
  return items as ReadonlyArray<MongoUpdatePipelineStage>;
}
