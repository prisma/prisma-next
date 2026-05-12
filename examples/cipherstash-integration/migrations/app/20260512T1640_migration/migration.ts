#!/usr/bin/env -S node
import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';
import { createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:b2a92c54647cc15c38833a97de53e617e7f9bd8c0d9e29ddca97374cfee25c31',
    };
  }

  override get operations() {
    return [
      createTable(
        'public',
        'users',
        [
          {
            name: 'accountId',
            typeSql: 'eql_v2_encrypted',
            defaultSql: '',
            nullable: false,
          },
          {
            name: 'birthday',
            typeSql: 'eql_v2_encrypted',
            defaultSql: '',
            nullable: false,
          },
          { name: 'email', typeSql: 'eql_v2_encrypted', defaultSql: '', nullable: false },
          {
            name: 'emailVerified',
            typeSql: 'eql_v2_encrypted',
            defaultSql: '',
            nullable: false,
          },
          { name: 'id', typeSql: 'text', defaultSql: '', nullable: false },
          {
            name: 'preferences',
            typeSql: 'eql_v2_encrypted',
            defaultSql: '',
            nullable: false,
          },
          { name: 'salary', typeSql: 'eql_v2_encrypted', defaultSql: '', nullable: false },
        ],
        { columns: ['id'] },
      ),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'accountId',
        index: 'unique',
        castAs: 'big_int',
      }),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'accountId',
        index: 'ore',
        castAs: 'big_int',
      }),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'birthday',
        index: 'unique',
        castAs: 'date',
      }),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'birthday',
        index: 'ore',
        castAs: 'date',
      }),
      cipherstashAddSearchConfig({ table: 'users', column: 'email', index: 'unique' }),
      cipherstashAddSearchConfig({ table: 'users', column: 'email', index: 'match' }),
      cipherstashAddSearchConfig({ table: 'users', column: 'email', index: 'ore' }),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'emailVerified',
        index: 'unique',
        castAs: 'boolean',
      }),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'preferences',
        index: 'ste_vec',
        castAs: 'jsonb',
      }),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'salary',
        index: 'unique',
        castAs: 'double',
      }),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'salary',
        index: 'ore',
        castAs: 'double',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
