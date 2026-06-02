#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:789dd79ab5ab725be1b6ced088109b803a4d62f9874f932eb384a868d94360a4',
      to: 'sha256:2796854eb60b7ce66a0cd34d550680931f82fc2d2dca048726f971d1cc3aef10',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'user', {
        name: 'category',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
