import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withSqliteTestRuntime } from './utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('e2e: ported regressions on SQLite', { timeout: timeouts.databaseOperation }, () => {
  it('#106 nested "some ... in" relation filter does not duplicate the parent in a count', async () => {
    await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient, rawDb }) => {
      rawDb
        .prepare('INSERT INTO users (id, name, email, invited_by_id) VALUES (?, ?, ?, ?)')
        .run(9001, 'Org 28968', 'org-28968@example.com', null);
      rawDb
        .prepare('INSERT INTO posts (id, title, user_id, views) VALUES (?, ?, ?, ?)')
        .run(9001, 'Type 1', 9001, 1);
      rawDb
        .prepare('INSERT INTO posts (id, title, user_id, views) VALUES (?, ?, ?, ?)')
        .run(9002, 'Type 10', 9001, 10);

      const result = await ormClient[UNBOUND_NAMESPACE_ID].User.where((u) => u.id.eq(9001))
        .where((u) => u.posts.some((p) => p.views.in([1, 10])))
        .aggregate((aggregate) => ({ count: aggregate.count() }));

      expect(result).toEqual({ count: 1 });
    });
  });
});
