import {
  AggregateCommand,
  FindOneAndUpdateCommand,
  InsertOneCommand,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
  MongoAndExpr,
  type MongoFilterExpr,
  MongoLimitStage,
  MongoMatchStage,
  MongoSortStage,
  type MongoUpdatePipelineStage,
} from '@prisma-next/mongo-query-ast/execution';
import {
  createFieldAccessor,
  expr,
  type FieldAccessor,
  fn,
  type TypedAggExpr,
} from '@prisma-next/mongo-query-builder';
import type { MongoValue } from '@prisma-next/mongo-value';

/**
 * Document shape of the `_prisma_migrations` control collection, declared
 * once so the contract-free field accessor is typed without threading a
 * contract, codecs, or paths at the call sites below. Both the marker
 * documents (`space` / `storageHash` / … / `invariants`) and the ledger
 * documents (`type` / `edgeId` / … / `appliedAt`) live in this one
 * collection, so the shape is their union.
 */
export type ControlDocShape = {
  readonly _id: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  // Marker fields
  readonly space: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly storageHash: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly profileHash: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly contractJson: { readonly codecId: 'mongo/string@1'; readonly nullable: true };
  readonly canonicalVersion: { readonly codecId: 'mongo/double@1'; readonly nullable: true };
  readonly updatedAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
  readonly appTag: { readonly codecId: 'mongo/string@1'; readonly nullable: true };
  readonly meta: { readonly codecId: 'mongo/document@1'; readonly nullable: true };
  readonly invariants: { readonly codecId: 'mongo/array@1'; readonly nullable: false };
  // Ledger fields
  readonly type: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly edgeId: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly from: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly to: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly migrationName: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly migrationHash: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly operations: { readonly codecId: 'mongo/array@1'; readonly nullable: false };
  readonly appliedAt: { readonly codecId: 'mongo/date@1'; readonly nullable: false };
};

export const CONTROL_COLLECTION = '_prisma_migrations';

function controlFields(): FieldAccessor<ControlDocShape> {
  return createFieldAccessor<ControlDocShape>();
}

/**
 * Marker payload accepted by {@link insertMarkerCommand}. The native
 * values (string / `Date` / `string[]`) round-trip through the adapter's
 * wire-type codec registry at lowering time.
 */
export interface MarkerInsertFields {
  readonly space: string;
  readonly storageHash: string;
  readonly profileHash: string;
  readonly invariants: readonly string[];
}

export interface LedgerInsertFields {
  readonly space: string;
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly migrationName: string;
  readonly migrationHash: string;
  readonly operations: ReadonlyArray<MongoValue>;
}

export interface MarkerAdvanceFields {
  readonly storageHash: string;
  readonly profileHash: string;
  readonly updatedAt: Date;
  readonly invariants?: readonly string[];
}

/**
 * `readMarker`: the single-document marker read — `$match` on the
 * space-keyed marker followed by `$limit: 1`.
 */
export function readMarkerCommand(space: string): AggregateCommand {
  const f = controlFields();
  const match = new MongoMatchStage(MongoAndExpr.of([f._id.eq(space), f.space.eq(space)]));
  return new AggregateCommand(CONTROL_COLLECTION, [match, new MongoLimitStage(1)]);
}

/**
 * `readAllMarkers`: select documents whose `_id` is a string equal to
 * their own `space` field — `{ _id: { $type: 'string' }, $expr: { $eq:
 * ['$_id', '$space'] } }` — expressed via the additive `.type()` /
 * `expr()` surface, with zero new AST node kinds.
 */
export function readAllMarkersCommand(): AggregateCommand {
  const f = controlFields();
  const idRef: TypedAggExpr<ControlDocShape['_id']> = f._id;
  const spaceRef: TypedAggExpr<ControlDocShape['space']> = f.space;
  const match = new MongoMatchStage(
    MongoAndExpr.of([f._id.type('string'), f.space.type('string'), expr(fn.eq(idRef, spaceRef))]),
  );
  return new AggregateCommand(CONTROL_COLLECTION, [match]);
}

/**
 * `readLedger`: ledger documents (optionally scoped to one space),
 * ordered by `_id`.
 */
export function readLedgerCommand(space?: string): AggregateCommand {
  const f = controlFields();
  const typeFilter = f.type.eq('ledger');
  const filter: MongoFilterExpr =
    space === undefined ? typeFilter : MongoAndExpr.of([typeFilter, f.space.eq(space)]);
  const match = new MongoMatchStage(filter);
  return new AggregateCommand(CONTROL_COLLECTION, [match, new MongoSortStage({ _id: 1 })]);
}

/**
 * `initMarker`: insert a fresh marker document for `space`. `insertOne`
 * fails loud on a duplicate `_id`, preserving the existing init-once
 * semantics.
 */
export function insertMarkerCommand(fields: MarkerInsertFields): InsertOneCommand {
  const document: Record<string, MongoValue> = {
    _id: fields.space,
    space: fields.space,
    storageHash: fields.storageHash,
    profileHash: fields.profileHash,
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(),
    appTag: null,
    meta: {},
    invariants: [...fields.invariants],
  };
  return new InsertOneCommand(CONTROL_COLLECTION, document);
}

/**
 * `writeLedgerEntry`: append a ledger document to the control collection.
 */
export function insertLedgerCommand(fields: LedgerInsertFields): InsertOneCommand {
  const document: Record<string, MongoValue> = {
    type: 'ledger',
    space: fields.space,
    edgeId: fields.edgeId,
    from: fields.from,
    to: fields.to,
    migrationName: fields.migrationName,
    migrationHash: fields.migrationHash,
    operations: [...fields.operations],
    appliedAt: new Date(),
  };
  return new InsertOneCommand(CONTROL_COLLECTION, document);
}

/**
 * Server-side invariant-merge aggregation expression matching the current
 * semantics: `$sortArray({ input: $setUnion([$ifNull('$invariants', []),
 * incoming]), sortBy: 1 })`. Built through the typed agg-expr layer —
 * `fn.setUnion` plus the generic `MongoAggOperator` for `$ifNull` /
 * `$sortArray` (neither has a named `fn` helper).
 */
export function invariantMergeExpr(incoming: readonly string[]): MongoAggOperator {
  const existingOrEmpty = MongoAggOperator.of('$ifNull', [
    MongoAggFieldRef.of('invariants'),
    MongoAggLiteral.of([]),
  ]);
  const merged = fn.setUnion(
    { _field: { codecId: 'mongo/array@1', nullable: false }, node: existingOrEmpty },
    {
      _field: { codecId: 'mongo/array@1', nullable: false },
      node: MongoAggLiteral.of([...incoming]),
    },
  );
  return MongoAggOperator.of('$sortArray', { input: merged.node, sortBy: MongoAggLiteral.of(1) });
}

/**
 * `updateMarker`: the compare-and-swap advance. Matches the marker at
 * `expectedFrom` and advances it. When `invariants` is supplied, the
 * update is a pipeline so the merge runs server-side; otherwise it is a
 * plain `$set` of the scalar fields.
 */
export function advanceMarkerCommand(
  space: string,
  expectedFrom: string,
  destination: MarkerAdvanceFields,
): FindOneAndUpdateCommand {
  const f = controlFields();
  const filter = MongoAndExpr.of([
    f._id.eq(space),
    f.space.eq(space),
    f.storageHash.eq(expectedFrom),
  ]);

  const update: ReadonlyArray<MongoUpdatePipelineStage> = [
    f.stage.set(
      destination.invariants === undefined
        ? {
            storageHash: MongoAggLiteral.of(destination.storageHash),
            profileHash: MongoAggLiteral.of(destination.profileHash),
            updatedAt: MongoAggLiteral.of(destination.updatedAt),
          }
        : {
            storageHash: MongoAggLiteral.of(destination.storageHash),
            profileHash: MongoAggLiteral.of(destination.profileHash),
            updatedAt: MongoAggLiteral.of(destination.updatedAt),
            invariants: invariantMergeExpr(destination.invariants),
          },
    ),
  ];

  return new FindOneAndUpdateCommand(CONTROL_COLLECTION, filter, update, false);
}
