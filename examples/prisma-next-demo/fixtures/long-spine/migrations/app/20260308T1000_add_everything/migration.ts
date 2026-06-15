#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:99de8c2642999fd9b4c99ea77e53e8e31cb65d66575027eb287e8b0d849e8b84',
      to: 'sha256:2636edd722347d39a60458e4b0733f62e8d316d054fb7cca2b801e91cd619f74',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('category', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('settings', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
