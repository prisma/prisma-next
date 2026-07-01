#!/usr/bin/env -S node
import { col, Migration, MigrationCLI, primaryKey } from '@prisma-next/postgres/migration';
import type { Contract as End } from './end-contract';
import endContract from './end-contract.json' with { type: 'json' };

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        table: 'user',
        columns: [
          col('email', 'text', { notNull: true }),
          col('id', 'character(36)', { notNull: true }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
