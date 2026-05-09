import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import { dataTransform } from '@prisma-next/target-mongo/migration';
import type { Contract } from './end-contract';
import endContractJson from './end-contract.json' with { type: 'json' };

// Build the query DSL against this migration's *end* contract — the shape of
// the data after the migration completes. `Product.status` is part of that
// contract, so the strict callable `f.status` resolves with full type safety.
const query = mongoQuery<Contract>({ contractJson: endContractJson });

class BackfillProductStatus extends Migration {
  override describe() {
    return {
      from: 'sha256:e5cfc21670435e53a4af14a665d61d8ba716d5e2e67b63c1443affdcad86985d',
      to: 'sha256:4407077380e2331b356697c35153192b3bdafadb432f0d64b081d24e8af3e55a',
      labels: ['backfill-product-status'],
    };
  }

  override get operations() {
    return [
      // Backfill `status: 'active'` on existing products that pre-date the
      // field. The check guards re-runs: if no missing-status documents
      // remain, the dataTransform is a no-op. The run uses the typed
      // accessor `f.status` against the end contract — no escape hatches
      // are required, because we are introducing the field as part of *this*
      // migration. See `docs/architecture docs/adrs/ADR 180 - Dot-path field accessor.md`
      // for when `f.rawPath(...)` is the right tool instead (it isn't here).
      dataTransform('backfill-product-status', {
        check: {
          source: () =>
            query
              .from('products')
              .match((f) => f.status.exists(false))
              .limit(1),
        },
        run: () =>
          query
            .from('products')
            .match((f) => f.status.exists(false))
            .updateMany((f) => [f.status.set('active')]),
      }),
    ];
  }
}

export default BackfillProductStatus;
MigrationCLI.run(import.meta.url, BackfillProductStatus);
