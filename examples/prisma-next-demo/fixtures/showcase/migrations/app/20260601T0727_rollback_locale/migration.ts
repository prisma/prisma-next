#!/usr/bin/env -S node
import { dropColumn, Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:bf158ef32daace0a629bfdac5d569b0d43cd81e257e2463aef2545638e2c7585',
      to: 'sha256:3705eb1cd04a52180d1206181446bb87e18bb32afcc3d1dacbec685ca2d449d1',
    };
  }

  override get operations() {
    return [dropColumn('__unbound__', 'account', 'locale')];
  }
}

MigrationCLI.run(import.meta.url, M);
