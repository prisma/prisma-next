#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:afdcd8ee600252054660e79266ede99d1f5227b586225985565eff24414696d0',
      to: 'sha256:042e80cecce8271bb96dedcc7986dadb4c72b098ad5b5b43d8f3bf2d5d61806b',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('avatar', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'user', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
