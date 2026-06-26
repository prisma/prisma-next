#!/usr/bin/env -S node
import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { MongoContractSerializer, MongoContractView } from '@prisma-next/family-mongo/ir';
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
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

const endContract = new MongoContractSerializer().deserializeContract<Contract>(endContractJson);

const STORAGE_HASH = endContract.storage.storageHash;

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
// The validator is sourced from `end-contract.json` so the op stays in sync
// with the contract if the chain is ever re-emitted.
const PRODUCTS_VALIDATOR = MongoContractView.from(endContract).collection.products.validator;

function existingProductsWithoutStatus(): MongoQueryPlan {
  return {
    collection: 'products',
    command: new AggregateCommand('products', [
      new MongoMatchStage(new MongoExistsExpr('status', false)),
      new MongoLimitStage(1),
    ]),
    meta: { target: 'mongo', storageHash: STORAGE_HASH, lane: 'mongo-pipeline' },
  };
}

function backfillRun(): MongoQueryPlan {
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
    meta: { target: 'mongo', storageHash: STORAGE_HASH, lane: 'mongo-raw' },
  };
}

class BackfillProductStatus extends Migration {
  override describe() {
    return {
      from: 'sha256:059f3f35403c5a7a90851c23f1028e16d5250630f8a82fba33053e9a50534589',
      to: 'sha256:71f1cc5c3f4de1ea7c9c8426fde682cd78c7c005f6688f58c2d9d6ddd8b2284c',
      labels: ['backfill-product-status'],
    };
  }

  override get operations() {
    return [
      setValidation('products', PRODUCTS_VALIDATOR.jsonSchema, {
        validationLevel: PRODUCTS_VALIDATOR.validationLevel,
        validationAction: PRODUCTS_VALIDATOR.validationAction,
      }),
      dataTransform('backfill-product-status', {
        check: { source: existingProductsWithoutStatus },
        run: backfillRun,
      }),
    ];
  }
}

export default BackfillProductStatus;
MigrationCLI.run(import.meta.url, BackfillProductStatus);
