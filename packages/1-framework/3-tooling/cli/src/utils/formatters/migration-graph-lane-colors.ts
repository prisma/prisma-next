import { createColors } from 'colorette';

export type LaneColorizer = (text: string) => string;

const { magenta, cyan, green, yellow, blueBright, red } = createColors({ useColor: true });

export const LANE_COLOR_CYCLE: readonly LaneColorizer[] = [
  magenta,
  cyan,
  green,
  yellow,
  blueBright,
  red,
];

/**
 * The hue for a gutter column. The leftmost lane (column 0) is **neutral** — it
 * has nothing to be told apart from in the common single-lane linear case, so
 * the renderer dims it rather than tinting it; the rotating palette is reserved
 * for columns ≥ 1 (where a second lane exists to distinguish). Callers must dim
 * column 0 themselves; this returns identity for it as a guard. A lane freed and
 * reused by a later branch keeps its column's hue — coloring is by position, not
 * branch identity, exactly like `git log --graph`.
 */
export function laneColorForColumn(column: number): LaneColorizer {
  if (column <= 0) {
    return (text) => text;
  }
  const colorizer = LANE_COLOR_CYCLE[(column - 1) % LANE_COLOR_CYCLE.length];
  return colorizer ?? ((text) => text);
}
