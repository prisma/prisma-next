#!/usr/bin/env -S node
import { addColumn, Migration } from '@prisma-next/target-postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:76c1bd5f5733774ae1182e83ca882f623cdf12e78a76c2fb06666d60bbdd6452',
      to: 'sha256:5618dcac53bc3aebf85f5da0f74670d6d2b2d340d449adc73219d7cbba360d69',
    };
  }

  override get operations() {
    return [
      addColumn('public', 'user', {
        name: 'displayName',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

Migration.run(import.meta.url, M);
