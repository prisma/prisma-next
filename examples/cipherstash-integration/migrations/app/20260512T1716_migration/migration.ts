#!/usr/bin/env -S node
import { cipherstashAddSearchConfig } from '@prisma-next/extension-cipherstash/migration';
import { createTable, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:7475191ce0d78258ce5586265bcdfd12202f5daf90690b902890e58eb7508373',
    };
  }

  override get operations() {
    return [
      createTable(
        'public',
        'users',
        [
          {
            name: 'accountid',
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
            name: 'emailverified',
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
        column: 'accountid',
        index: 'unique',
        castAs: 'big_int',
      }),
      cipherstashAddSearchConfig({
        table: 'users',
        column: 'accountid',
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
        column: 'emailverified',
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
