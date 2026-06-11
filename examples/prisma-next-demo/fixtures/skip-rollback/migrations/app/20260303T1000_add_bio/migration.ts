#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:93be6c200743261baf55f0586b1380a1c0ade3c48730c09a8fec71ba419c2464',
      to: 'sha256:827997ce6f33b7193b0a9eda969affe757e0d54209fde344afcd4d41321c5078',
    };
  }

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('bio', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
