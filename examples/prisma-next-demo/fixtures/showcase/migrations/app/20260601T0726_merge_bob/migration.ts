#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:935a02360e01dda00d62f98429f4347bf765abf9118bca03941383cef87591c5',
      to: 'sha256:83a1ded0b0045642794c268ef48d21d54bb65a481c13c8b243a7f5821b78d9a0',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
