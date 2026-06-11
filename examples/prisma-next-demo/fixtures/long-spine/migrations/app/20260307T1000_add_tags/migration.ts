#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:b34dc9149b6856eacb47e3e6f2157860d8690f5fb382e71ae6b27f943007b778',
      to: 'sha256:99de8c2642999fd9b4c99ea77e53e8e31cb65d66575027eb287e8b0d849e8b84',
    };
  }

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('tags', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
