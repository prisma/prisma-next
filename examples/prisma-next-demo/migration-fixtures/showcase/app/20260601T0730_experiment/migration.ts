#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:34dd5176d953c101467355b72fd2adf3e49c97bf13d8198dcc0dafec4d6341ce',
      to: 'sha256:f1e8cde6ed1bd4ed5851d1308cd58431169236230778c42382189cdc0557a7fb',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'widget', {
        name: 'count',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
