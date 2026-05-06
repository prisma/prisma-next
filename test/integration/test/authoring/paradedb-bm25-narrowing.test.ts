/**
 * End-to-end TS narrowing for the paradedb bm25 index type.
 *
 * Verifies that when a contract attaches `paradedbPack` via the
 * `defineContract({...}, ({ model }) => ...)` factory form, the
 * `constraints.index({ type: 'bm25', options: ... })` call site narrows
 * `options` against the registered shape and rejects unregistered types
 * and bad option shapes at compile time.
 */
import { int4Column, textColumn } from '@prisma-next/adapter-postgres/column-types';
import paradedbPack from '@prisma-next/extension-paradedb/pack';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';
import { describe, expect, it } from 'vitest';

describe('paradedb bm25 narrowing in TS authoring DSL', () => {
  it('typechecks and accepts a well-formed bm25 index via the helpers factory', () => {
    const contract = defineContract(
      {
        family: sqlFamily,
        target: postgresPack,
        extensionPacks: { paradedb: paradedbPack },
      },
      ({ model: helperModel, field: helperField }) => {
        const Doc = helperModel('Doc', {
          fields: {
            id: helperField.column(int4Column).id(),
            body: helperField.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'doc',
          indexes: [
            constraints.index(cols.body, {
              type: 'bm25',
              options: { key_field: 'id' },
              name: 'doc_body_bm25_idx',
            }),
          ],
        }));
        return { models: { Doc } };
      },
    );

    const indexes = contract.storage.tables.doc.indexes;
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({
      columns: ['body'],
      name: 'doc_body_bm25_idx',
      type: 'bm25',
      options: { key_field: 'id' },
    });
  });

  it('rejects a bm25 index with an unknown options key at compile time', () => {
    defineContract(
      {
        family: sqlFamily,
        target: postgresPack,
        extensionPacks: { paradedb: paradedbPack },
      },
      ({ model: helperModel, field: helperField }) => {
        const Doc = helperModel('Doc', {
          fields: {
            id: helperField.column(int4Column).id(),
            body: helperField.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'doc',
          indexes: [
            // @ts-expect-error — bm25 options is { key_field: string } in strict mode; unknown_key is rejected
            constraints.index(cols.body, {
              type: 'bm25',
              options: { key_field: 'id', unknown_key: 'x' },
            }),
          ],
        }));
        return { models: { Doc } };
      },
    );
  });

  it('rejects a bm25 index missing the required key_field at compile time', () => {
    defineContract(
      {
        family: sqlFamily,
        target: postgresPack,
        extensionPacks: { paradedb: paradedbPack },
      },
      ({ model: helperModel, field: helperField }) => {
        const Doc = helperModel('Doc', {
          fields: {
            id: helperField.column(int4Column).id(),
            body: helperField.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'doc',
          indexes: [
            // @ts-expect-error — bm25 options requires key_field
            constraints.index(cols.body, {
              type: 'bm25',
              options: {},
            }),
          ],
        }));
        return { models: { Doc } };
      },
    );
  });

  it('rejects an unregistered index type at compile time', () => {
    defineContract(
      {
        family: sqlFamily,
        target: postgresPack,
        extensionPacks: { paradedb: paradedbPack },
      },
      ({ model: helperModel, field: helperField }) => {
        const Doc = helperModel('Doc', {
          fields: {
            id: helperField.column(int4Column).id(),
            body: helperField.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'doc',
          indexes: [
            // @ts-expect-error — only 'bm25' is registered when paradedb is attached; 'made-up' is not
            constraints.index(cols.body, {
              type: 'made-up',
              options: {},
            }),
          ],
        }));
        return { models: { Doc } };
      },
    );
  });

  it('rejects options without a type at compile time', () => {
    defineContract(
      {
        family: sqlFamily,
        target: postgresPack,
        extensionPacks: { paradedb: paradedbPack },
      },
      ({ model: helperModel, field: helperField }) => {
        const Doc = helperModel('Doc', {
          fields: {
            id: helperField.column(int4Column).id(),
            body: helperField.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'doc',
          indexes: [
            // @ts-expect-error — providing options without a type is a compile error when packs contribute index types
            constraints.index(cols.body, {
              options: { key_field: 'id' },
            }),
          ],
        }));
        return { models: { Doc } };
      },
    );
  });

  it('imported bare model() rejects any type/options — strict by default', () => {
    const Doc = model('Doc', {
      fields: {
        id: field.column(int4Column).id(),
        body: field.column(textColumn),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'doc',
      indexes: [
        // @ts-expect-error - bare model() has no attached packs, so no index
        // type literals are registered; type/options aren't allowed at all.
        constraints.index(cols.body, { type: 'made-up', options: {} }),
      ],
    }));

    defineContract({
      family: sqlFamily,
      target: postgresPack,
      models: { Doc },
    });
  });

  it('imported bare model() still accepts a default index with no type/options', () => {
    const Doc = model('Doc', {
      fields: {
        id: field.column(int4Column).id(),
        body: field.column(textColumn),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'doc',
      indexes: [constraints.index(cols.body)],
    }));

    defineContract({
      family: sqlFamily,
      target: postgresPack,
      models: { Doc },
    });
  });
});
