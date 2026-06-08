/**
 * Goldens for layout bugs — asserted via `it.fails` until fixed, then moved
 * to the normal GOLDENS list in gallery-goldens.ts.
 *
 * Both bugs (disconnected-component interleave; asymmetric diamond) are fixed.
 * The goldens have been moved to gallery-goldens.ts.
 */

import type { ScenarioGolden } from './gallery-goldens';

export const KNOWN_BROKEN_GOLDENS: readonly ScenarioGolden[] = [];
