/**
 * Scenario gallery snapshots — verbatim ANSI output for every scenario/variant.
 *
 * Two structural invariants are asserted: no legacy tee glyphs (├ ┬ ┴ ┼); and
 * focus variants carry both on-path green (`\x1b[92m`) and off-path dim (`\x1b[2m`).
 *
 * Never run `vitest --update-snapshots` blindly — always `pnpm gallery` first.
 */

import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import {
  renderScenario,
  SCENARIOS,
  type Scenario,
  type ScenarioVariant,
} from './migration-graph-scenario-gallery';

const GREEN_BRIGHT = '\x1b[92m'; // on-path colour
const DIM = '\x1b[2m'; // off-path colour

function variantKey(scenario: Scenario, variant: ScenarioVariant): string {
  return `${scenario.name}:${variant.name}`;
}

function safeRender(scenario: Scenario, variant: ScenarioVariant): string | null {
  try {
    return renderScenario(scenario, variant);
  } catch {
    return null;
  }
}

/** A focus variant whose on-path set splits the graph (some on, some off). */
function isMixedFocusVariant(scenario: Scenario, variant: ScenarioVariant): boolean {
  if (variant.onPathHashes === undefined) return false;
  const allHashes = new Set(scenario.edges.map((e) => e.migrationHash));
  const onPath = variant.onPathHashes;
  if (onPath.size === 0 || onPath.size >= allHashes.size) return false;
  // At least one edge off-path.
  return scenario.edges.some((e) => !onPath.has(e.migrationHash));
}

describe('migration-graph scenario gallery', () => {
  // =========================================================================
  // Verbatim ANSI snapshots — every scenario/variant
  // =========================================================================
  describe('verbatim ANSI snapshots', () => {
    for (const scenario of SCENARIOS) {
      describe(scenario.name, () => {
        for (const variant of scenario.variants) {
          const key = variantKey(scenario, variant);
          it(key, () => {
            const rendered = safeRender(scenario, variant);
            expect(rendered, `renderer must produce output for ${key}`).not.toBeNull();
            expect(rendered).toMatchSnapshot();
          });
        }
      });
    }
  });

  // =========================================================================
  // Corner alphabet only — never legacy tees.
  // =========================================================================
  describe('corner alphabet (no tees)', () => {
    for (const scenario of SCENARIOS) {
      for (const variant of scenario.variants) {
        const key = variantKey(scenario, variant);
        it(key, () => {
          const rendered = safeRender(scenario, variant);
          if (rendered === null) return;
          expect(stripAnsi(rendered)).not.toMatch(/[├┬┴┼]/u);
        });
      }
    }
  });

  // =========================================================================
  // Focus variants carry both on-path green and off-path dim.
  // =========================================================================
  describe('focus colours present', () => {
    for (const scenario of SCENARIOS) {
      for (const variant of scenario.variants) {
        if (!isMixedFocusVariant(scenario, variant)) continue;
        const key = variantKey(scenario, variant);
        it(key, () => {
          const rendered = safeRender(scenario, variant);
          if (rendered === null) return;
          expect(rendered, `${key}: on-path green present`).toContain(GREEN_BRIGHT);
          expect(rendered, `${key}: off-path dim present`).toContain(DIM);
        });
      }
    }
  });
});
