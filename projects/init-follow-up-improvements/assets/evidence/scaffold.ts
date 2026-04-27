// Scaffolds exactly the files that `prisma-next init` would scaffold for a
// given (target × authoring) combo, by importing the same templates the CLI
// uses. Skips install/emit. Pure-function based, so no PTY/clack drama.
//
// Usage:
//   pnpm exec tsx scaffold.ts <baseDir> <target> <authoring> [schemaPath]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { agentSkillMd } from '../../packages/1-framework/3-tooling/cli/src/commands/init/templates/agent-skill';
import {
  type AuthoringId,
  configFile,
  dbFile,
  defaultSchemaPath,
  starterSchema,
  type TargetId,
} from '../../packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates';
import { quickReferenceMd } from '../../packages/1-framework/3-tooling/cli/src/commands/init/templates/quick-reference';
import {
  defaultTsConfig,
  mergeTsConfig,
} from '../../packages/1-framework/3-tooling/cli/src/commands/init/templates/tsconfig';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: scaffold.ts <baseDir> <target> <authoring> [schemaPath]');
  process.exit(64);
}
const [baseDirIn, targetIn, authoringIn, schemaPathIn] = args;
const baseDir = resolve(baseDirIn);
const target = targetIn as TargetId;
const authoring = authoringIn as AuthoringId;
const schemaPath = schemaPathIn ?? defaultSchemaPath(authoring);

console.log(
  `scaffold: baseDir=${baseDir} target=${target} authoring=${authoring} schemaPath=${schemaPath}`,
);

const schemaDir = dirname(schemaPath);
const configPath = `./${schemaPath}`;

const files = [
  { path: schemaPath, content: starterSchema(target, authoring) },
  { path: 'prisma-next.config.ts', content: configFile(target, configPath) },
  { path: join(schemaDir, 'db.ts'), content: dbFile(target) },
  {
    path: 'prisma-next.md',
    content: quickReferenceMd(target, authoring, schemaPath, 'pnpm prisma-next'),
  },
  {
    path: '.agents/skills/prisma-next/SKILL.md',
    content: agentSkillMd(target, authoring, schemaPath, 'pnpm prisma-next'),
  },
];

for (const file of files) {
  const fullPath = join(baseDir, file.path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, file.content, 'utf-8');
  console.log(`wrote ${file.path}`);
}

const tsconfigPath = join(baseDir, 'tsconfig.json');
if (existsSync(tsconfigPath)) {
  const existing = readFileSync(tsconfigPath, 'utf-8');
  writeFileSync(tsconfigPath, mergeTsConfig(existing), 'utf-8');
  console.log('updated tsconfig.json');
} else {
  writeFileSync(tsconfigPath, defaultTsConfig(), 'utf-8');
  console.log('wrote tsconfig.json');
}
