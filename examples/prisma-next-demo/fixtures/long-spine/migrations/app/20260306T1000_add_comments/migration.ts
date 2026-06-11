#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:47f4a4f58e99a479aaa3ba2ff9d00d1728b1c240359e03aa564ae163d63ba8d7',
      to: 'sha256:b34dc9149b6856eacb47e3e6f2157860d8690f5fb382e71ae6b27f943007b778',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('comments', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
