#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:7e951c7a95f42ca0420d9c4aae3602e32911606399982347621943fce34076d8',
      to: 'sha256:47f4a4f58e99a479aaa3ba2ff9d00d1728b1c240359e03aa564ae163d63ba8d7',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'user', {
        name: 'avatar',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
