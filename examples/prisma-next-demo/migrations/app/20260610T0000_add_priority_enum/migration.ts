#!/usr/bin/env -S node
import {
  addCheckConstraint,
  col,
  Migration,
  MigrationCLI,
  setNotNull,
} from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:ca7dc29135114fe62434821b39aede307bc99b0d9b92da12d7d7a14bdadc462f',
      to: 'sha256:440a13d96bde518960481a41681ec2ccef1f7559f60fbc5d77ca9cccca5d864a',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: 'public', table: 'post', column: col('priority', 'text') }),
      setNotNull('public', 'post', 'priority'),
      addCheckConstraint('public', 'post', 'post_priority_check', 'priority', [
        'low',
        'high',
        'urgent',
      ]),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
