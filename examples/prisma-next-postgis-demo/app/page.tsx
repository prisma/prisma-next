import { point, polygon } from '@prisma-next/extension-postgis/geojson';
import {
  findCafesInBbox,
  findCafesInNeighborhood,
  findCafesNearPoint,
  findCafesWithinRadius,
  findNeighborhoodForPoint,
  findRoutesIntersecting,
} from '../src/queries';
import { neighborhoods } from '../src/seed-data';
import { getRuntime } from './lib/db';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FERRY_BUILDING_LNG = -122.3937;
const FERRY_BUILDING_LAT = 37.7955;

function num(value: string | string[] | undefined, fallback: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const lng = num(params['lng'], FERRY_BUILDING_LNG);
  const lat = num(params['lat'], FERRY_BUILDING_LAT);
  const radius = num(params['radius'], 2_000);
  const limit = num(params['limit'], 5);

  const queryPoint = point(lng, lat, 4326);
  const downtownBbox: readonly [number, number, number, number] = [-122.425, 37.775, -122.4, 37.8];
  const closurePolygon = polygon(
    [
      [-122.415, 37.78],
      [-122.405, 37.78],
      [-122.405, 37.79],
      [-122.415, 37.79],
      [-122.415, 37.78],
    ],
    4326,
  );
  const soma = neighborhoods.find((n) => n.name === 'SoMa')!;

  const runtime = await getRuntime();

  const [
    nearestCafes,
    cafesWithinRadius,
    neighborhoodForPoint,
    cafesInSoma,
    routesIntersectingClosure,
    cafesInBbox,
  ] = await Promise.all([
    findCafesNearPoint(queryPoint, limit, runtime),
    findCafesWithinRadius(queryPoint, radius, 50, runtime),
    findNeighborhoodForPoint(queryPoint, runtime),
    findCafesInNeighborhood(soma.boundary, runtime),
    findRoutesIntersecting(closurePolygon, runtime),
    findCafesInBbox(downtownBbox, runtime),
  ]);

  return (
    <main>
      <header>
        <h1>Prisma Next · PostGIS demo</h1>
        <p>
          Live PostGIS queries over five San Francisco cafes, three neighborhood polygons, and two
          routes. Edit the inputs below to re-run the geospatial queries on the server.
        </p>
      </header>

      <section>
        <h2>
          Query point <span className="tag">lng / lat / radius / limit</span>
        </h2>
        <p className="desc">
          Defaults to the Ferry Building (-122.3937, 37.7955). Submit to update the queries below.
        </p>
        <form className="inline" action="/" method="GET">
          <input name="lng" defaultValue={lng} step="any" type="number" aria-label="Longitude" />
          <input name="lat" defaultValue={lat} step="any" type="number" aria-label="Latitude" />
          <input
            name="radius"
            defaultValue={radius}
            step="any"
            type="number"
            aria-label="Radius (metres)"
          />
          <input
            name="limit"
            defaultValue={limit}
            step="1"
            min="1"
            type="number"
            aria-label="Limit"
          />
          <button type="submit">Run queries</button>
        </form>
      </section>

      <section>
        <h2>
          findCafesNearPoint <span className="tag">ST_DistanceSphere · ORDER BY · LIMIT</span>
        </h2>
        <p className="desc">Closest cafes to the query point, ordered ascending by metres.</p>
        {nearestCafes.length === 0 ? (
          <p className="empty">No cafes found. Did you run `pnpm seed`?</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Metres</th>
              </tr>
            </thead>
            <tbody>
              {nearestCafes.map((cafe, i) => (
                <tr key={cafe.id}>
                  <td>{i + 1}</td>
                  <td>{cafe.name}</td>
                  <td className="num">{Math.round(cafe.meters).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>
          findCafesWithinRadius <span className="tag">WHERE ST_DistanceSphere &lt;= $metres</span>
        </h2>
        <p className="desc">Cafes inside a {radius.toLocaleString()} m radius of the point.</p>
        {cafesWithinRadius.length === 0 ? (
          <p className="empty">Nothing within {radius.toLocaleString()} m.</p>
        ) : (
          <ul>
            {cafesWithinRadius.map((cafe) => (
              <li key={cafe.id}>{cafe.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>
          findNeighborhoodForPoint <span className="tag">ST_Contains</span>
        </h2>
        <p className="desc">Reverse geocode the query point against neighborhood polygons.</p>
        {neighborhoodForPoint.length === 0 ? (
          <p className="empty">Point is outside every neighborhood polygon in the demo.</p>
        ) : (
          <ul>
            {neighborhoodForPoint.map((hood) => (
              <li key={hood.id}>{hood.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>
          findCafesInNeighborhood (SoMa) <span className="tag">ST_Within</span>
        </h2>
        <p className="desc">Cafes whose location falls inside the SoMa polygon.</p>
        <ul>
          {cafesInSoma.map((cafe) => (
            <li key={cafe.id}>{cafe.name}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>
          findRoutesIntersecting (downtown closure) <span className="tag">ST_Intersects</span>
        </h2>
        <p className="desc">Routes whose path crosses a fictional closure polygon downtown.</p>
        {routesIntersectingClosure.length === 0 ? (
          <p className="empty">No routes intersect the closure.</p>
        ) : (
          <ul>
            {routesIntersectingClosure.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>
          findCafesInBbox (downtown viewport){' '}
          <span className="tag">&amp;&amp; (intersectsBbox)</span>
        </h2>
        <p className="desc">
          Bounding-box filter — cheap, index-friendly, perfect for map viewport queries. Bbox:{' '}
          {downtownBbox.join(', ')}.
        </p>
        <ul>
          {cafesInBbox.map((cafe) => (
            <li key={cafe.id}>{cafe.name}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
