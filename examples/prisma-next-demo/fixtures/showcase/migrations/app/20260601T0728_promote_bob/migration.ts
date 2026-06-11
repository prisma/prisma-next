#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:935a02360e01dda00d62f98429f4347bf765abf9118bca03941383cef87591c5',
      to: 'sha256:f66098408da51786d8c6701a2b10db2e90f4b7e138eb5e95f84dc61e156d242b',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('bio', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('locale', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('phone', 'text') }),
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('verified', 'bool') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
