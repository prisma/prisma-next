import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';
import type { Contract as End } from './end-contract';
import endContract from './end-contract.json' with { type: 'json' };

class InitialMigration extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [createIndex('users', [{ field: 'email', direction: 1 }], { unique: true })];
  }
}

export default InitialMigration;
MigrationCLI.run(import.meta.url, InitialMigration);
