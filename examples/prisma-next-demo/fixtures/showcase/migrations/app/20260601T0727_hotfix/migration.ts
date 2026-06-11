#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:bf158ef32daace0a629bfdac5d569b0d43cd81e257e2463aef2545638e2c7585',
      to: 'sha256:f66098408da51786d8c6701a2b10db2e90f4b7e138eb5e95f84dc61e156d242b',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: '__unbound__', table: 'account', column: col('verified', 'bool') }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
