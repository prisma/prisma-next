import type {
  MigrationListEntry,
  MigrationListResult,
  MigrationSpaceListEntry,
} from '@prisma-next/migration-tools/migration-list-types';
import { bold, cyan, cyanBright, dim, green, greenBright, yellow } from 'colorette';
import { describe, expect, it } from 'vitest';
import { buildKindByMigrationHash } from '../../../src/commands/migration-list';
import {
  IDENTITY_MIGRATION_LIST_STYLER,
  renderMigrationList,
  renderMigrationListWithStyle,
} from '../../../src/utils/formatters/migration-list-render';
import { createAnsiMigrationListStyler } from '../../../src/utils/formatters/migration-list-styler';

const HASH_C = 'sha256:4cb4256c30b7a8123456789012345678901234567890123456';
const HASH_D = 'sha256:55bada2f123456789012345678901234567890123456789012';

let migrationHashSeq = 0;

function migration(
  overrides: Pick<MigrationListEntry, 'dirName' | 'to'> &
    Partial<Omit<MigrationListEntry, 'dirName' | 'to'>>,
): MigrationListEntry {
  return {
    from: null,
    migrationHash: overrides.migrationHash ?? `sha256:styler-mig-${migrationHashSeq++}`,
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

describe('createAnsiMigrationListStyler', () => {
  it('returns an identity styler when useColor is false (suppresses ANSI for non-TTY / --no-color)', () => {
    const styler = createAnsiMigrationListStyler({ useColor: false });
    expect(styler.kind('*')).toBe('*');
    expect(styler.kind('↩')).toBe('↩');
    expect(styler.kind('⟲')).toBe('⟲');
    expect(styler.dirName('20260422T0720_initial')).toBe('20260422T0720_initial');
    expect(styler.sourceHash('4cb4256')).toBe('4cb4256');
    expect(styler.destHash('55bada2')).toBe('55bada2');
    expect(styler.glyph('→')).toBe('→');
    expect(styler.glyph('⟲')).toBe('⟲');
    expect(styler.glyph('∅')).toBe('∅');
    expect(styler.invariants(['a', 'b'])).toBe('{a, b}');
    expect(styler.refs(['production', 'staging'])).toBe('(production, staging)');
    expect(styler.refs(['db'])).toBe('(db)');
    expect(styler.spaceHeading('app:')).toBe('app:');
    expect(styler.summary('1 migration(s) on disk')).toBe('1 migration(s) on disk');
    expect(styler.emptyState('There are no migrations in migrations/app/ yet')).toBe(
      'There are no migrations in migrations/app/ yet',
    );
  });

  it('renders an identity-equivalent output when wired through renderMigrationListWithStyle', () => {
    const r = result(
      [
        {
          spaceId: 'app',
          migrations: [
            migration({
              dirName: '20260422T0720_initial',
              from: null,
              to: HASH_C,
            }),
          ],
        },
      ],
      '1 migration(s) on disk',
    );
    const kinds = buildKindByMigrationHash(r.spaces);
    const styled = renderMigrationListWithStyle(
      r,
      createAnsiMigrationListStyler({ useColor: false }),
      kinds,
    );
    expect(styled).toBe(renderMigrationList(r, kinds));
  });

  it('wraps each token with the expected SGR style when useColor is true', () => {
    const styler = createAnsiMigrationListStyler({ useColor: true });
    expect(styler.kind('*')).toBe(dim('*'));
    expect(styler.kind('↩')).toBe(dim('↩'));
    expect(styler.kind('⟲')).toBe(dim('⟲'));
    expect(styler.dirName('20260422T0720_initial')).toBe(bold('20260422T0720_initial'));
    expect(styler.sourceHash('4cb4256')).toBe(dim(cyan('4cb4256')));
    expect(styler.destHash('55bada2')).toBe(cyanBright('55bada2'));
    expect(styler.glyph('→')).toBe(dim('→'));
    expect(styler.glyph('⟲')).toBe(dim('⟲'));
    expect(styler.glyph('∅')).toBe(dim('∅'));
    expect(styler.invariants(['backfill_emails_v1'])).toBe(yellow('{backfill_emails_v1}'));
    expect(styler.spaceHeading('app:')).toBe(bold('app:'));
    expect(styler.summary('1 migration(s) on disk')).toBe(dim('1 migration(s) on disk'));
    expect(styler.emptyState('There are no migrations in migrations/app/ yet')).toBe(
      dim('There are no migrations in migrations/app/ yet'),
    );
  });

  it('renders user refs in green and the live-state `db` marker in green-bold', () => {
    const styler = createAnsiMigrationListStyler({ useColor: true });
    expect(styler.refs(['production'])).toBe(green('(') + green('production') + green(')'));
    expect(styler.refs(['production', 'staging'])).toBe(
      green('(') + [green('production'), green('staging')].join(green(', ')) + green(')'),
    );
    expect(styler.refs(['db'])).toBe(green('(') + bold(greenBright('db')) + green(')'));
    expect(styler.refs(['production', 'db'])).toBe(
      green('(') + [green('production'), bold(greenBright('db'))].join(green(', ')) + green(')'),
    );
  });
});

describe('renderMigrationListWithStyle', () => {
  it('places SGR codes around the expected tokens in a self-edge worked example', () => {
    const r = result(
      [
        {
          spaceId: 'app',
          migrations: [
            migration({
              dirName: '20260601T1200_backfill_emails',
              from: HASH_D,
              to: HASH_D,
              providedInvariants: ['backfill_emails_v1'],
              refs: ['production', 'db'],
            }),
          ],
        },
      ],
      '1 migration(s) on disk',
    );
    const kinds = buildKindByMigrationHash(r.spaces);
    const styled = renderMigrationListWithStyle(
      r,
      createAnsiMigrationListStyler({ useColor: true }),
      kinds,
    );
    const expectedRow =
      `${dim('⟲')} ${bold('20260601T1200_backfill_emails')}  ` +
      `${dim(cyan('55bada2'))}` +
      `  ${yellow('{backfill_emails_v1}')} ` +
      `${green('(') + [green('production'), bold(greenBright('db'))].join(green(', ')) + green(')')}`;
    const expected = `${expectedRow}\n\n${dim('1 migration(s) on disk')}`;
    expect(styled).toBe(expected);
  });

  it('styles the multi-space heading and per-space rows with the correct palette', () => {
    const r = result(
      [
        {
          spaceId: 'app',
          migrations: [
            migration({
              dirName: '20260422T0720_initial',
              from: null,
              to: HASH_C,
            }),
          ],
        },
        {
          spaceId: 'postgis',
          migrations: [],
        },
      ],
      '1 migration(s) across 2 contract space(s)',
    );
    const kinds = buildKindByMigrationHash(r.spaces);
    const styled = renderMigrationListWithStyle(
      r,
      createAnsiMigrationListStyler({ useColor: true }),
      kinds,
    );
    expect(styled).toContain(bold('app:'));
    expect(styled).toContain(bold('postgis:'));
    expect(styled).toContain(`${dim('∅')}      `);
    expect(styled).toContain(cyanBright('4cb4256'));
    expect(styled).toContain(dim('→'));
    expect(styled).toContain(dim('1 migration(s) across 2 contract space(s)'));
    expect(styled).toContain(dim('There are no migrations in migrations/postgis/ yet'));
  });

  it('preserves visual column widths (padding is unstyled spaces)', () => {
    const r = result(
      [
        {
          spaceId: 'app',
          migrations: [
            migration({
              dirName: '20260422T0720_initial',
              from: null,
              to: HASH_C,
            }),
            migration({
              dirName: '20260601T1200_latest',
              from: HASH_C,
              to: HASH_D,
            }),
          ],
        },
      ],
      '2 migration(s) on disk',
    );
    const kinds = buildKindByMigrationHash(r.spaces);
    const plain = renderMigrationList(r, kinds);
    const styled = renderMigrationListWithStyle(
      r,
      createAnsiMigrationListStyler({ useColor: true }),
      kinds,
    );

    function stripAnsi(s: string): string {
      return s.replace(
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI SGR sequences
        /\u001b\[[0-9;]*m/g,
        '',
      );
    }
    expect(stripAnsi(styled)).toBe(plain);
  });
});

describe('IDENTITY_MIGRATION_LIST_STYLER', () => {
  it('is what renderMigrationList uses (pure-text path equivalence)', () => {
    const r = result(
      [
        {
          spaceId: 'app',
          migrations: [
            migration({
              dirName: '20260422T0720_initial',
              from: null,
              to: HASH_C,
            }),
          ],
        },
      ],
      '1 migration(s) on disk',
    );
    const kinds = buildKindByMigrationHash(r.spaces);
    expect(renderMigrationList(r, kinds)).toBe(
      renderMigrationListWithStyle(r, IDENTITY_MIGRATION_LIST_STYLER, kinds),
    );
  });
});
