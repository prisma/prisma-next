#!/usr/bin/env -S node
import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';
import { createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:fa4b91dbc8e079a775b010fc5ca3616d3713afa64b1b9c97eedf4aa90cc0bf39',
    };
  }

  override get operations() {
    return [
      createTable(
        'public',
        'user',
        [
          { name: 'email', typeSql: 'eql_v2_encrypted', defaultSql: '', nullable: false },
          { name: 'id', typeSql: 'text', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      cipherstashAddSearchConfig({ table: 'user', column: 'email', index: 'unique' }),
      cipherstashAddSearchConfig({ table: 'user', column: 'email', index: 'match' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
