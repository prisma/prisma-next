#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import {
  AggregateCommand,
  MongoExistsExpr,
  MongoLimitStage,
  MongoMatchStage,
  type MongoQueryPlan,
  RawUpdateManyCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { dataTransform, setValidation } from '@prisma-next/target-mongo/migration';
import type { Contract as End } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };
import type { Contract as Start } from './start-contract';
import startContractJson from './start-contract.json' with { type: 'json' };

function existingProductsWithoutStatus(storageHash: string): MongoQueryPlan {
  return {
    collection: 'products',
    command: new AggregateCommand('products', [
      new MongoMatchStage(new MongoExistsExpr('status', false)),
      new MongoLimitStage(1),
    ]),
    meta: { target: 'mongo', storageHash, lane: 'mongo-pipeline' },
  };
}

function backfillRun(storageHash: string): MongoQueryPlan {
  return {
    collection: 'products',
    // Raw command form: the typed query-builder (`mongoQuery(...).updateMany(...)`)
    // produces the same logical plan but its JSON form is not yet handled by
    // the runner's ops deserializer (TML-2506), so hand-authored data
    // transforms use the raw command shape — matching the framework's
    // data-transform test fixtures.
    command: new RawUpdateManyCommand(
      'products',
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    ),
    meta: { target: 'mongo', storageHash, lane: 'mongo-raw' },
  };
}

class BackfillProductStatus extends Migration<Start, End> {
  override readonly startContractJson = startContractJson;
  override readonly endContractJson = endContractJson;

  // `migration new` records the contract delta as `from` → `to` but produces an
  // empty `operations` array; the author is responsible for declaring the work
  // that bridges the two contract states. This migration's contract delta adds
  // `embedding` and `status` fields to `products` (with `status` becoming
  // required via its `@default("active")`), so two ops are needed:
  //
  // 1. `setValidation` — refresh the live `$jsonSchema` so it includes the new
  //    fields. Without this, `db verify` would fail with `VALIDATOR_MISMATCH`
  //    after this migration applies because the live validator (still the
  //    state-1 shape from migration 1's `createCollection`) wouldn't match the
  //    contract-derived expected validator for state 3.
  //
  // 2. `dataTransform` — backfill `status: "active"` on pre-existing products
  //    so they satisfy the new `required: [..., "status", ...]` rule.
  //
  // The validator is sourced from the end-state contract view so the op stays
  // in sync with the contract if the chain is ever re-emitted.
  override get operations() {
    const storageHash = this.endContract.storage.storageHash;
    const productsValidator = this.endContract.collection.products.validator;
    return [
      setValidation('products', productsValidator.jsonSchema, {
        validationLevel: productsValidator.validationLevel,
        validationAction: productsValidator.validationAction,
      }),
      dataTransform('backfill-product-status', {
        check: { source: () => existingProductsWithoutStatus(storageHash) },
        run: () => backfillRun(storageHash),
      }),
    ];
  }
}

export default BackfillProductStatus;
MigrationCLI.run(import.meta.url, BackfillProductStatus);
