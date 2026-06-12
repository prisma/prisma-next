#!/usr/bin/env -S node
import { Migration, MigrationCLI, setDefault } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:440a13d96bde518960481a41681ec2ccef1f7559f60fbc5d77ca9cccca5d864a',
      to: 'sha256:1a02eed4ad52f589641c1e16b929427e1060acc6bc1e9cc4e3b6e663523f88b4',
    };
  }

  override get operations() {
    return [setDefault('public', 'post', 'priority', "DEFAULT 'low'")];
  }
}

MigrationCLI.run(import.meta.url, M);
