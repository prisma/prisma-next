/**
 * End-to-end tests for the PostGIS query examples.
 *
 * These tests run against the real PostgreSQL+PostGIS instance defined in
 * `docker-compose.yml`. Bring it up with `pnpm db:up` before running, or
 * the suite skips entirely.
 */

import { point, polygon } from '@prisma-next/extension-postgis/geojson';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { Runtime } from '@prisma-next/sql-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/prisma/db';
import {
  findCafesInBbox,
  findCafesInNeighborhood,
  findCafesNearPoint,
  findCafesWithinRadius,
  findNeighborhoodForPoint,
  findRoutesIntersecting,
} from '../src/queries';
import { cafes, neighborhoods, routes } from '../src/seed-data';
import { buildTestRuntime, isPostgisAvailable, resetTestDatabase } from './utils/test-database';

const context = db.context;
const { contract } = context;
const executionStack = db.stack;

const cafeBy = (name: string) => cafes.find((c) => c.name === name);
const hoodBy = (name: string) => neighborhoods.find((h) => h.name === name);

const SOMA = hoodBy('SoMa')!;
const MISSION = hoodBy('Mission')!;
const OUTER_SUNSET = hoodBy('Outer Sunset')!;
const SIGHTGLASS = cafeBy('Sightglass Coffee')!;
const ANDYTOWN = cafeBy('Andytown (Outer Sunset)')!;

describe.runIf(await isPostgisAvailable())('postgis e2e', () => {
  let runtime: Runtime;

  beforeAll(async () => {
    await resetTestDatabase(contract);
    runtime = await buildTestRuntime(executionStack, context);

    const builder = sql({ context });
    for (const cafe of cafes) {
      await runtime.execute(builder.cafe.insert(cafe).build());
    }
    for (const hood of neighborhoods) {
      await runtime.execute(builder.neighborhood.insert(hood).build());
    }
    for (const route of routes) {
      await runtime.execute(builder.route.insert(route).build());
    }
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await runtime?.close();
  });

  it('seed data round-trips Point/LineString/Polygon geometry intact', async () => {
    const builder = sql({ context });
    const cafeRows = await runtime.execute(builder.cafe.select('id', 'name', 'location').build());
    expect(cafeRows).toHaveLength(cafes.length);
    const sightglass = cafeRows.find((r) => r.id === SIGHTGLASS.id);
    expect(sightglass?.location).toEqual({
      type: 'Point',
      coordinates: [-122.4106, 37.7765],
      srid: 4326,
    });

    const hoodRows = await runtime.execute(
      builder.neighborhood.select('id', 'name', 'boundary').build(),
    );
    const soma = hoodRows.find((r) => r.id === SOMA.id);
    expect(soma?.boundary.type).toBe('Polygon');
    expect(soma?.boundary.srid).toBe(4326);

    const routeRows = await runtime.execute(builder.route.select('id', 'name', 'path').build());
    const market = routeRows.find((r) => r.name === 'Market Street stroll');
    expect(market?.path.type).toBe('LineString');
    expect(market?.path.coordinates).toEqual([
      [-122.4194, 37.7793],
      [-122.4106, 37.7857],
      [-122.4015, 37.7894],
    ]);
  });

  it('findCafesNearPoint orders by distanceSphere ascending and returns metres', async () => {
    const ferryBuilding = point(-122.3937, 37.7955, 4326);
    const rows = await findCafesNearPoint(ferryBuilding, 5, runtime);

    // Sightglass + Blue Bottle + Réveille are downtown — they should beat
    // the Mission + Sunset cafes on distance to the Ferry Building. The
    // exact downtown ordering matches `ST_DistanceSphere` on WGS84 (Blue
    // Bottle is closest by a clear margin; Réveille and Sightglass are
    // close to each other but Réveille's longitude offset is partially
    // cancelled by its near-east latitude alignment with the Ferry Bldg).
    expect(rows.map((r) => r.name).slice(0, 3)).toEqual([
      'Blue Bottle (Mint Plaza)',
      'Réveille Polk',
      'Sightglass Coffee',
    ]);

    // distanceSphere returns metres on the WGS84 sphere; values must
    // be monotonic non-negative.
    const meters = rows.map((r) => r.meters);
    expect(meters.every((m) => m >= 0)).toBe(true);
    expect(meters).toEqual([...meters].sort((a, b) => a - b));
  });

  it('findCafesWithinRadius filters by metres and excludes far-away rows', async () => {
    const ferryBuilding = point(-122.3937, 37.7955, 4326);
    // 3 km of the Ferry Building = the three downtown cafes; Mission
    // (Ritual) and Outer Sunset (Andytown) are well outside.
    const rows = await findCafesWithinRadius(ferryBuilding, 3_000, 50, runtime);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(
      ['Blue Bottle (Mint Plaza)', 'Réveille Polk', 'Sightglass Coffee'].sort(),
    );
  });

  it('findNeighborhoodForPoint returns the polygon containing the point', async () => {
    const sightglassPoint = SIGHTGLASS.location;
    const rows = await findNeighborhoodForPoint(sightglassPoint, runtime);
    expect(rows.map((r) => r.name)).toEqual(['SoMa']);

    const andytownPoint = ANDYTOWN.location;
    const sunsetRows = await findNeighborhoodForPoint(andytownPoint, runtime);
    expect(sunsetRows.map((r) => r.name)).toEqual(['Outer Sunset']);
  });

  it('findCafesInNeighborhood returns cafes inside the polygon', async () => {
    const somaCafes = await findCafesInNeighborhood(SOMA.boundary, runtime);
    expect(somaCafes.map((c) => c.name).sort()).toEqual(
      ['Sightglass Coffee', 'Blue Bottle (Mint Plaza)'].sort(),
    );

    const missionCafes = await findCafesInNeighborhood(MISSION.boundary, runtime);
    expect(missionCafes.map((c) => c.name)).toEqual(['Ritual (Mission)']);

    const sunsetCafes = await findCafesInNeighborhood(OUTER_SUNSET.boundary, runtime);
    expect(sunsetCafes.map((c) => c.name)).toEqual(['Andytown (Outer Sunset)']);
  });

  it('findRoutesIntersecting flags routes that cross a closure polygon', async () => {
    // A polygon over downtown Market St — the Market Street stroll runs
    // straight through it; the Mission loop is well to the south.
    const closure = polygon(
      [
        [-122.415, 37.78],
        [-122.405, 37.78],
        [-122.405, 37.79],
        [-122.415, 37.79],
        [-122.415, 37.78],
      ],
      4326,
    );
    const rows = await findRoutesIntersecting(closure, runtime);
    expect(rows.map((r) => r.name)).toEqual(['Market Street stroll']);
  });

  it('findCafesInBbox returns cafes whose bbox intersects the viewport', async () => {
    // Tight downtown viewport — should match the three downtown cafes
    // and exclude the Mission + Outer Sunset locations.
    const rows = await findCafesInBbox([-122.425, 37.775, -122.4, 37.8], runtime);
    expect(rows.map((c) => c.name).sort()).toEqual(
      ['Blue Bottle (Mint Plaza)', 'Réveille Polk', 'Sightglass Coffee'].sort(),
    );
  });
});
