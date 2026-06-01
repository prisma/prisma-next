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

export function laneColorForColumn(column: number): LaneColorizer {
  const colorizer = LANE_COLOR_CYCLE[column % LANE_COLOR_CYCLE.length];
  return colorizer ?? ((text) => text);
}
