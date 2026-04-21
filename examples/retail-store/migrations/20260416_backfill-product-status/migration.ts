import { Migration } from '@prisma-next/family-mongo/migration';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import { dataTransform } from '@prisma-next/target-mongo/migration';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

const query = mongoQuery<Contract>({ contractJson });

class BackfillProductStatus extends Migration {
  override describe() {
    return {
      from: 'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
      to: 'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
      labels: ['backfill-product-status'],
    };
  }

  override get operations() {
    return [
      dataTransform('backfill-product-status', {
        check: {
          // `status` is not part of the typed Product shape (it's the field we
          // are backfilling), so use the callable form `f("status")` per
          // ADR 180. Strict path validation is tracked on TML-2281.
          source: () =>
            query
              .from('products')
              .match((f) => f('status').exists(false))
              .limit(1),
        },
        run: () =>
          query
            .from('products')
            .match((f) => f('status').exists(false))
            .updateMany((f) => [f('status').set('active')]),
      }),
    ];
  }
}

export default BackfillProductStatus;
Migration.run(import.meta.url, BackfillProductStatus);
