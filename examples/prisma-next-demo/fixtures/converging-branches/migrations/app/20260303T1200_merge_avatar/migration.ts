#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:7e3fa7fbe98974385451444c229337c87ec90c547a9214f81700f86b5af3563d',
      to: 'sha256:042e80cecce8271bb96dedcc7986dadb4c72b098ad5b5b43d8f3bf2d5d61806b',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'user', {
        name: 'phone',
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
