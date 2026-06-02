#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:93be6c200743261baf55f0586b1380a1c0ade3c48730c09a8fec71ba419c2464',
      to: 'sha256:f9a41d77df6eae57bcd25ab25df31e6e905aad034a5b813f408bf8e78e9f384a',
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
