#!/usr/bin/env node

/**
 * Dependency Cruiser configuration for Prisma Next.
 *
 * It derives module groups from architecture.config.json and encodes the same-layer/
 * downward-only semantics plus specific temporary exceptions described in the layering docs.
 */

import config from './architecture.config.json' with { type: 'json' };

const { packages: packageConfigs, layerOrder } = config;

const normalizeGlob = (glob) => {
  let pattern = glob.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
  if (!pattern.endsWith('.*') && !pattern.endsWith('/')) {
    pattern += '/.*';
  }
  return `^${pattern}`;
};

const moduleGroupMap = new Map();

for (const pkgConfig of packageConfigs) {
  const key = `${pkgConfig.domain}-${pkgConfig.layer}-${pkgConfig.plane}`;
  if (!moduleGroupMap.has(key)) {
    moduleGroupMap.set(key, {
      key,
      domain: pkgConfig.domain,
      layer: pkgConfig.layer,
      plane: pkgConfig.plane,
      globs: [],
      patterns: [],
    });
  }
  const group = moduleGroupMap.get(key);
  group.globs.push(pkgConfig.glob);
  group.patterns.push(normalizeGlob(pkgConfig.glob));
}

const moduleGroups = Array.from(moduleGroupMap.values());

const getLayerIndex = (domain, layer) => {
  const order = layerOrder[domain];
  if (!order) return -1;
  return order.indexOf(layer);
};

const describeGroup = (group) => `${group.domain}/${group.layer}/${group.plane}`;
const groupPattern = (group) => group.patterns.join('|');

const forbidden = [];

const pushRule = (name, comment, sourceGroup, targetGroup) => {
  forbidden.push({
    name,
    comment,
    severity: 'error',
    from: { path: groupPattern(sourceGroup) },
    to: { path: groupPattern(targetGroup) },
  });
};

const isCliGroup = (group) =>
  group.domain === 'framework' &&
  group.layer === 'tooling' &&
  group.globs.some((glob) => glob.includes('tooling/cli'));

const isSqlAuthoringToTargets = (sourceGroup, targetGroup) =>
  sourceGroup.domain === 'sql' &&
  sourceGroup.layer === 'authoring' &&
  targetGroup.layer === 'targets';

const isSqlLanesToRuntime = (sourceGroup, targetGroup) =>
  sourceGroup.domain === 'sql' &&
  sourceGroup.layer === 'lanes' &&
  sourceGroup.plane === 'runtime' &&
  targetGroup.layer === 'runtime' &&
  targetGroup.plane === 'runtime';

const isCliToSqlTargets = (sourceGroup, targetGroup) =>
  isCliGroup(sourceGroup) && targetGroup.domain === 'sql' && targetGroup.layer === 'targets';

const isCliToSqlAuthoring = (sourceGroup, targetGroup) =>
  isCliGroup(sourceGroup) && targetGroup.domain === 'sql' && targetGroup.layer === 'authoring';

const isExtensionsToSqlTargets = (sourceGroup, targetGroup) =>
  sourceGroup.domain === 'extensions' &&
  targetGroup.domain === 'sql' &&
  targetGroup.layer === 'targets';

const isCompatPrismaToSql = (sourceGroup, targetGroup) =>
  sourceGroup.domain === 'extensions' &&
  sourceGroup.layer === 'compat' &&
  sourceGroup.globs.some((glob) => glob.includes('compat-prisma')) &&
  targetGroup.domain === 'sql';

const isSqlRuntimeOrAdaptersToTargets = (sourceGroup, targetGroup) =>
  sourceGroup.domain === 'sql' &&
  ['runtime', 'lanes', 'adapters'].includes(sourceGroup.layer) &&
  targetGroup.domain === 'sql' &&
  targetGroup.layer === 'targets';

const createUpwardRules = () => {
  for (const sourceGroup of moduleGroups) {
    for (const targetGroup of moduleGroups) {
      if (sourceGroup.domain !== targetGroup.domain) continue;

      const sourceIndex = getLayerIndex(sourceGroup.domain, sourceGroup.layer);
      const targetIndex = getLayerIndex(targetGroup.domain, targetGroup.layer);
      if (sourceIndex === -1 || targetIndex === -1 || targetIndex <= sourceIndex) continue;

      // SQL contract types are now in shared plane (sql/contract), so authoring can import from shared
      // No exception needed - authoring imports from shared, not targets

      // TODO: lanes are currently aligned with runtime contracts; revisit once the runtime plane is further isolated
      if (isSqlLanesToRuntime(sourceGroup, targetGroup)) {
        continue;
      }

      pushRule(
        `upward-${sourceGroup.key}-to-${targetGroup.layer}`,
        `Upward import: ${describeGroup(sourceGroup)} cannot import from ${describeGroup(targetGroup)} (away from core)`,
        sourceGroup,
        targetGroup,
      );
    }
  }
};

const createCrossDomainRules = () => {
  for (const sourceGroup of moduleGroups) {
    for (const targetGroup of moduleGroups) {
      if (sourceGroup.domain === targetGroup.domain) continue;
      if (targetGroup.domain === 'framework') continue;

      // TODO: CLI tooling uses SQL targets/authoring hooks until the plugin split is complete (docs/briefs/package-layering/04-Split-SQL-Lanes.md Goal 4)
      if (
        isCliToSqlTargets(sourceGroup, targetGroup) ||
        isCliToSqlAuthoring(sourceGroup, targetGroup)
      ) {
        continue;
      }

      if (isExtensionsToSqlTargets(sourceGroup, targetGroup)) {
        continue;
      }

      // TODO: compat-prisma is a compatibility layer that needs to import from SQL packages to provide Prisma ORM-compatible API
      if (isCompatPrismaToSql(sourceGroup, targetGroup)) {
        continue;
      }

      pushRule(
        `cross-domain-${sourceGroup.domain}-to-${targetGroup.domain}`,
        `Cross-domain import: ${sourceGroup.domain} cannot import from ${targetGroup.domain} (except framework)`,
        sourceGroup,
        targetGroup,
      );
    }
  }
};

const createPlaneRules = () => {
  for (const sourceGroup of moduleGroups) {
    if (sourceGroup.plane !== 'migration') continue;

    for (const targetGroup of moduleGroups) {
      if (targetGroup.plane !== 'runtime') continue;
      pushRule(
        `migration-to-runtime-${sourceGroup.domain}-${sourceGroup.layer}-to-${targetGroup.layer}`,
        `Migration → Runtime: ${describeGroup(sourceGroup)} cannot import from ${describeGroup(targetGroup)}`,
        sourceGroup,
        targetGroup,
      );
    }
  }

  for (const sourceGroup of moduleGroups) {
    if (sourceGroup.plane !== 'runtime') continue;

    for (const targetGroup of moduleGroups) {
      if (targetGroup.plane !== 'migration') continue;

      // SQL contract types are now in shared plane (sql/contract), so runtime/lanes/adapters can import from shared
      // No exception needed - runtime imports from shared, not targets

      // Extensions share compatibility layers with SQL targets tonight; revisit when the plane is decoupled
      if (isExtensionsToSqlTargets(sourceGroup, targetGroup)) {
        continue;
      }

      // TODO: compat-prisma is a compatibility layer that needs to import from SQL packages to provide Prisma ORM-compatible API
      if (isCompatPrismaToSql(sourceGroup, targetGroup)) {
        continue;
      }

      pushRule(
        `runtime-to-migration-${sourceGroup.domain}-${sourceGroup.layer}-to-${targetGroup.layer}`,
        `Runtime → Migration: ${describeGroup(sourceGroup)} cannot import from ${describeGroup(targetGroup)} (artifacts are consumed out of band)`,
        sourceGroup,
        targetGroup,
      );
    }
  }
};

const createDriverRules = () => {
  const driverGroups = moduleGroups.filter(
    (group) => group.domain === 'sql' && group.layer === 'drivers',
  );

  for (const driverGroup of driverGroups) {
    for (const sourceGroup of moduleGroups) {
      if (sourceGroup.key === driverGroup.key) continue;
      if (sourceGroup.domain !== 'sql') continue;
      if (sourceGroup.layer === 'adapters') continue;

      pushRule(
        `drivers-only-adapters-${sourceGroup.domain}-${sourceGroup.layer}`,
        `Drivers can only be imported by adapters: ${describeGroup(sourceGroup)} cannot import from ${describeGroup(driverGroup)}`,
        sourceGroup,
        driverGroup,
      );
    }
  }
};

const createTestImportRules = () => {
  forbidden.push({
    name: 'packages-cannot-import-test',
    comment: 'packages/** cannot import from test/** (test suites are not part of source)',
    severity: 'error',
    from: { path: '^packages/' },
    to: { path: '^test/' },
  });
};

createUpwardRules();
createCrossDomainRules();
createPlaneRules();
createDriverRules();
createTestImportRules();

export default {
  forbidden,
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    includeOnly: '^packages/',
    exclude: {
      path: [
        'node_modules',
        '\\.test\\.',
        '\\.spec\\.',
        '/test/',
        '\\.config\\.',
        'vitest\\.config',
        'tsup\\.config',
        '\\.d\\.ts$',
        'dist',
        'coverage',
        '^packages/document/',
        '^test/',
      ],
    },
    reporterOptions: {
      dot: {
        collapsePattern: '^packages/[^/]+',
      },
      text: {
        highlightFocused: true,
      },
    },
  },
};
