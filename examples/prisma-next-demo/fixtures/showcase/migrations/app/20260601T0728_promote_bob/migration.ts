#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:935a02360e01dda00d62f98429f4347bf765abf9118bca03941383cef87591c5',
      to: 'sha256:f66098408da51786d8c6701a2b10db2e90f4b7e138eb5e95f84dc61e156d242b',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'account', {
        name: 'bio',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      addColumn('__unbound__', 'account', {
        name: 'locale',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      addColumn('__unbound__', 'account', {
        name: 'phone',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
      addColumn('__unbound__', 'account', {
        name: 'verified',
        typeSql: 'bool',
        defaultSql: 'DEFAULT true',
        nullable: false,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
