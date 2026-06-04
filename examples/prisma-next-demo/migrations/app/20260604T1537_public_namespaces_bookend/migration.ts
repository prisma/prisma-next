#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: 'sha256:f7a8eb5124c7d031e4c57f489cf2aa10c921333cd6caf7676993d9105d96e7f3',
      to: 'sha256:1375f137fa3186c77cda92aba4048c49714ed5fe65993ca7d5eed3bcd9e85cb7',
    };
  }

  override get operations() {
    // Empty-ops bookend that absorbs the namespace-layout reshape between the
    // pre-domain.namespaces head (`storage.namespaces.__unspecified__`) and the
    // current `public` layout. The change is metadata-only — no table, column,
    // or constraint moves — so there is no DDL to emit; the bookend only updates
    // `from`/`to` so the next `migration plan` diffs against a same-layout
    // contract instead of reporting a disjoint-namespace greenfield. Same
    // pattern as the earlier 20260518T1701_namespaces_bookend.
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
