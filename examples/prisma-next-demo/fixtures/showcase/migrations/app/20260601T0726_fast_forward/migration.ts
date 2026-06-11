#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:3bfce91c81146b347dc05f423a71907a82d8b2e78ab5714b2bfab673f673d021',
      to: 'sha256:83a1ded0b0045642794c268ef48d21d54bb65a481c13c8b243a7f5821b78d9a0',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('avatar', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('name', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
