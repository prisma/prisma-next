#!/usr/bin/env -S node
import { createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:e7a624bf75596d5cc3ccd76bab9b0e51f45119abace330fe47a3ebd7af6a9c67',
    };
  }

  override get operations() {
    return [
      createTable('public', 'test_box', [
        { name: 'x', typeSql: 'int4', defaultSql: '', nullable: false },
        { name: 'y', typeSql: 'int4', defaultSql: '', nullable: false },
      ]),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
