#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:7e3fa7fbe98974385451444c229337c87ec90c547a9214f81700f86b5af3563d',
      to: 'sha256:042e80cecce8271bb96dedcc7986dadb4c72b098ad5b5b43d8f3bf2d5d61806b',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('phone', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('posts', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
