import { createColors } from 'colorette';
import type { StructuralCell } from './migration-graph-layout';

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
 * The leftmost lane (column 0) renders neutral — no palette hue. Columns ≥ 1
 * rotate through {@link LANE_COLOR_CYCLE}.
 */
export const NEUTRAL_LANE_COLUMN = 0;

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
  if (column <= NEUTRAL_LANE_COLUMN) {
    return (text) => text;
  }
  const colorizer = LANE_COLOR_CYCLE[(column - 1) % LANE_COLOR_CYCLE.length];
  return colorizer ?? ((text) => text);
}

/**
 * Style a structural glyph by its resolved colour column. Column 0 and the
 * neutral sentinel render dim (`dimLane`); columns ≥ 1 take a palette hue.
 */
export function stylerForLaneColumn(
  colorColumn: number,
  colorize: boolean,
  dimLane: (text: string) => string,
): LaneColorizer {
  if (!colorize || colorColumn <= NEUTRAL_LANE_COLUMN) {
    return dimLane;
  }
  return laneColorForColumn(colorColumn);
}

/**
 * The colour-source column for each cell of a row, resolved together because a
 * routed back-arc spans columns and must read as **one hue** rather than a
 * per-column "rainbow".
 */
export interface RowArcLaneColors {
  /** Colour column for a cell's structural glyph (lane / spine / arc body). */
  readonly lane: readonly number[];
  /** Colour column for a node arc-pair's connector half (`◂` / `─`). */
  readonly connector: readonly number[];
  /**
   * Colour column for the trailing `─` of a landing tee (`┴─`). The junction
   * (`lane`) keeps its own column; the dash leads into the next converging arc.
   */
  readonly dash: readonly number[];
}

/**
 * Resolve per-cell colour columns for a node/arc row. Scanning right-to-left
 * lets each arc segment inherit the hue of the arc it leads into.
 */
export function resolveRowArcLaneColors(cells: readonly StructuralCell[]): RowArcLaneColors {
  const lane = new Array<number>(cells.length);
  const connector = new Array<number>(cells.length);
  const dash = new Array<number>(cells.length);
  let arcCorner = NEUTRAL_LANE_COLUMN;
  let landingAnchor = NEUTRAL_LANE_COLUMN;
  for (let column = cells.length - 1; column >= 0; column--) {
    const cell = cells[column];
    connector[column] = landingAnchor !== NEUTRAL_LANE_COLUMN ? landingAnchor : arcCorner;
    switch (cell?.kind) {
      case 'arc-branch-corner':
        arcCorner = column;
        lane[column] = column;
        dash[column] = column;
        break;
      case 'arc-land-corner':
        arcCorner = column;
        landingAnchor = column;
        lane[column] = column;
        dash[column] = column;
        break;
      case 'arc-branch-tee':
        lane[column] = column;
        dash[column] = column;
        break;
      case 'arc-land-tee':
        lane[column] = column;
        dash[column] = landingAnchor === NEUTRAL_LANE_COLUMN ? column : landingAnchor;
        landingAnchor = column;
        break;
      case 'arc-crossing':
      case 'arc-land-bridge': {
        const served = landingAnchor !== NEUTRAL_LANE_COLUMN ? landingAnchor : arcCorner;
        lane[column] = served;
        dash[column] = served;
        break;
      }
      case 'horizontal-pass':
        lane[column] = arcCorner === NEUTRAL_LANE_COLUMN ? column : arcCorner;
        dash[column] = lane[column] ?? column;
        break;
      case 'node':
        lane[column] = column;
        dash[column] = column;
        arcCorner = NEUTRAL_LANE_COLUMN;
        landingAnchor = NEUTRAL_LANE_COLUMN;
        break;
      default:
        lane[column] = column;
        dash[column] = column;
        arcCorner = NEUTRAL_LANE_COLUMN;
        landingAnchor = NEUTRAL_LANE_COLUMN;
    }
  }
  return { lane, connector, dash };
}

/**
 * Per-cell colour for a forward branch/merge connector row, split into the
 * cell's junction `glyph` and its trailing `dash`.
 */
export interface ConnectorLaneColors {
  /** Colour column for a cell's junction glyph (`├` / `┬` / `┴` / `╮` / `╯`). */
  readonly glyph: readonly number[];
  /** Colour column for a tee's trailing `─` — the branch it leads into. */
  readonly dash: readonly number[];
}

/**
 * Resolve per-cell connector colours. Scanning right-to-left, a corner or an
 * intermediate tee anchors its own lane, but a tee's trailing dash leads into
 * the branch on its right.
 */
export function resolveConnectorLaneColors(
  cells: readonly StructuralCell[],
  startLane: number,
): ConnectorLaneColors {
  const glyph = new Array<number>(cells.length);
  const dash = new Array<number>(cells.length);
  let owner = NEUTRAL_LANE_COLUMN;
  for (let column = cells.length - 1; column >= 0; column--) {
    const cell = cells[column];
    switch (cell?.kind) {
      case 'branch-corner':
      case 'merge-corner':
        owner = column;
        glyph[column] = column;
        dash[column] = column;
        break;
      case 'branch-tee':
      case 'merge-tee':
        if (column === startLane) {
          const served = owner === NEUTRAL_LANE_COLUMN ? column : owner;
          glyph[column] = column;
          dash[column] = served;
        } else {
          dash[column] = owner === NEUTRAL_LANE_COLUMN ? column : owner;
          glyph[column] = column;
          owner = column;
        }
        break;
      case 'arc-crossing':
        glyph[column] = column;
        dash[column] = owner === NEUTRAL_LANE_COLUMN ? column : owner;
        owner = column;
        break;
      case 'horizontal-pass': {
        const served = owner === NEUTRAL_LANE_COLUMN ? column : owner;
        glyph[column] = served;
        dash[column] = served;
        break;
      }
      default:
        glyph[column] = column;
        dash[column] = column;
    }
  }
  return { glyph, dash };
}
