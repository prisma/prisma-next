#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:827997ce6f33b7193b0a9eda969affe757e0d54209fde344afcd4d41321c5078',
      to: 'sha256:7e951c7a95f42ca0420d9c4aae3602e32911606399982347621943fce34076d8',
    };
  }

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
