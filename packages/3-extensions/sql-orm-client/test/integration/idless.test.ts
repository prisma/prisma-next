import { describe, expect, it } from 'vitest';
import { createIdlessTagsCollection, timeouts, withCollectionRuntime } from './helpers';

describe('integration/idless', () => {
  it(
    'updateCount() returns matched row count on an id-less model and updates data',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const tags = createIdlessTagsCollection(runtime);

        await runtime.query(`insert into tags (id, name) values ('a', 'old-1')`);
        await runtime.query(`insert into tags (id, name) values ('b', 'old-2')`);
        await runtime.query(`insert into tags (id, name) values ('c', 'fresh')`);

        const count = await tags.where({ name: 'old-1' }).updateCount({ name: 'new-1' });
        expect(count).toBe(1);

        const rows = await runtime.query<{ id: string; name: string }>(
          'select id, name from tags order by id',
        );
        expect(rows).toEqual([
          { id: 'a', name: 'new-1' },
          { id: 'b', name: 'old-2' },
          { id: 'c', name: 'fresh' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'deleteCount() returns matched row count on an id-less model and deletes the row',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const tags = createIdlessTagsCollection(runtime);

        await runtime.query(`insert into tags (id, name) values ('a', 'keep')`);
        await runtime.query(`insert into tags (id, name) values ('b', 'drop')`);

        const count = await tags.where({ name: 'drop' }).deleteCount();
        expect(count).toBe(1);

        const rows = await runtime.query<{ id: string; name: string }>(
          'select id, name from tags order by id',
        );
        expect(rows).toEqual([{ id: 'a', name: 'keep' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updateCount() returns zero for an id-less model when no rows match',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const tags = createIdlessTagsCollection(runtime);

        await runtime.query(`insert into tags (id, name) values ('a', 'untouched')`);

        const count = await tags.where({ name: 'absent' }).updateCount({ name: 'never' });
        expect(count).toBe(0);

        const rows = await runtime.query<{ id: string; name: string }>(
          'select id, name from tags order by id',
        );
        expect(rows).toEqual([{ id: 'a', name: 'untouched' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
