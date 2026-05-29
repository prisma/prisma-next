import { describe, expect, it } from 'vitest';
import {
  detectGlyphMode,
  renderMigrationListGraph,
} from '../../../src/utils/formatters/migration-list-graph-render';
import {
  IDENTITY_MIGRATION_LIST_STYLER,
  renderMigrationListWithStyle,
} from '../../../src/utils/formatters/migration-list-render';
import { HASH, layoutFor, migrationEntry } from './migration-list-graph-fixtures';

function renderGraph(
  entries: readonly ReturnType<typeof migrationEntry>[],
  mode: 'unicode' | 'ascii',
) {
  return renderMigrationListGraph(layoutFor(entries), IDENTITY_MIGRATION_LIST_STYLER, mode);
}

function renderAscii(entries: readonly ReturnType<typeof migrationEntry>[]) {
  return renderGraph(entries, 'ascii');
}

describe('detectGlyphMode', () => {
  it('returns ascii when stdout is not a TTY', () => {
    expect(detectGlyphMode({ isTTY: false, env: { LANG: 'en_US.UTF-8' } })).toBe('ascii');
  });

  it('returns ascii when LANG is unset', () => {
    expect(detectGlyphMode({ isTTY: true, env: {} })).toBe('ascii');
  });

  it('returns ascii when locale is not UTF-8', () => {
    expect(detectGlyphMode({ isTTY: true, env: { LANG: 'C' } })).toBe('ascii');
  });

  it('returns unicode on a UTF-8 TTY', () => {
    expect(detectGlyphMode({ isTTY: true, env: { LANG: 'en_US.UTF-8' } })).toBe('unicode');
  });

  it('prefers LC_ALL over LANG', () => {
    expect(detectGlyphMode({ isTTY: true, env: { LANG: 'C', LC_ALL: 'en_US.UTF-8' } })).toBe(
      'unicode',
    );
  });
});

function golden(entries: readonly ReturnType<typeof migrationEntry>[]) {
  return renderGraph(entries, 'unicode');
}

describe('renderMigrationListGraph', () => {
  it('matches flat list byte-for-byte on linear forward history', () => {
    const entries = [
      migrationEntry('20250310_add_comments', HASH.seven1b, HASH.f03da82),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.seven1b),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    const listResult = {
      ok: true as const,
      spaces: [{ spaceId: 'app', migrations: entries }],
      summary: '3 migration(s) on disk',
    };
    const flat = renderMigrationListWithStyle(listResult, IDENTITY_MIGRATION_LIST_STYLER);
    const flatRows = flat.split('\n').slice(0, 3).join('\n');
    expect(renderGraph(entries, 'unicode')).toBe(flatRows);
  });

  it('renders linear chain in unicode', () => {
    const entries = [
      migrationEntry('20250310_add_comments', HASH.seven1b, HASH.f03da82),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.seven1b),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(golden(entries)).toBe(
      '* 20250310_add_comments  7e1b9a0 → f03da82\n' +
        '* 20250203_add_posts     abc1234 → 7e1b9a0\n' +
        '* 20250115_add_users     ∅       → abc1234',
    );
  });

  it('renders diamond in unicode', () => {
    const entries = [
      migrationEntry('20250302_merge_tags', HASH.nine4f1, HASH.d41a8c3),
      migrationEntry('20250301_merge_posts', HASH.seven1b, HASH.d41a8c3),
      migrationEntry('20250210_add_tags', HASH.abc1234, HASH.nine4f1),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.seven1b),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      'o     d41a8c3\n' +
        '├─┐\n' +
        '* │   20250302_merge_tags   9c4f1e7 → d41a8c3\n' +
        '│ *   20250301_merge_posts  7e1b9a0 → d41a8c3\n' +
        '* │   20250210_add_tags     abc1234 → 9c4f1e7\n' +
        '│ *   20250203_add_posts    abc1234 → 7e1b9a0\n' +
        '├─┘\n' +
        '*     20250115_add_users    ∅       → abc1234',
    );
  });

  it('renders octopus in unicode', () => {
    const entries = [
      migrationEntry('20250310_merge_a', HASH.a1b2c3d, HASH.d41a8c3),
      migrationEntry('20250309_merge_b', HASH.b1c2d3e, HASH.d41a8c3),
      migrationEntry('20250308_merge_c', HASH.c1d2e3f, HASH.d41a8c3),
      migrationEntry('20250304_branch_a', HASH.fourcb4, HASH.a1b2c3d),
      migrationEntry('20250303_branch_b', HASH.fourcb4, HASH.b1c2d3e),
      migrationEntry('20250302_branch_c', HASH.fourcb4, HASH.c1d2e3f),
      migrationEntry('20250115_add_base', null, HASH.fourcb4),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      'o       d41a8c3\n' +
        '├─┬─┐\n' +
        '* │ │   20250310_merge_a   a1b2c3d → d41a8c3\n' +
        '│ * │   20250309_merge_b   b1c2d3e → d41a8c3\n' +
        '│ │ *   20250308_merge_c   c1d2e3f → d41a8c3\n' +
        '* │ │   20250304_branch_a  4cb4256 → a1b2c3d\n' +
        '│ * │   20250303_branch_b  4cb4256 → b1c2d3e\n' +
        '│ │ *   20250302_branch_c  4cb4256 → c1d2e3f\n' +
        '└─┴─┘\n' +
        '*       20250115_add_base  ∅       → 4cb4256',
    );
  });

  it('renders parallel edges in unicode', () => {
    const entries = [
      migrationEntry('20250203_add_posts_v2', HASH.abc1234, HASH.def5678),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.def5678),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      'o     def5678\n' +
        '├─┐\n' +
        '* │   20250203_add_posts_v2  abc1234 → def5678\n' +
        '│ *   20250203_add_posts     abc1234 → def5678\n' +
        '├─┘\n' +
        '*     20250115_add_users     ∅       → abc1234',
    );
  });

  it('renders convergence and divergence in unicode', () => {
    const entries = [
      migrationEntry('20250320_add_x', HASH.d41a8c3, HASH.e1f2a3b),
      migrationEntry('20250319_add_y', HASH.d41a8c3, HASH.c4d5e6f),
      migrationEntry('20250310_merge_a', HASH.a1b2c3d, HASH.d41a8c3),
      migrationEntry('20250309_merge_b', HASH.b1c2d3e, HASH.d41a8c3),
      migrationEntry('20250304_branch_a', HASH.fourcb4, HASH.a1b2c3d),
      migrationEntry('20250303_branch_b', HASH.fourcb4, HASH.b1c2d3e),
      migrationEntry('20250115_add_base', null, HASH.fourcb4),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      '*     20250320_add_x     d41a8c3 → e1f2a3b\n' +
        '│ *   20250319_add_y     d41a8c3 → c4d5e6f\n' +
        '├─┘\n' +
        'o     d41a8c3\n' +
        '├─┐\n' +
        '* │   20250310_merge_a   a1b2c3d → d41a8c3\n' +
        '│ *   20250309_merge_b   b1c2d3e → d41a8c3\n' +
        '* │   20250304_branch_a  4cb4256 → a1b2c3d\n' +
        '│ *   20250303_branch_b  4cb4256 → b1c2d3e\n' +
        '├─┘\n' +
        '*     20250115_add_base  ∅       → 4cb4256',
    );
  });

  it('renders multi-hop rollback in unicode', () => {
    const entries = [
      migrationEntry('20250312_full_rollback', HASH.ghi7890, HASH.abc1234),
      migrationEntry('20250310_add_comments', HASH.def5678, HASH.ghi7890),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.def5678),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      '↩ 20250312_full_rollback  ghi7890 → abc1234\n' +
        '* 20250310_add_comments   def5678 → ghi7890\n' +
        '* 20250203_add_posts      abc1234 → def5678\n' +
        '* 20250115_add_users      ∅       → abc1234',
    );
  });

  it('renders partial rollback in unicode', () => {
    const entries = [
      migrationEntry('20250320_add_likes', HASH.def5678, HASH.jkl1234),
      migrationEntry('20250312_rollback_comments', HASH.ghi7890, HASH.def5678),
      migrationEntry('20250310_add_comments', HASH.def5678, HASH.ghi7890),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.def5678),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      '*     20250320_add_likes          def5678 → jkl1234\n' +
        '│ ↩   20250312_rollback_comments  ghi7890 → def5678\n' +
        '│ *   20250310_add_comments       def5678 → ghi7890\n' +
        '├─┘\n' +
        '*     20250203_add_posts          abc1234 → def5678\n' +
        '*     20250115_add_users          ∅       → abc1234',
    );
  });

  it('renders multiple forward roots in unicode', () => {
    const entries = [
      migrationEntry('20250302_branch', HASH.mid, HASH.tip),
      migrationEntry('20250301_other', HASH.rootA, HASH.rootB),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      '*     20250302_branch  mid0000 → tip0000\n' + '│ *   20250301_other   root00a → root00b',
    );
  });

  it('renders self-edge nested in branch in unicode', () => {
    const entries = [
      migrationEntry('20250320_add_likes', HASH.def5678, HASH.jkl1234),
      migrationEntry('20250315_touch_schema', HASH.def5678, HASH.def5678),
      migrationEntry('20250310_add_comments', HASH.def5678, HASH.ghi7890),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.def5678),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      '*     20250320_add_likes     def5678 → jkl1234\n' +
        '│ ⟲   20250315_touch_schema  def5678\n' +
        '│ *   20250310_add_comments  def5678 → ghi7890\n' +
        '├─┘\n' +
        '*     20250203_add_posts     abc1234 → def5678\n' +
        '*     20250115_add_users     ∅       → abc1234',
    );
  });

  it('passes producer lanes through unrelated row in unicode', () => {
    const entries = [
      migrationEntry('20250302_merge_tags', HASH.nine4f1, HASH.d41a8c3),
      migrationEntry('20250301_merge_posts', HASH.seven1b, HASH.d41a8c3),
      migrationEntry('20250220_unrelated', HASH.hashfeed, HASH.hashdead),
      migrationEntry('20250210_add_tags', HASH.abc1234, HASH.nine4f1),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.seven1b),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderGraph(entries, 'unicode')).toBe(
      'o       d41a8c3\n' +
        '├─┐  \n' +
        '* │     20250302_merge_tags   9c4f1e7 → d41a8c3\n' +
        '│ *     20250301_merge_posts  7e1b9a0 → d41a8c3\n' +
        '│ │ *   20250220_unrelated    feed000 → dead000\n' +
        '* │ │   20250210_add_tags     abc1234 → 9c4f1e7\n' +
        '│ * │   20250203_add_posts    abc1234 → 7e1b9a0\n' +
        '├─┘ │ \n' +
        '*   │   20250115_add_users    ∅       → abc1234',
    );
  });

  it('renders linear chain in ascii', () => {
    const entries = [
      migrationEntry('20250310_add_comments', HASH.seven1b, HASH.f03da82),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.seven1b),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderAscii(entries)).toBe(
      '* 20250310_add_comments  7e1b9a0 -> f03da82\n' +
        '* 20250203_add_posts     abc1234 -> 7e1b9a0\n' +
        '* 20250115_add_users     -       -> abc1234',
    );
  });

  it('renders diamond in ascii', () => {
    const entries = [
      migrationEntry('20250302_merge_tags', HASH.nine4f1, HASH.d41a8c3),
      migrationEntry('20250301_merge_posts', HASH.seven1b, HASH.d41a8c3),
      migrationEntry('20250210_add_tags', HASH.abc1234, HASH.nine4f1),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.seven1b),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderAscii(entries)).toBe(
      'o     d41a8c3\n' +
        '+-\\\n' +
        '* |   20250302_merge_tags   9c4f1e7 -> d41a8c3\n' +
        '| *   20250301_merge_posts  7e1b9a0 -> d41a8c3\n' +
        '* |   20250210_add_tags     abc1234 -> 9c4f1e7\n' +
        '| *   20250203_add_posts    abc1234 -> 7e1b9a0\n' +
        '+-/\n' +
        '*     20250115_add_users    -       -> abc1234',
    );
  });

  it('renders octopus in ascii', () => {
    const entries = [
      migrationEntry('20250310_merge_a', HASH.a1b2c3d, HASH.d41a8c3),
      migrationEntry('20250309_merge_b', HASH.b1c2d3e, HASH.d41a8c3),
      migrationEntry('20250308_merge_c', HASH.c1d2e3f, HASH.d41a8c3),
      migrationEntry('20250304_branch_a', HASH.fourcb4, HASH.a1b2c3d),
      migrationEntry('20250303_branch_b', HASH.fourcb4, HASH.b1c2d3e),
      migrationEntry('20250302_branch_c', HASH.fourcb4, HASH.c1d2e3f),
      migrationEntry('20250115_add_base', null, HASH.fourcb4),
    ];
    expect(renderAscii(entries)).toBe(
      'o       d41a8c3\n' +
        '+-|-\\\n' +
        '* | |   20250310_merge_a   a1b2c3d -> d41a8c3\n' +
        '| * |   20250309_merge_b   b1c2d3e -> d41a8c3\n' +
        '| | *   20250308_merge_c   c1d2e3f -> d41a8c3\n' +
        '* | |   20250304_branch_a  4cb4256 -> a1b2c3d\n' +
        '| * |   20250303_branch_b  4cb4256 -> b1c2d3e\n' +
        '| | *   20250302_branch_c  4cb4256 -> c1d2e3f\n' +
        '/-+-/\n' +
        '*       20250115_add_base  -       -> 4cb4256',
    );
  });

  it('renders parallel edges in ascii', () => {
    const entries = [
      migrationEntry('20250203_add_posts_v2', HASH.abc1234, HASH.def5678),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.def5678),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderAscii(entries)).toBe(
      'o     def5678\n' +
        '+-\\\n' +
        '* |   20250203_add_posts_v2  abc1234 -> def5678\n' +
        '| *   20250203_add_posts     abc1234 -> def5678\n' +
        '+-/\n' +
        '*     20250115_add_users     -       -> abc1234',
    );
  });

  it('renders convergence and divergence in ascii', () => {
    const entries = [
      migrationEntry('20250320_add_x', HASH.d41a8c3, HASH.e1f2a3b),
      migrationEntry('20250319_add_y', HASH.d41a8c3, HASH.c4d5e6f),
      migrationEntry('20250310_merge_a', HASH.a1b2c3d, HASH.d41a8c3),
      migrationEntry('20250309_merge_b', HASH.b1c2d3e, HASH.d41a8c3),
      migrationEntry('20250304_branch_a', HASH.fourcb4, HASH.a1b2c3d),
      migrationEntry('20250303_branch_b', HASH.fourcb4, HASH.b1c2d3e),
      migrationEntry('20250115_add_base', null, HASH.fourcb4),
    ];
    expect(renderAscii(entries)).toBe(
      '*     20250320_add_x     d41a8c3 -> e1f2a3b\n' +
        '| *   20250319_add_y     d41a8c3 -> c4d5e6f\n' +
        '+-/\n' +
        'o     d41a8c3\n' +
        '+-\\\n' +
        '* |   20250310_merge_a   a1b2c3d -> d41a8c3\n' +
        '| *   20250309_merge_b   b1c2d3e -> d41a8c3\n' +
        '* |   20250304_branch_a  4cb4256 -> a1b2c3d\n' +
        '| *   20250303_branch_b  4cb4256 -> b1c2d3e\n' +
        '+-/\n' +
        '*     20250115_add_base  -       -> 4cb4256',
    );
  });

  it('renders multi-hop rollback in ascii', () => {
    const entries = [
      migrationEntry('20250312_full_rollback', HASH.ghi7890, HASH.abc1234),
      migrationEntry('20250310_add_comments', HASH.def5678, HASH.ghi7890),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.def5678),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderAscii(entries)).toBe(
      '< 20250312_full_rollback  ghi7890 -> abc1234\n' +
        '* 20250310_add_comments   def5678 -> ghi7890\n' +
        '* 20250203_add_posts      abc1234 -> def5678\n' +
        '* 20250115_add_users      -       -> abc1234',
    );
  });

  it('renders partial rollback in ascii', () => {
    const entries = [
      migrationEntry('20250320_add_likes', HASH.def5678, HASH.jkl1234),
      migrationEntry('20250312_rollback_comments', HASH.ghi7890, HASH.def5678),
      migrationEntry('20250310_add_comments', HASH.def5678, HASH.ghi7890),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.def5678),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderAscii(entries)).toBe(
      '*     20250320_add_likes          def5678 -> jkl1234\n' +
        '| <   20250312_rollback_comments  ghi7890 -> def5678\n' +
        '| *   20250310_add_comments       def5678 -> ghi7890\n' +
        '+-/\n' +
        '*     20250203_add_posts          abc1234 -> def5678\n' +
        '*     20250115_add_users          -       -> abc1234',
    );
  });

  it('renders multiple forward roots in ascii', () => {
    const entries = [
      migrationEntry('20250302_branch', HASH.mid, HASH.tip),
      migrationEntry('20250301_other', HASH.rootA, HASH.rootB),
    ];
    expect(renderAscii(entries)).toBe(
      '*     20250302_branch  mid0000 -> tip0000\n' + '| *   20250301_other   root00a -> root00b',
    );
  });

  it('renders self-edge nested in branch in ascii', () => {
    const entries = [
      migrationEntry('20250320_add_likes', HASH.def5678, HASH.jkl1234),
      migrationEntry('20250315_touch_schema', HASH.def5678, HASH.def5678),
      migrationEntry('20250310_add_comments', HASH.def5678, HASH.ghi7890),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.def5678),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderAscii(entries)).toBe(
      '*     20250320_add_likes     def5678 -> jkl1234\n' +
        '| ~   20250315_touch_schema  def5678\n' +
        '| *   20250310_add_comments  def5678 -> ghi7890\n' +
        '+-/\n' +
        '*     20250203_add_posts     abc1234 -> def5678\n' +
        '*     20250115_add_users     -       -> abc1234',
    );
  });

  it('passes producer lanes through unrelated row in ascii', () => {
    const entries = [
      migrationEntry('20250302_merge_tags', HASH.nine4f1, HASH.d41a8c3),
      migrationEntry('20250301_merge_posts', HASH.seven1b, HASH.d41a8c3),
      migrationEntry('20250220_unrelated', HASH.hashfeed, HASH.hashdead),
      migrationEntry('20250210_add_tags', HASH.abc1234, HASH.nine4f1),
      migrationEntry('20250203_add_posts', HASH.abc1234, HASH.seven1b),
      migrationEntry('20250115_add_users', null, HASH.abc1234),
    ];
    expect(renderAscii(entries)).toBe(
      'o       d41a8c3\n' +
        '+-\\  \n' +
        '* |     20250302_merge_tags   9c4f1e7 -> d41a8c3\n' +
        '| *     20250301_merge_posts  7e1b9a0 -> d41a8c3\n' +
        '| | *   20250220_unrelated    feed000 -> dead000\n' +
        '* | |   20250210_add_tags     abc1234 -> 9c4f1e7\n' +
        '| * |   20250203_add_posts    abc1234 -> 7e1b9a0\n' +
        '+-/ | \n' +
        '*   |   20250115_add_users    -       -> abc1234',
    );
  });
});
