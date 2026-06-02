#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:83a1ded0b0045642794c268ef48d21d54bb65a481c13c8b243a7f5821b78d9a0',
      to: 'sha256:3705eb1cd04a52180d1206181446bb87e18bb32afcc3d1dacbec685ca2d449d1',
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
