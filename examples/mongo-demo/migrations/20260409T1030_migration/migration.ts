import { Migration } from '@prisma-next/family-mongo/migration';
import { createIndex } from '@prisma-next/target-mongo/migration';

class InitialMigration extends Migration {
  override describe() {
    return {
      from: 'sha256:empty',
      to: 'sha256:358522152ebe3ca9db3d573471c656778c1845f4cdd424caf06632352b9772fe',
    };
  }

  override get operations() {
    return [createIndex('users', [{ field: 'email', direction: 1 }], { unique: true })];
  }
}

export default InitialMigration;
Migration.run(import.meta.url, InitialMigration);
