#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:789dd79ab5ab725be1b6ced088109b803a4d62f9874f932eb384a868d94360a4',
      to: 'sha256:afdcd8ee600252054660e79266ede99d1f5227b586225985565eff24414696d0',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'user', {
        name: 'posts',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
