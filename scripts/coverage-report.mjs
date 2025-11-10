#!/usr/bin/env node

import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const ROOT = resolve(process.cwd());

const EXCLUDED_PATHS = ['examples/', 'packages/integration-tests', 'packages/e2e-tests'];

async function getPackages() {
  // Use pnpm to get all packages recursively
  const { stdout } = await execAsync('pnpm -r list --json', { cwd: ROOT });
  const packages = JSON.parse(stdout);

  // Filter to only packages in packages/ directory, exclude examples and test packages
  const packagePaths = packages
    .map((pkg) => {
      if (!pkg.path) return null;
      const relativePath = pkg.path.replace(`${ROOT}/`, '');
      return relativePath;
    })
    .filter((path) => {
      if (!path) return false;
      // Only include packages in packages/ directory
      if (!path.startsWith('packages/')) return false;
      // Exclude test packages and examples
      if (EXCLUDED_PATHS.some((excluded) => path.startsWith(excluded))) return false;
      return true;
    })
    .map((path) => path.replace('packages/', ''));

  return packagePaths;
}

async function runCoverage(packagePath) {
  const packageDir = join(ROOT, 'packages', packagePath);
  const packageJsonPath = join(packageDir, 'package.json');

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

    if (!packageJson.scripts?.['test:coverage']) {
      return { package: packagePath, skipped: true, reason: 'No test:coverage script' };
    }

    const command = `pnpm --filter ${packageJson.name} test:coverage`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ROOT,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      const output = stdout + stderr;
      const testFailed =
        /FAIL\s+\d+/.test(output) ||
        /Tests\s+\d+\s+failed/.test(output) ||
        /Test Files\s+\d+\s+failed/.test(output);
      const coverageFailed =
        /Coverage threshold/.test(output) ||
        /coverage threshold/.test(output) ||
        /Thresholds not met/.test(output) ||
        (/Coverage for/.test(output) && /does not meet/.test(output));

      const coverageReport = await parseCoverageReport(packageDir).catch(() => null);

      return {
        package: packagePath,
        testPassed: !testFailed,
        coveragePassed: !coverageFailed,
        coverageReport,
        output,
      };
    } catch (error) {
      const output = (error.stdout || '') + (error.stderr || '');
      const testFailed =
        /FAIL\s+\d+/.test(output) ||
        /Tests\s+\d+\s+failed/.test(output) ||
        /Test Files\s+\d+\s+failed/.test(output);
      const coverageFailed =
        /Coverage threshold/.test(output) ||
        /coverage threshold/.test(output) ||
        /Thresholds not met/.test(output) ||
        (/Coverage for/.test(output) && /does not meet/.test(output));

      const coverageReport = await parseCoverageReport(packageDir).catch(() => null);

      return {
        package: packagePath,
        testPassed: !testFailed,
        coveragePassed: !coverageFailed,
        coverageReport,
        output,
        error: error.message,
      };
    }
  } catch (error) {
    return {
      package: packagePath,
      skipped: true,
      reason: error.message,
    };
  }
}

async function parseCoverageReport(packageDir) {
  const coverageJsonPath = join(packageDir, 'coverage', 'coverage-final.json');

  try {
    const coverageData = JSON.parse(await readFile(coverageJsonPath, 'utf-8'));

    const fileCoverage = Object.entries(coverageData).map(([filePath, data]) => {
      const relativePath = filePath.replace(`${packageDir}/`, '');
      const statementMap = data.s || {};
      const branchMap = data.b || {};
      const functionMap = data.f || {};

      const statements = Object.keys(statementMap).length;
      const coveredStatements = Object.values(statementMap).filter((v) => v > 0).length;
      const statementPct = statements > 0 ? (coveredStatements / statements) * 100 : 100;

      const branchHits = Object.values(branchMap).flat();
      const coveredBranches = branchHits.filter((v) => v > 0).length;
      const totalBranchPoints = branchHits.length;
      const branchPct = totalBranchPoints > 0 ? (coveredBranches / totalBranchPoints) * 100 : 100;

      const functions = Object.keys(functionMap).length;
      const coveredFunctions = Object.values(functionMap).filter((v) => v > 0).length;
      const functionPct = functions > 0 ? (coveredFunctions / functions) * 100 : 100;

      return {
        file: relativePath,
        statements: { total: statements, covered: coveredStatements, pct: statementPct },
        branches: { total: totalBranchPoints, covered: coveredBranches, pct: branchPct },
        functions: { total: functions, covered: coveredFunctions, pct: functionPct },
      };
    });

    return fileCoverage;
  } catch (_error) {
    return null;
  }
}

function calculateOverallCoverage(fileCoverage) {
  if (!fileCoverage || fileCoverage.length === 0) return null;

  let totalStatements = 0;
  let coveredStatements = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;

  for (const file of fileCoverage) {
    totalStatements += file.statements.total;
    coveredStatements += file.statements.covered;
    totalBranches += file.branches.total;
    coveredBranches += file.branches.covered;
    totalFunctions += file.functions.total;
    coveredFunctions += file.functions.covered;
  }

  return {
    statements: {
      total: totalStatements,
      covered: coveredStatements,
      pct: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 100,
    },
    branches: {
      total: totalBranches,
      covered: coveredBranches,
      pct: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 100,
    },
    functions: {
      total: totalFunctions,
      covered: coveredFunctions,
      pct: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 100,
    },
  };
}

function checkThresholds(fileCoverage, thresholds) {
  if (!fileCoverage || !thresholds) return [];

  const failures = [];

  for (const file of fileCoverage) {
    const fileFailures = [];

    if (thresholds.statements && file.statements.pct < thresholds.statements) {
      fileFailures.push(
        `statements: ${file.statements.pct.toFixed(2)}% < ${thresholds.statements}%`,
      );
    }
    if (thresholds.branches && file.branches.pct < thresholds.branches) {
      fileFailures.push(`branches: ${file.branches.pct.toFixed(2)}% < ${thresholds.branches}%`);
    }
    if (thresholds.functions && file.functions.pct < thresholds.functions) {
      fileFailures.push(`functions: ${file.functions.pct.toFixed(2)}% < ${thresholds.functions}%`);
    }

    if (fileFailures.length > 0) {
      failures.push({
        file: file.file,
        failures: fileFailures,
      });
    }
  }

  return failures;
}

function suggestThresholdIncreases(overallCoverage, thresholds, margin = 5) {
  if (!overallCoverage || !thresholds) return null;

  const suggestions = {};
  let hasSuggestions = false;

  if (thresholds.statements && overallCoverage.statements.pct >= thresholds.statements + margin) {
    const suggested = Math.min(95, Math.floor(overallCoverage.statements.pct));
    if (suggested > thresholds.statements) {
      suggestions.statements = {
        current: thresholds.statements,
        actual: overallCoverage.statements.pct,
        suggested,
      };
      hasSuggestions = true;
    }
  }

  if (thresholds.branches && overallCoverage.branches.pct >= thresholds.branches + margin) {
    const suggested = Math.min(95, Math.floor(overallCoverage.branches.pct));
    if (suggested > thresholds.branches) {
      suggestions.branches = {
        current: thresholds.branches,
        actual: overallCoverage.branches.pct,
        suggested,
      };
      hasSuggestions = true;
    }
  }

  if (thresholds.functions && overallCoverage.functions.pct >= thresholds.functions + margin) {
    const suggested = Math.min(95, Math.floor(overallCoverage.functions.pct));
    if (suggested > thresholds.functions) {
      suggestions.functions = {
        current: thresholds.functions,
        actual: overallCoverage.functions.pct,
        suggested,
      };
      hasSuggestions = true;
    }
  }

  return hasSuggestions ? suggestions : null;
}

async function getThresholds(packagePath) {
  const vitestConfigPath = join(ROOT, 'packages', packagePath, 'vitest.config.ts');

  try {
    const configContent = await readFile(vitestConfigPath, 'utf-8');

    const thresholdsMatch = configContent.match(/thresholds:\s*\{([^}]+)\}/s);
    if (!thresholdsMatch) return null;

    const thresholds = {};
    const linesMatch = thresholdsMatch[1].match(/lines:\s*(\d+)/);
    const branchesMatch = thresholdsMatch[1].match(/branches:\s*(\d+)/);
    const functionsMatch = thresholdsMatch[1].match(/functions:\s*(\d+)/);
    const statementsMatch = thresholdsMatch[1].match(/statements:\s*(\d+)/);

    if (statementsMatch) {
      thresholds.statements = Number.parseInt(statementsMatch[1], 10);
    } else if (linesMatch) {
      thresholds.statements = Number.parseInt(linesMatch[1], 10);
    }
    if (branchesMatch) thresholds.branches = Number.parseInt(branchesMatch[1], 10);
    if (functionsMatch) thresholds.functions = Number.parseInt(functionsMatch[1], 10);

    return Object.keys(thresholds).length > 0 ? thresholds : null;
  } catch {
    return null;
  }
}

async function formatResults(results) {
  const testFailures = results.filter((r) => !r.skipped && !r.testPassed);
  const coverageFailures = results.filter((r) => !r.skipped && r.testPassed && !r.coveragePassed);
  const passed = results.filter((r) => !r.skipped && r.testPassed && r.coveragePassed);
  const skipped = results.filter((r) => r.skipped);

  console.log(`\n${'='.repeat(80)}`);
  console.log('COVERAGE REPORT SUMMARY');
  console.log(`${'='.repeat(80)}\n`);

  if (testFailures.length > 0) {
    console.log('❌ PACKAGES WITH TEST FAILURES:');
    console.log('-'.repeat(80));
    for (const result of testFailures) {
      console.log(`  • ${result.package}`);
      if (result.error) {
        console.log(`    Error: ${result.error}`);
      }
    }
    console.log('');
  }

  if (coverageFailures.length > 0) {
    console.log('⚠️  PACKAGES WITH COVERAGE THRESHOLD FAILURES:');
    console.log('-'.repeat(80));
    for (const result of coverageFailures) {
      console.log(`  • ${result.package}`);

      const thresholds = await getThresholds(result.package);
      if (thresholds && result.coverageReport) {
        const fileFailures = checkThresholds(result.coverageReport, thresholds);
        if (fileFailures.length > 0) {
          console.log('    Files below thresholds:');
          for (const failure of fileFailures) {
            console.log(`      - ${failure.file}`);
            for (const fail of failure.failures) {
              console.log(`        ${fail}`);
            }
          }
        }
      }
    }
    console.log('');
  }

  const thresholdSuggestions = [];

  for (const result of passed) {
    if (result.coverageReport) {
      const thresholds = await getThresholds(result.package);
      if (thresholds) {
        const overallCoverage = calculateOverallCoverage(result.coverageReport);
        if (overallCoverage) {
          const suggestions = suggestThresholdIncreases(overallCoverage, thresholds);
          if (suggestions) {
            thresholdSuggestions.push({
              package: result.package,
              overallCoverage,
              suggestions,
            });
          }
        }
      }
    }
  }

  if (passed.length > 0) {
    console.log('✅ PACKAGES PASSING ALL CHECKS:');
    console.log('-'.repeat(80));
    for (const result of passed) {
      console.log(`  • ${result.package}`);
    }
    console.log('');
  }

  if (thresholdSuggestions.length > 0) {
    console.log('📈 PACKAGES ABOVE THRESHOLDS (consider increasing):');
    console.log('-'.repeat(80));
    for (const item of thresholdSuggestions) {
      console.log(`  • ${item.package}`);
      console.log('    Current coverage:');
      if (item.suggestions.statements) {
        console.log(
          `      statements: ${item.overallCoverage.statements.pct.toFixed(2)}% (threshold: ${item.suggestions.statements.current}%)`,
        );
      }
      if (item.suggestions.branches) {
        console.log(
          `      branches: ${item.overallCoverage.branches.pct.toFixed(2)}% (threshold: ${item.suggestions.branches.current}%)`,
        );
      }
      if (item.suggestions.functions) {
        console.log(
          `      functions: ${item.overallCoverage.functions.pct.toFixed(2)}% (threshold: ${item.suggestions.functions.current}%)`,
        );
      }
      console.log('    Suggested thresholds:');
      const suggestedThresholds = [];
      if (item.suggestions.statements) {
        suggestedThresholds.push(`statements: ${item.suggestions.statements.suggested}`);
      }
      if (item.suggestions.branches) {
        suggestedThresholds.push(`branches: ${item.suggestions.branches.suggested}`);
      }
      if (item.suggestions.functions) {
        suggestedThresholds.push(`functions: ${item.suggestions.functions.suggested}`);
      }
      console.log(`      ${suggestedThresholds.join(', ')}`);
    }
    console.log('');
  }

  if (skipped.length > 0) {
    console.log('⏭️  SKIPPED PACKAGES:');
    console.log('-'.repeat(80));
    for (const result of skipped) {
      console.log(`  • ${result.package}: ${result.reason}`);
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log(
    `Total: ${results.length} | Passed: ${passed.length} | Test Failures: ${testFailures.length} | Coverage Failures: ${coverageFailures.length} | Threshold Suggestions: ${thresholdSuggestions.length} | Skipped: ${skipped.length}`,
  );
  console.log(`${'='.repeat(80)}\n`);

  return {
    testFailures: testFailures.length,
    coverageFailures: coverageFailures.length,
    passed: passed.length,
    total: results.length,
  };
}

async function main() {
  const packages = await getPackages();

  console.log(`Running coverage for ${packages.length} packages...\n`);

  const results = [];
  for (const packagePath of packages) {
    process.stdout.write(`Running coverage for ${packagePath}... `);
    const result = await runCoverage(packagePath);
    results.push(result);

    if (result.skipped) {
      console.log('⏭️  skipped');
    } else if (!result.testPassed) {
      console.log('❌ tests failed');
    } else if (!result.coveragePassed) {
      console.log('⚠️  coverage failed');
    } else {
      console.log('✅ passed');
    }
  }

  const summary = await formatResults(results);

  if (summary.testFailures > 0 || summary.coverageFailures > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error running coverage report:', error);
  process.exit(1);
});
