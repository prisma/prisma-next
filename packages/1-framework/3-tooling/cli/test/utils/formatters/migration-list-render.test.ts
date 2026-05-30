import type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from '@prisma-next/migration-tools/migration-list-types';
import { describe, expect, it } from 'vitest';
import {
  IDENTITY_MIGRATION_LIST_STYLER,
  renderMigrationList,
  renderMigrationListWithStyle,
} from '../../../src/utils/formatters/migration-list-render';

const HASH_A = 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789ab';
const HASH_B = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef12';
const HASH_C = 'sha256:4cb4256c30b7a8123456789012345678901234567890123456';
const HASH_D = 'sha256:55bada2f123456789012345678901234567890123456789012';
const HASH_E = 'sha256:2f45cc7123456789012345678901234567890123456789012';
const HASH_F = 'sha256:804e0181234567890123456789012345678901234567890123';

let migrationHashSeq = 0;

function migration(
  overrides: Pick<MigrationListEntry, 'dirName' | 'to'> &
    Partial<Omit<MigrationListEntry, 'dirName' | 'to'>>,
): MigrationListEntry {
  return {
    from: null,
    migrationHash: overrides.migrationHash ?? `sha256:list-mig-${migrationHashSeq++}`,
    operationCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    refs: [],
    providedInvariants: [],
    ...overrides,
  };
}

function result(spaces: readonly MigrationSpaceListEntry[], summary: string): MigrationListResult {
  return { ok: true, spaces, summary };
}

function renderListed(listResult: MigrationListResult): string {
  return renderMigrationList(listResult);
}

describe('renderMigrationList', () => {
  it('uses ASCII kind glyphs when glyph mode is ascii', () => {
    const eUsers = migration({ dirName: '20250115_add_users', from: null, to: HASH_A });
    const ePosts = migration({ dirName: '20250203_add_posts', from: HASH_A, to: HASH_B });
    const eComments = migration({ dirName: '20250310_add_comments', from: HASH_B, to: HASH_C });
    const eRollback = migration({
      dirName: '20250312_full_rollback',
      from: HASH_C,
      to: HASH_A,
      migrationHash: 'sha256:rollback-edge',
    });
    const output = renderMigrationListWithStyle(
      result(
        [
          {
            spaceId: 'app',
            migrations: [eRollback, eComments, ePosts, eUsers],
          },
        ],
        '4 migration(s) on disk',
      ),
      IDENTITY_MIGRATION_LIST_STYLER,
      'ascii',
    );
    expect(output).toMatch(/^< 20250312_full_rollback/);
    expect(output).toContain('4cb4256 -> abcdef0');
    expect(output).not.toContain('↩');
    expect(output).not.toContain('→');
  });

  it('leads forward row with asterisk kind glyph', () => {
    const listResult = result(
      [
        {
          spaceId: 'app',
          migrations: [
            migration({
              dirName: '20260422T0742_migration',
              from: HASH_A,
              to: HASH_B,
            }),
          ],
        },
      ],
      '1 migration(s) on disk',
    );
    expect(renderListed(listResult)).toMatch(/^\* 20260422T0742_migration/);
  });

  it('leads rollback row with plain arrow and both hashes', () => {
    const eUsers = migration({ dirName: '20250115_add_users', from: null, to: HASH_A });
    const ePosts = migration({ dirName: '20250203_add_posts', from: HASH_A, to: HASH_B });
    const eComments = migration({ dirName: '20250310_add_comments', from: HASH_B, to: HASH_C });
    const eRollback = migration({
      dirName: '20250312_full_rollback',
      from: HASH_C,
      to: HASH_A,
      migrationHash: 'sha256:rollback-edge',
    });
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [eRollback, eComments, ePosts, eUsers],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toMatch(/^↩ 20250312_full_rollback/);
    expect(output).toContain('4cb4256 → abcdef0');
    expect(output).not.toMatch(/↩.*↩/);
  });

  it('aligns self-edge hash with forward-row source-hash column', () => {
    const listResult = result(
      [
        {
          spaceId: 'app',
          migrations: [
            migration({
              dirName: '20260601T1200_latest',
              from: HASH_E,
              to: HASH_F,
            }),
            migration({
              dirName: '20260601T1200_backfill_emails',
              from: HASH_D,
              to: HASH_D,
            }),
          ],
        },
      ],
      '2 migration(s) on disk',
    );
    const lines = renderListed(listResult)
      .split('\n')
      .filter((line) => line.startsWith('*') || line.startsWith('⟲'));
    const forwardLine = lines.find((line) => line.startsWith('*'));
    const selfLine = lines.find((line) => line.startsWith('⟲'));
    expect(forwardLine).toBeDefined();
    expect(selfLine).toBeDefined();
    const forwardHashIndex = forwardLine!.indexOf('2f45cc7');
    const selfHashIndex = selfLine!.indexOf('55bada2');
    expect(forwardHashIndex).toBeGreaterThanOrEqual(0);
    expect(selfHashIndex).toBe(forwardHashIndex);
  });

  it('renders self-edge as kind glyph dirName and single hash', () => {
    const listResult = result(
      [
        {
          spaceId: 'app',
          migrations: [
            migration({
              dirName: '20260601T1200_backfill_emails',
              from: HASH_D,
              to: HASH_D,
            }),
          ],
        },
      ],
      '1 migration(s) on disk',
    );
    const output = renderListed(listResult);
    expect(output).toMatch(/^⟲ 20260601T1200_backfill_emails/);
    expect(output).toContain('55bada2');
    expect(output).not.toContain('→');
  });

  it('defaults missing migration hash to forward kind glyph', () => {
    const row = migration({ dirName: '20260422T0742_migration', from: HASH_A, to: HASH_B });
    const output = renderListed(
      result([{ spaceId: 'app', migrations: [row] }], '1 migration(s) on disk'),
    );
    expect(output).toMatch(/^\* 20260422T0742_migration/);
  });
  it('renders baseline migration with null from', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260422T0720_initial',
                from: null,
                to: HASH_C,
                migrationHash: 'sha256:initial000000000000000000000000000000000000000000',
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "* 20260422T0720_initial  ∅       → 4cb4256

      1 migration(s) on disk"
    `);
  });

  it('renders normal forward edge with refs', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260422T0742_migration',
                from: HASH_A,
                to: HASH_B,
                refs: ['production'],
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "* 20260422T0742_migration  abcdef0 → 1234567  (production)

      1 migration(s) on disk"
    `);
  });

  it('renders self-edge with invariants and refs', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260601T1200_backfill_emails',
                from: HASH_D,
                to: HASH_D,
                providedInvariants: ['backfill_emails_v1'],
                refs: ['production'],
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "⟲ 20260601T1200_backfill_emails  55bada2  {backfill_emails_v1} (production)

      1 migration(s) on disk"
    `);
  });

  it('preserves migration input order within a space', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260601T1200_latest',
                from: HASH_E,
                to: HASH_F,
              }),
              migration({
                dirName: '20260518T1701_middle',
                from: HASH_D,
                to: HASH_E,
              }),
              migration({
                dirName: '20260422T0720_initial',
                from: null,
                to: HASH_D,
              }),
            ],
          },
        ],
        '3 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "* 20260601T1200_latest   2f45cc7 → 804e018
      * 20260518T1701_middle   55bada2 → 2f45cc7
      * 20260422T0720_initial  ∅       → 55bada2

      3 migration(s) on disk"
    `);
  });

  it('renders convergence with shared destination and refs', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260601T1200_branch_a',
                from: HASH_A,
                to: HASH_B,
                refs: ['production'],
              }),
              migration({
                dirName: '20260518T1701_branch_b',
                from: HASH_C,
                to: HASH_B,
                refs: ['production'],
              }),
            ],
          },
        ],
        '2 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "* 20260601T1200_branch_a  abcdef0 → 1234567  (production)
      * 20260518T1701_branch_b  4cb4256 → 1234567  (production)

      2 migration(s) on disk"
    `);
  });

  it('renders branching with repeated source hashes', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260601T1200_branch_a',
                from: HASH_A,
                to: HASH_B,
              }),
              migration({
                dirName: '20260518T1701_branch_b',
                from: HASH_A,
                to: HASH_C,
              }),
            ],
          },
        ],
        '2 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "* 20260601T1200_branch_a  abcdef0 → 1234567
      * 20260518T1701_branch_b  abcdef0 → 4cb4256

      2 migration(s) on disk"
    `);
  });

  it('renders multiple refs in one parens block', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260422T0742_migration',
                from: HASH_A,
                to: HASH_B,
                refs: ['production', 'staging', 'db'],
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "* 20260422T0742_migration  abcdef0 → 1234567  (production, staging, db)

      1 migration(s) on disk"
    `);
  });

  it('renders multiple invariants in one brace block', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260601T1200_backfill',
                from: HASH_D,
                to: HASH_D,
                providedInvariants: ['a', 'b'],
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "⟲ 20260601T1200_backfill  55bada2  {a, b}

      1 migration(s) on disk"
    `);
  });

  it('renders multi-space output with headings and indent', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260518T1701_namespaces_bookend',
                from: HASH_E,
                to: HASH_F,
                refs: ['db'],
              }),
              migration({
                dirName: '20260422T0720_initial',
                from: null,
                to: HASH_D,
              }),
            ],
          },
          {
            spaceId: 'postgis',
            migrations: [
              migration({
                dirName: '20260601T0000_install_postgis_extension',
                from: null,
                to: 'sha256:9aabbcc123456789012345678901234567890123456789012',
              }),
            ],
          },
        ],
        '3 migration(s) across 2 contract space(s)',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "app:
        * 20260518T1701_namespaces_bookend  2f45cc7 → 804e018  (db)
        * 20260422T0720_initial             ∅       → 55bada2

      postgis:
        * 20260601T0000_install_postgis_extension  ∅       → 9aabbcc

      3 migration(s) across 2 contract space(s)"
    `);
  });

  it('suppresses heading for single-space output', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260422T0742_migration',
                from: HASH_A,
                to: HASH_B,
                refs: ['production'],
              }),
            ],
          },
        ],
        '1 migration(s) on disk',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "* 20260422T0742_migration  abcdef0 → 1234567  (production)

      1 migration(s) on disk"
    `);
  });

  it('renders empty state for single space', () => {
    const output = renderListed(
      result([{ spaceId: 'app', migrations: [] }], '0 migration(s) on disk'),
    );
    expect(output).toMatchInlineSnapshot(`"There are no migrations in migrations/app/ yet"`);
  });

  it('renders the slice-spec worked example byte-for-byte', () => {
    const output = renderListed(
      result(
        [
          {
            spaceId: 'app',
            migrations: [
              migration({
                dirName: '20260601T1200_backfill_emails',
                from: HASH_D,
                to: HASH_D,
                providedInvariants: ['backfill_emails_v1'],
                refs: ['production'],
              }),
              migration({
                dirName: '20260518T1701_namespaces_bookend',
                from: HASH_E,
                to: HASH_F,
                refs: ['db'],
              }),
              migration({
                dirName: '20260422T0748_migration',
                from: HASH_D,
                to: HASH_E,
                refs: ['staging'],
              }),
              migration({
                dirName: '20260422T0742_migration',
                from: HASH_C,
                to: HASH_D,
                refs: ['production'],
              }),
              migration({
                dirName: '20260422T0720_initial',
                from: null,
                to: HASH_C,
              }),
            ],
          },
        ],
        '5 migration(s) on disk',
      ),
    );
    const expected =
      '⟲ 20260601T1200_backfill_emails     55bada2  {backfill_emails_v1} (production)\n' +
      '* 20260518T1701_namespaces_bookend  2f45cc7 → 804e018  (db)\n' +
      '* 20260422T0748_migration           55bada2 → 2f45cc7  (staging)\n' +
      '* 20260422T0742_migration           4cb4256 → 55bada2  (production)\n' +
      '* 20260422T0720_initial             ∅       → 4cb4256\n' +
      '\n' +
      '5 migration(s) on disk';
    expect(output).toBe(expected);
  });

  it('renders empty state for multi-space with per-space headings', () => {
    const output = renderListed(
      result(
        [
          { spaceId: 'app', migrations: [] },
          { spaceId: 'postgis', migrations: [] },
        ],
        '0 migration(s) across 2 contract space(s)',
      ),
    );
    expect(output).toMatchInlineSnapshot(`
      "app:
        There are no migrations in migrations/app/ yet

      postgis:
        There are no migrations in migrations/postgis/ yet"
    `);
  });
});
