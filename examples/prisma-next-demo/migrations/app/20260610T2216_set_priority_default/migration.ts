#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:7bdb036457641dc63b862e773f4b07cbdf4bb329d0267b1272de46766e7a0084',
      to: 'sha256:9f07ac18eb5ab5c21cff6b8414fb2a29bfae8d8b21009fbdd29616b4718e1d99',
    };
  }

  override get operations() {
    return [
      this.setDefault({
        schema: 'public',
        table: 'post',
        column: 'priority',
        defaultSql: "DEFAULT 'low'",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
