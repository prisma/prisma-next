#!/usr/bin/env -S node
import {
  createTable,
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma-next/target-postgres/migration';

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
      rawSql({
        id: 'cipherstash-codec.user.email.add-search-config.unique',
        label: 'Register cipherstash search config (unique) for user.email',
        operationClass: 'additive',
        invariantId: 'cipherstash-codec:user.email:add-search-config:unique@v1',
        target: { id: 'postgres' },
        precheck: [],
        execute: [
          {
            description: 'Register cipherstash unique search config for user.email',
            sql: "SELECT eql_v2.add_search_config('user', 'email', 'unique', 'text');",
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'cipherstash-codec.user.email.add-search-config.match',
        label: 'Register cipherstash search config (match) for user.email',
        operationClass: 'additive',
        invariantId: 'cipherstash-codec:user.email:add-search-config:match@v1',
        target: { id: 'postgres' },
        precheck: [],
        execute: [
          {
            description: 'Register cipherstash match search config for user.email',
            sql: "SELECT eql_v2.add_search_config('user', 'email', 'match', 'text');",
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
