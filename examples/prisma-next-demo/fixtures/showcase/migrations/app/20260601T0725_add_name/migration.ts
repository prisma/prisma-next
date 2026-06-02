#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:3bfce91c81146b347dc05f423a71907a82d8b2e78ab5714b2bfab673f673d021',
      to: 'sha256:419c09911c25cf9b97e60ee157c61a126accfa5f26f5cdb7954667c704f53753',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'account', {
        name: 'name',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
