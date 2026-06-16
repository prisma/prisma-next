#!/usr/bin/env -S node
import { col, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:e4a035f4b5357858f774ed20d5854fe3c142668df154c60d065421f2fdd73104',
      to: 'sha256:7bdb036457641dc63b862e773f4b07cbdf4bb329d0267b1272de46766e7a0084',
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
