import { MigrationCLI } from '@prisma-next/cli/migration-cli';
import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';

class InitialMigration extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:2827cbad7293fe13a4fb2aab60a55d3cddd856a86d1f6ccea6e11519faacff92',
    };
  }

  override get operations() {
    return [createIndex('users', [{ field: 'email', direction: 1 }], { unique: true })];
  }
}

export default InitialMigration;
MigrationCLI.run(import.meta.url, InitialMigration);
