import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'pathe';
import {
  detectPackageManager,
  formatRunCommand,
  hasProjectManifest,
  type PackageManager,
} from './detect-package-manager';
import { errorInitInvalidManifest, errorInitInvalidTsconfig } from './errors';
import { mergeGitattributes, requiredGitattributesLines } from './hygiene-gitattributes';
import { mergeGitignore } from './hygiene-gitignore';
import {
  ensureEsmModuleType,
  mergePackageScripts,
  REQUIRED_SCRIPTS,
} from './hygiene-package-scripts';
import { type ResolvedInitInputs, resolveInitInputs } from './inputs';
import { findStaleArtefacts, removeDependency } from './reinit-cleanup';
import { LEGACY_SKILL_FILE } from './skill-install';
import { configFile, dbFile, starterSchema } from './templates/code-templates';
import { envExampleContent, envFileContent } from './templates/env';
import { quickReferenceMd } from './templates/quick-reference';
import { minimalProjectReadmeMd } from './templates/readme';
import { defaultTsConfig, mergeTsConfig, TsConfigParseError } from './templates/tsconfig';

export interface PlannedInitFile {
  readonly path: string;
  readonly content: string;
  /**
   * Optional human-mode message printed *after* the file is written —
   * matches the legacy `Updated tsconfig.json with required compiler
   * options.` line emitted when an existing tsconfig is merged. Kept
   * with the entry so the plan phase decides what to say and the write
   * phase remains a dumb loop (FR6.2 atomicity).
   */
  readonly logMessage?: string;
}

export interface InitPlan {
  readonly target: 'postgres' | 'mongodb';
  readonly authoring: ResolvedInitInputs['authoring'];
  readonly schemaPath: string;
  readonly files: readonly PlannedInitFile[];
  readonly deletions: readonly string[];
  readonly warnings: readonly string[];
  readonly hasTypesNode: boolean;
}

export interface InitPlanOptions {
  readonly target: 'postgres' | 'postgresql' | 'mongo' | 'mongodb';
  readonly authoring: 'psl' | 'typescript' | 'ts';
  readonly schemaPath?: string;
  readonly force?: boolean;
  readonly writeEnv?: boolean;
  /**
   * Defaults to filesystem/user-agent detection — pass it explicitly
   * when planning into a directory that has no lockfile yet.
   */
  readonly packageManager?: PackageManager;
}

export interface InitApplyResult {
  readonly filesWritten: readonly string[];
  readonly filesDeleted: readonly string[];
}

export async function planInit(baseDir: string, options: InitPlanOptions): Promise<InitPlan> {
  const inputs = await resolveInitInputs({
    baseDir,
    options: {
      target: options.target,
      authoring: options.authoring,
      ...(options.schemaPath !== undefined ? { schemaPath: options.schemaPath } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
      writeEnv: options.writeEnv ?? false,
      install: false,
      skill: false,
    },
    canPrompt: false,
    autoAcceptPrompts: false,
  });
  const pm = options.packageManager ?? (await detectPackageManager(baseDir));
  return buildInitPlan({ baseDir, inputs, pm });
}

/**
 * Precondition phase (FR6.2 / NFR3 atomicity): read every file we may
 * need to merge with, parse it, compute the merged content, and
 * accumulate the full set of writes — *before* touching the filesystem.
 * A failure here (malformed package.json, unparseable tsconfig.json, …)
 * throws a structured error and the user's project on disk stays
 * byte-identical to its pre-init state.
 */
export function buildInitPlan(ctx: {
  readonly baseDir: string;
  readonly inputs: ResolvedInitInputs;
  readonly pm: PackageManager;
}): InitPlan {
  const { baseDir, inputs, pm } = ctx;
  const warnings: string[] = [];
  const pkgRun = formatRunCommand(pm, 'prisma-next', '').trimEnd();

  const schemaDir = dirname(inputs.schemaPath);
  const configContractPath = isAbsolute(inputs.schemaPath)
    ? inputs.schemaPath
    : `./${inputs.schemaPath}`;

  const files: PlannedInitFile[] = [
    { path: inputs.schemaPath, content: starterSchema(inputs.target, inputs.authoring) },
    {
      path: 'prisma-next.config.ts',
      content: configFile(inputs.target, configContractPath),
    },
    { path: join(schemaDir, 'db.ts'), content: dbFile(inputs.target) },
    {
      path: 'prisma-next.md',
      content: quickReferenceMd(inputs.target, inputs.authoring, inputs.schemaPath, pkgRun),
    },
    { path: '.env.example', content: envExampleContent(inputs.target) },
  ];

  // FR9.1 — on re-init, queue the previously-emitted contract artefacts
  // for deletion so a target switch (or schema-shape change) does not
  // leave a stale `contract.json` / `contract.d.ts` next to the new
  // schema source. Detection is filesystem-only (no parsing of the
  // previous config) so the cleanup is safe to stage before the write
  // phase: each path is checked for existence here, and
  // missing-on-disk-at-apply-time is tolerated.
  const deletions: string[] = inputs.reinit ? [...findStaleArtefacts(baseDir, schemaDir)] : [];

  // `init` delegates the skill to `npx skills add prisma/prisma-next#v<version>`,
  // so a hand-rolled `.agents/skills/prisma-next/SKILL.md` in the project
  // would shadow the published package. Queue it for deletion on every
  // run (not gated on `--reinit`).
  if (existsSync(join(baseDir, LEGACY_SKILL_FILE))) {
    deletions.push(LEGACY_SKILL_FILE);
  }

  // FR3.2: a real `.env` is only written when the user opted in. Never
  // overwrite an existing `.env` — secrets live there and clobbering
  // them is the most damaging possible side-effect of `init`.
  if (inputs.writeEnv) {
    if (!existsSync(join(baseDir, '.env'))) {
      files.push({ path: '.env', content: envFileContent(inputs.target) });
    } else {
      warnings.push(
        '.env already exists; leaving it untouched. Compare with .env.example for any new keys.',
      );
    }
  }

  // FR2.2 / FR6.1: tsconfig.json gets the minimum compiler options the
  // scaffolded files need. JSONC (TS's actual configured dialect) is
  // accepted; an unparseable file is mapped to a structured
  // precondition error (5011) rather than crashing mid-write.
  const tsconfigPath = join(baseDir, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    const existing = readFileSync(tsconfigPath, 'utf-8');
    let merged: string;
    try {
      merged = mergeTsConfig(existing);
    } catch (err) {
      if (err instanceof TsConfigParseError) {
        throw errorInitInvalidTsconfig({ path: 'tsconfig.json', cause: err.message });
      }
      throw err;
    }
    files.push({
      path: 'tsconfig.json',
      content: merged,
      logMessage: 'Updated tsconfig.json with required compiler options.',
    });
  } else {
    files.push({ path: 'tsconfig.json', content: defaultTsConfig() });
  }

  // FR3.3: idempotent .gitignore — append only what's missing.
  const gitignorePath = join(baseDir, '.gitignore');
  const existingGitignore = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf-8')
    : undefined;
  const newGitignore = mergeGitignore(existingGitignore);
  if (newGitignore !== null) {
    files.push({ path: '.gitignore', content: newGitignore });
  }

  // FR3.4: idempotent .gitattributes — linguist-generated entries for
  // the emitted artefacts so GitHub diff stats / code review collapse
  // them by default.
  const gitattributesPath = join(baseDir, '.gitattributes');
  const existingGitattributes = existsSync(gitattributesPath)
    ? readFileSync(gitattributesPath, 'utf-8')
    : undefined;
  const newGitattributes = mergeGitattributes(
    existingGitattributes,
    requiredGitattributesLines(schemaDir, inputs.target),
  );
  if (newGitattributes !== null) {
    files.push({ path: '.gitattributes', content: newGitattributes });
  }

  // Read + parse package.json once for both the FR3.5 scripts merge and
  // the FR2.1 `@types/node`-presence check. A malformed manifest is
  // mapped to a structured precondition error (5010) rather than the
  // generic INTERNAL_ERROR fallback so CI/agents can branch on it.
  //
  // When neither `package.json` nor a `deno.json[c]` is present, init
  // synthesises a minimal `package.json` (TML-2496) — running
  // `npm init -y` first was friction with no upside, since we always
  // edit the file anyway. A `deno.json[c]` project is left alone:
  // creating a `package.json` next to it would fork the project's
  // dependency graph.
  const packageJsonPath = join(baseDir, 'package.json');
  const packageJsonExisted = existsSync(packageJsonPath);
  const synthesisePackageJson = !packageJsonExisted && !hasProjectManifest(baseDir);
  let parsedPackageJson: Record<string, unknown> | null = null;
  if (packageJsonExisted || synthesisePackageJson) {
    const pkgRaw = packageJsonExisted
      ? readFileSync(packageJsonPath, 'utf-8')
      : defaultPackageJsonContent(basename(baseDir));
    try {
      parsedPackageJson = JSON.parse(pkgRaw) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw errorInitInvalidManifest({ path: 'package.json', cause: err.message });
      }
      throw err;
    }

    // package.json edits are chained: FR9.2 facade-dep removal first
    // (so the later passes see the cleaned `dependencies` and we round
    // out a single re-stringification), then FR3.5 / FR9.3 idempotent
    // scripts merge with collision detection, then `"type": "module"`
    // alignment so the ESM-only `with { type: 'json' }` import attribute
    // in the scaffolded `prisma/db.ts` loads cleanly under Node's
    // loader (TML-2494).
    let workingPkg = pkgRaw;
    // A synthesised manifest is always a write — the file does not
    // exist on disk yet.
    let pkgChanged = synthesisePackageJson;
    if (inputs.removePreviousFacade !== null) {
      const next = removeDependency(workingPkg, inputs.removePreviousFacade);
      if (next !== null) {
        workingPkg = next;
        pkgChanged = true;
      }
    }
    const { content: nextPkg, warnings: scriptWarnings } = mergePackageScripts(
      workingPkg,
      REQUIRED_SCRIPTS,
    );
    if (nextPkg !== null) {
      workingPkg = nextPkg;
      pkgChanged = true;
    }
    const { content: typedPkg, warning: typeWarning } = ensureEsmModuleType(workingPkg);
    if (typedPkg !== null) {
      workingPkg = typedPkg;
      pkgChanged = true;
    }
    if (pkgChanged) {
      files.push({ path: 'package.json', content: workingPkg });
    }
    warnings.push(...scriptWarnings);
    if (typeWarning !== null) {
      warnings.push(typeWarning);
    }
    if (synthesisePackageJson) {
      warnings.push(
        'No package.json found in the target directory; created a minimal one. Edit `name` / `version` to taste.',
      );
    }
  }

  if (existsSync(join(baseDir, 'src/index.ts'))) {
    if (!existsSync(join(baseDir, 'README.md'))) {
      const rawName =
        parsedPackageJson !== null && typeof parsedPackageJson['name'] === 'string'
          ? parsedPackageJson['name']
          : basename(baseDir);
      files.push({
        path: 'README.md',
        content: minimalProjectReadmeMd(
          inputs.target,
          inputs.schemaPath,
          sanitisePackageName(rawName),
          pm,
        ),
      });
    } else {
      warnings.push('README.md already exists; leaving it untouched.');
    }
  }

  return {
    target: inputs.target === 'mongo' ? 'mongodb' : 'postgres',
    authoring: inputs.authoring,
    schemaPath: inputs.schemaPath,
    files,
    deletions,
    warnings,
    hasTypesNode:
      parsedPackageJson !== null ? hasDirectDep(parsedPackageJson, '@types/node') : false,
  };
}

/**
 * Write phase. Deletions run *after* the writes: deletion names never
 * collide with planned files (init never writes `contract.json` —
 * that's `contract emit`'s job), so the ordering guarantees we never
 * remove a file we just produced. A file already missing at apply time
 * (e.g. a concurrent `git checkout`) is tolerated as the user-visible
 * end state we wanted anyway.
 */
export function applyInitPlan(
  baseDir: string,
  plan: Pick<InitPlan, 'files' | 'deletions'>,
  hooks?: { readonly onFileWritten?: (file: PlannedInitFile) => void },
): InitApplyResult {
  const filesWritten: string[] = [];
  const filesDeleted: string[] = [];

  for (const file of plan.files) {
    const fullPath = join(baseDir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
    filesWritten.push(file.path);
    hooks?.onFileWritten?.(file);
  }

  for (const rel of plan.deletions) {
    const fullPath = join(baseDir, rel);
    if (!existsSync(fullPath)) {
      continue;
    }
    try {
      unlinkSync(fullPath);
      filesDeleted.push(rel);
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT')) {
        throw err;
      }
    }
  }

  return { filesWritten, filesDeleted };
}

/**
 * FR2.1 — true when the parsed `package.json` declares `name` directly
 * in either `dependencies` or `devDependencies`. We deliberately don't
 * inspect `peerDependencies` (irrelevant for a leaf project) or the
 * lockfile (transitive presence is brittle to detect and not the
 * realistic clobber-risk path).
 *
 * Exported for unit tests.
 */
export function hasDirectDep(parsed: Record<string, unknown>, name: string): boolean {
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const value = parsed[field];
    if (value !== null && typeof value === 'object' && name in value) {
      return true;
    }
  }
  return false;
}

/**
 * Minimal `package.json` content used when init runs in a directory
 * that has no project manifest (TML-2496). Mirrors the npm 11 `init -y`
 * defaults, with two deliberate deviations:
 *
 * - `"private": true` so a stray `npm publish` cannot leak the
 *   placeholder. Users who want to publish have to opt in by removing
 *   the field.
 * - `"type": "module"` so the scaffolded ESM imports in
 *   `prisma-next.config.ts` and `db.ts` typecheck and run without
 *   additional tsconfig coercion.
 *
 * Exported for unit tests so the canonical shape is asserted in one
 * place rather than re-derived at every call site.
 */
export function defaultPackageJsonContent(rawName: string): string {
  return `${JSON.stringify(
    {
      name: sanitisePackageName(rawName),
      version: '0.0.0',
      private: true,
      type: 'module',
    },
    null,
    2,
  )}\n`;
}

/**
 * npm package names are restricted to lowercase, no leading dot/underscore,
 * and a small URL-safe character set. `basename(cwd)` happily returns
 * "My Project" or ".hidden" — both rejected by `npm install` validation.
 * Coerce to a safe fallback rather than emit a manifest npm refuses to
 * read.
 */
function sanitisePackageName(raw: string): string {
  const lowered = raw.toLowerCase().replace(/[^a-z0-9._~-]/g, '-');
  const trimmed = lowered.replace(/^[._-]+/, '').replace(/-+/g, '-');
  return trimmed.length > 0 ? trimmed : 'my-app';
}
