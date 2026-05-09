#!/usr/bin/env -S node
import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';
import { createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:79f6ec1138421f622bdb029df699d034eb2a93d5675c1e653e23cd667f35427e',
    };
  }

  override get operations() {
    return [
      createTable(
        'public',
        'users',
        [
          { name: 'email', typeSql: 'eql_v2_encrypted', defaultSql: '', nullable: false },
          { name: 'id', typeSql: 'text', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      cipherstashAddSearchConfig({ table: 'users', column: 'email', index: 'unique' }),
      cipherstashAddSearchConfig({ table: 'users', column: 'email', index: 'match' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
