#!/usr/bin/env -S node
import { createTable, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:3bfce91c81146b347dc05f423a71907a82d8b2e78ab5714b2bfab673f673d021',
    };
  }

  override get operations() {
    return [
      createTable(
        '__unbound__',
        'account',
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
