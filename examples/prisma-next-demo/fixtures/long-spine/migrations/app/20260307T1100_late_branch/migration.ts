#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:99de8c2642999fd9b4c99ea77e53e8e31cb65d66575027eb287e8b0d849e8b84',
      to: 'sha256:6c66c897ec186bbc7b69feb6bfc5bb19b28a4c9ffe1a4fff5c96172cf5716ea5',
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
