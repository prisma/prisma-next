#!/usr/bin/env -S node
import { addColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:3705eb1cd04a52180d1206181446bb87e18bb32afcc3d1dacbec685ca2d449d1',
      to: 'sha256:bf158ef32daace0a629bfdac5d569b0d43cd81e257e2463aef2545638e2c7585',
    };
  }

  override get operations() {
    return [
      addColumn('__unbound__', 'account', {
        name: 'locale',
        typeSql: 'text',
        defaultSql: '',
        nullable: true,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
