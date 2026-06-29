import { Migration } from '@prisma-next/migration-tools/migration';
import type { MongoContract } from '@prisma-next/mongo-contract';
import type { AnyMongoMigrationOperation } from '@prisma-next/mongo-query-ast/control';
import { MongoContractView } from './ir/mongo-contract-view';

/**
 * Family-owned base class for Mongo migrations.
 *
 * Provides the fixed `targetId = 'mongo'` so that user-authored migrations
 * and renderer-generated scaffolds (e.g. the output of
 * `renderCallsToTypeScript`) inherit it directly and don't have to re-declare
 * the abstract `targetId` member from `Migration`.
 *
 * The operation type parameter is `AnyMongoMigrationOperation` — the union
 * of DDL-shaped `MongoMigrationPlanOperation` and `MongoDataTransformOperation` —
 * so subclasses can return a mix of schema operations (e.g. `createIndex`,
 * `setValidation`) and data-transform operations (e.g. `dataTransform`).
 * Mirrors the generic parameter used by `PlannerProducedMongoMigration`.
 *
 * Binds the framework base's `Start` / `End` contract generics so a subclass
 * that assigns its `start-contract.json` / `end-contract.json` imports gets
 * fully-typed view accessors: `this.endContract` is a `MongoContractView<End>`
 * (and `this.startContract` a `MongoContractView<Start> | null`), built lazily
 * from those JSON fields. The framework base derives `describe()` from the same
 * JSON. View getters live on the family base (not the framework base) because
 * `MongoContractView`'s shape is Mongo-specific.
 */
export abstract class MongoMigration<
  Start extends MongoContract = MongoContract,
  End extends MongoContract = MongoContract,
> extends Migration<AnyMongoMigrationOperation, string, string, Start, End> {
  readonly targetId = 'mongo' as const;

  #endContract?: MongoContractView<End>;
  #startContract?: MongoContractView<Start> | null;

  /**
   * The typed, namespace-unwrapped view over this migration's end-state
   * contract — `this.endContract.collection.<name>.validator`, etc. Lazily
   * built from `endContractJson` and memoized. Throws if no `endContractJson`
   * was provided (a `describe()`-overriding migration with no contract has no
   * view to expose).
   */
  get endContract(): MongoContractView<End> {
    if (this.#endContract === undefined) {
      if (this.endContractJson === undefined) {
        throw new Error(
          'MongoMigration.endContract: no endContractJson provided — set endContractJson to read the end-state contract view.',
        );
      }
      this.#endContract = MongoContractView.fromJson<End>(this.endContractJson);
    }
    return this.#endContract;
  }

  /**
   * The typed view over this migration's start-state contract, or `null` for a
   * baseline migration (no `startContractJson`). Lazily built and memoized.
   */
  get startContract(): MongoContractView<Start> | null {
    if (this.#startContract === undefined) {
      this.#startContract =
        this.startContractJson === undefined
          ? null
          : MongoContractView.fromJson<Start>(this.startContractJson);
    }
    return this.#startContract;
  }
}
