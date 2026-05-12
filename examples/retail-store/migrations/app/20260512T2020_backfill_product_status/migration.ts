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
import { dataTransform } from '@prisma-next/target-mongo/migration';
import endContractJson from './end-contract.json' with { type: 'json' };

// The end-contract's storage hash is the destination this migration writes
// to; we tag every plan's meta with it so the runner can chain marker writes.
const STORAGE_HASH = endContractJson.storage.storageHash;

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
    // the runner's ops deserializer, so hand-authored data transforms use the
    // raw command shape — matching the framework's data-transform test
    // fixtures.
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
      from: 'sha256:8a15f8e37a3a8731578a87102f9507da65b5f84556f84320ea0ead82645e394d',
      to: 'sha256:50134e16bc78b848f51f2dc00025eb3b4bbcbee55f402f7d9b71608a1b2d0c65',
      labels: ['backfill-product-status'],
    };
  }

  override get operations() {
    return [
      dataTransform('backfill-product-status', {
        check: { source: existingProductsWithoutStatus },
        run: backfillRun,
      }),
    ];
  }
}

export default BackfillProductStatus;
MigrationCLI.run(import.meta.url, BackfillProductStatus);
