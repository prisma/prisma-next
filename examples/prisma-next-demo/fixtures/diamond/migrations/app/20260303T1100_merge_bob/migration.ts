#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:7e3fa7fbe98974385451444c229337c87ec90c547a9214f81700f86b5af3563d',
      to: 'sha256:f9a41d77df6eae57bcd25ab25df31e6e905aad034a5b813f408bf8e78e9f384a',
    };
  }

  override get operations() {
    return [this.addColumn({ schema: '__unbound__', table: 'user', column: col('phone', 'text') })];
  }
}

MigrationCLI.run(import.meta.url, M);
