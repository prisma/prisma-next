#!/usr/bin/env -S node
import { createTable, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:789dd79ab5ab725be1b6ced088109b803a4d62f9874f932eb384a868d94360a4',
    };
  }

  override get operations() {
    return [
      createTable(
        '__unbound__',
        'user',
        [
          { name: 'email', typeSql: 'text', defaultSql: '', nullable: false },
          { name: 'id', typeSql: 'character(36)', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
