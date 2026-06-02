#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:93be6c200743261baf55f0586b1380a1c0ade3c48730c09a8fec71ba419c2464',
      to: 'sha256:042e80cecce8271bb96dedcc7986dadb4c72b098ad5b5b43d8f3bf2d5d61806b',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'user', {
        name: 'avatar',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      addColumn('__unbound__', 'user', {
        name: 'posts',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
