#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:f5aa17d46d7be94ca3ddf4d14d90e0444291d9c063c52d0e05455726e52e0026',
      to: 'sha256:83a1ded0b0045642794c268ef48d21d54bb65a481c13c8b243a7f5821b78d9a0',
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
