import { Migration } from '@prisma-next/family-mongo/migration';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoPipeline } from '@prisma-next/mongo-pipeline-builder';
import { MongoExistsExpr, RawUpdateManyCommand } from '@prisma-next/mongo-query-ast/execution';
import { dataTransform } from '@prisma-next/target-mongo/migration';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

const { contract } = validateMongoContract<Contract>(contractJson);
const pipeline = mongoPipeline<Contract>({ contractJson });

class BackfillProductStatus extends Migration {
  override describe() {
    return {
      from: 'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
      to: 'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
      labels: ['backfill-product-status'],
    };
  }

  override get operations() {
    const meta = {
      target: 'mongo' as const,
      storageHash: contract.storage.storageHash,
      lane: 'mongo-raw',
      paramDescriptors: [] as const,
    };

    return [
      dataTransform('backfill-product-status', {
        check: {
          source: () =>
            pipeline.from('products').match(MongoExistsExpr.notExists('status')).limit(1),
        },
        run: () => ({
          collection: 'products',
          command: new RawUpdateManyCommand(
            'products',
            { status: { $exists: false } },
            { $set: { status: 'active' } },
          ),
          meta,
        }),
      }),
    ];
  }
}

export default BackfillProductStatus;
Migration.run(import.meta.url, BackfillProductStatus);
