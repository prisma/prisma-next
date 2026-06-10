#!/usr/bin/env -S node
import {
  addCheckConstraint,
  addColumn,
  Migration,
  MigrationCLI,
  setNotNull,
} from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:ab50cca9eadd5727aa91cf94a1fd3910efbd8d1c5b8da6526c32ced6bc377a97',
      to: 'sha256:6eaa28f191dcea1d39893f39cf44790e2187bbb617250e20cd0fee20785f1a0f',
    };
  }

  override get operations() {
    return [
      addColumn('public', 'post', {
        name: 'priority',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
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
