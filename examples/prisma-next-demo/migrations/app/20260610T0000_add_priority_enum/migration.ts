#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:ab50cca9eadd5727aa91cf94a1fd3910efbd8d1c5b8da6526c32ced6bc377a97',
      to: 'sha256:9b1657a8f40dda814d47ed3d8f4bdf704c0bf057cf6fc23b7b2090ce2748df20',
    };
  }

  override get operations() {
    return [
      this.addColumn({ schema: 'public', table: 'post', column: col('priority', 'text') }),
      this.setNotNull({ schema: 'public', table: 'post', column: 'priority' }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'post',
        constraint: 'post_priority_check',
        column: 'priority',
        values: ['low', 'high', 'urgent'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
