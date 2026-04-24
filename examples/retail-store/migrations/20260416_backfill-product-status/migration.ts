import { runMigration } from '@prisma-next/cli/migration-runner';
import { Migration } from '@prisma-next/family-mongo/migration';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import { dataTransform } from '@prisma-next/target-mongo/migration';
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

const query = mongoQuery<Contract>({ contractJson: endContractJson });

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
          // `status` is not part of the typed Product shape (it's the field
          // we are backfilling), so use the `f.rawPath(...)` escape hatch —
          // the strict callable `f("status")` would reject an unknown path
          // per TML-2281. `f.rawPath` yields the full leaf operator surface
          // with no contract validation; this is the sanctioned pattern for
          // migration authoring where the target field is not yet part of
          // the contract. The method is named `rawPath` (not `raw`) so it
          // does not shadow a legitimate top-level `raw` field on a user
          // model. See ADR 180 and @prisma-next/mongo-query-builder's README.
          source: () =>
            query
              .from('products')
              .match((f) => f.rawPath('status').exists(false))
              .limit(1),
        },
        run: () =>
          query
            .from('products')
            .match((f) => f.rawPath('status').exists(false))
            .updateMany((f) => [f.rawPath('status').set('active')]),
      }),
    ];
  }
}

export default BackfillProductStatus;
runMigration(import.meta.url, BackfillProductStatus);
