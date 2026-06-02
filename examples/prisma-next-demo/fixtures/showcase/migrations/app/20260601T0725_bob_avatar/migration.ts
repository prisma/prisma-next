#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:419c09911c25cf9b97e60ee157c61a126accfa5f26f5cdb7954667c704f53753',
      to: 'sha256:935a02360e01dda00d62f98429f4347bf765abf9118bca03941383cef87591c5',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'account', {
        name: 'avatar',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
