#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:789dd79ab5ab725be1b6ced088109b803a4d62f9874f932eb384a868d94360a4',
      to: 'sha256:f224748df616e79a307d7d1d964b2cca74f858a8f00c95ed131d7675a3e74554',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'user', {
        name: 'settings',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
