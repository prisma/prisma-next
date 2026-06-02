#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:827997ce6f33b7193b0a9eda969affe757e0d54209fde344afcd4d41321c5078',
      to: 'sha256:d11106e57024ff51282c4a92f549538eb9b8c77b30c719d5e25e726e9cdb40de',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'user', {
        name: 'feature',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
