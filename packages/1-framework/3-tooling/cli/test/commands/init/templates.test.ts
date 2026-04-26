import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  agentSkillMd,
  variables as agentSkillVars,
} from '../../../src/commands/init/templates/agent-skill';
import {
  configFile,
  dbFile,
  starterSchema,
  targetPackageName,
} from '../../../src/commands/init/templates/code-templates';
import {
  quickReferenceMd,
  variables as quickRefVars,
} from '../../../src/commands/init/templates/quick-reference';
import {
  defaultTsConfig,
  mergeTsConfig,
  REQUIRED_COMPILER_OPTIONS,
} from '../../../src/commands/init/templates/tsconfig';

const TEMPLATES_DIR = join(import.meta.dirname, '../../../src/commands/init/templates');

function extractPlaceholders(templateFile: string): Set<string> {
  const content = readFileSync(join(TEMPLATES_DIR, templateFile), 'utf-8');
  return new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? ''));
}

describe('templates', () => {
  describe('starterSchema', () => {
    it('contains User and Post models for postgres PSL', () => {
      const schema = starterSchema('postgres', 'psl');

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
      expect(schema).toContain('@default(autoincrement())');
    });

    it('includes a relation between User and Post for postgres PSL', () => {
      const schema = starterSchema('postgres', 'psl');

      expect(schema).toContain('posts     Post[]');
      expect(schema).toContain('author    User');
    });

    it('uses ObjectId ids for mongo PSL', () => {
      const schema = starterSchema('mongo', 'psl');

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
      expect(schema).toContain('ObjectId @id @map("_id")');
      expect(schema).not.toContain('autoincrement');
    });

    it('includes @@map collection names for mongo PSL', () => {
      const schema = starterSchema('mongo', 'psl');

      expect(schema).toContain('@@map("users")');
      expect(schema).toContain('@@map("posts")');
    });

    it('uses defineContract for postgres TypeScript', () => {
      const schema = starterSchema('postgres', 'typescript');

      expect(schema).toContain('defineContract');
      expect(schema).toContain("from '@prisma-next/sql-contract-ts/contract-builder'");
    });

    it('uses defineContract for mongo TypeScript', () => {
      const schema = starterSchema('mongo', 'typescript');

      expect(schema).toContain('defineContract');
      expect(schema).toContain("from '@prisma-next/mongo-contract-ts/contract-builder'");
    });
  });

  describe('configFile', () => {
    it('generates postgres config with dotenv and single import from facade', () => {
      const config = configFile('postgres', './prisma/contract.prisma');

      expect(config).toContain("import 'dotenv/config'");
      expect(config).toContain("from '@prisma-next/postgres/config'");
      expect(config).toContain('contract: "./prisma/contract.prisma"');
      const importLines = config.split('\n').filter((l) => l.includes("from '@prisma-next/"));
      expect(importLines).toHaveLength(1);
    });

    it('generates mongo config with dotenv and single import from facade', () => {
      const config = configFile('mongo', './prisma/contract.prisma');

      expect(config).toContain("import 'dotenv/config'");
      expect(config).toContain("from '@prisma-next/mongo/config'");
      const importLines = config.split('\n').filter((l) => l.includes("from '@prisma-next/"));
      expect(importLines).toHaveLength(1);
    });
  });

  describe('dbFile', () => {
    it('generates postgres db.ts with single @prisma-next import', () => {
      const db = dbFile('postgres');

      expect(db).toContain("from '@prisma-next/postgres/runtime'");
      const prismaNextImports = db.split('\n').filter((l) => l.includes("from '@prisma-next/"));
      expect(prismaNextImports).toHaveLength(1);
    });

    it('generates mongo db.ts with lazy facade and DATABASE_URL binding', () => {
      const db = dbFile('mongo');

      expect(db).toContain("from '@prisma-next/mongo/runtime'");
      expect(db).toContain('mongo<Contract>({');
      expect(db).toContain('contractJson,');
      expect(db).toContain("url: process.env['DATABASE_URL']!,");
      expect(db).not.toContain('await db.connect');
      const prismaNextImports = db.split('\n').filter((l) => l.includes("from '@prisma-next/"));
      expect(prismaNextImports).toHaveLength(1);
    });
  });

  describe('targetPackageName', () => {
    it('returns postgres package name', () => {
      expect(targetPackageName('postgres')).toBe('@prisma-next/postgres');
    });

    it('returns mongo package name', () => {
      expect(targetPackageName('mongo')).toBe('@prisma-next/mongo');
    });
  });

  describe('quickReferenceMd', () => {
    it('contains file locations for postgres', () => {
      const md = quickReferenceMd('postgres', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('prisma/contract.prisma');
      expect(md).toContain('prisma/contract.json');
      expect(md).toContain('prisma/db.ts');
      expect(md).toContain('prisma-next.config.ts');
    });

    it('contains postgres-specific content', () => {
      const md = quickReferenceMd('postgres', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('PostgreSQL');
      expect(md).toContain('@prisma-next/postgres');
      expect(md).toContain('autoincrement()');
      expect(md).toContain('postgresql://');
    });

    it('contains ORM query example for postgres', () => {
      const md = quickReferenceMd('postgres', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('db.orm.User');
      expect(md).toContain('.where(');
      expect(md).toContain('.first()');
    });

    it('contains common commands', () => {
      const md = quickReferenceMd('postgres', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('contract emit');
      expect(md).toContain('db init');
    });

    it('contains mongo-specific content', () => {
      const md = quickReferenceMd('mongo', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('MongoDB');
      expect(md).toContain('@prisma-next/mongo');
      expect(md).toContain('ObjectId');
      expect(md).toContain('mongodb://');
    });

    it('contains lazy ORM query example for mongo (no manual connect step)', () => {
      const md = quickReferenceMd('mongo', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('db.orm.users');
      expect(md).toContain('.where({ email:');
      expect(md).toContain('.first()');
      expect(md).not.toContain('await db.connect(');
      expect(md).not.toContain('client.orm.User');
    });

    it('documents the replica-set requirement for transactions and change streams', () => {
      const md = quickReferenceMd('mongo', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('replica set');
      expect(md).toContain('TML-2313');
    });

    it('documents the escape hatches and steers users away from db.runtime() for mongo', () => {
      const md = quickReferenceMd('mongo', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('db.query');
      expect(md).toContain('mongoClient');
      expect(md).not.toMatch(/drop down[^\n]*via `db\.runtime\(\)`/);
      expect(md).not.toMatch(/use `db\.runtime\(\)`[^.\n]*if you need transactions/i);
    });
  });

  describe('agentSkillMd', () => {
    it('contains file locations for postgres', () => {
      const md = agentSkillMd('postgres', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('prisma/contract.prisma');
      expect(md).toContain('prisma/db.ts');
      expect(md).toContain('prisma-next.config.ts');
    });

    it('uses ORM query pattern for postgres', () => {
      const md = agentSkillMd('postgres', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('PostgreSQL');
      expect(md).toContain('@prisma-next/postgres');
      expect(md).toContain('db.orm.User');
      expect(md).toContain('.first()');
      expect(md).toContain('Use `db.orm` for queries');
    });

    it('contains commands including migration operations', () => {
      const md = agentSkillMd('postgres', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('contract emit');
      expect(md).toContain('db init');
      expect(md).toContain('db update');
      expect(md).toContain('migration plan');
      expect(md).toContain('migration apply');
      expect(md).toContain('migration status');
    });

    it('contains rules and workflow guidance', () => {
      const md = agentSkillMd('postgres', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('Never hand-edit');
      expect(md).toContain('Use `db.orm` for queries');
      expect(md).toContain('Workflow for common tasks');
    });

    it('uses lazy ORM pattern with lowercased plural roots for mongo', () => {
      const md = agentSkillMd('mongo', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('MongoDB');
      expect(md).toContain('@prisma-next/mongo');
      expect(md).toContain('db.orm.users');
      expect(md).toContain('db.orm.posts');
      expect(md).toContain('.first()');
      expect(md).not.toContain('db.sql');
      expect(md).not.toContain('db.orm.User');
    });

    it('documents replica-set requirement and lazy connection for mongo', () => {
      const md = agentSkillMd('mongo', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('replica set');
      expect(md).toContain('connects lazily');
    });

    it('documents the escape hatches and steers users away from db.runtime() for mongo', () => {
      const md = agentSkillMd('mongo', 'prisma/contract.prisma', 'pnpm prisma-next');

      expect(md).toContain('db.query');
      expect(md).toContain('mongoClient');
      expect(md).toContain('Escape hatches');
      expect(md).not.toMatch(/drop down[^\n]*via `db\.runtime\(\)`/);
      expect(md).not.toMatch(/`db\.runtime\(\)`[^\n]*only when the ORM/);
    });
  });

  describe('tsconfig', () => {
    describe('defaultTsConfig', () => {
      it('includes all required compiler options', () => {
        const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
        const opts = config['compilerOptions'] as Record<string, unknown>;

        for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
          expect(opts[key]).toBe(value);
        }
      });

      it('sets strict: true', () => {
        const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
        const opts = config['compilerOptions'] as Record<string, unknown>;

        expect(opts['strict']).toBe(true);
      });

      it('sets skipLibCheck: true', () => {
        const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
        const opts = config['compilerOptions'] as Record<string, unknown>;

        expect(opts['skipLibCheck']).toBe(true);
      });

      it('produces valid JSON', () => {
        expect(() => JSON.parse(defaultTsConfig())).not.toThrow();
      });
    });

    describe('mergeTsConfig', () => {
      it('adds required options to an empty compilerOptions', () => {
        const existing = JSON.stringify({ compilerOptions: {} }, null, 2);
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;
        const opts = merged['compilerOptions'] as Record<string, unknown>;

        for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
          expect(opts[key]).toBe(value);
        }
      });

      it('preserves existing non-conflicting options', () => {
        const existing = JSON.stringify(
          { compilerOptions: { outDir: './dist', strict: true, declaration: true } },
          null,
          2,
        );
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;
        const opts = merged['compilerOptions'] as Record<string, unknown>;

        expect(opts['outDir']).toBe('./dist');
        expect(opts['strict']).toBe(true);
        expect(opts['declaration']).toBe(true);
      });

      it('overrides conflicting options with required values', () => {
        const existing = JSON.stringify(
          {
            compilerOptions: {
              module: 'commonjs',
              moduleResolution: 'node',
              resolveJsonModule: false,
            },
          },
          null,
          2,
        );
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;
        const opts = merged['compilerOptions'] as Record<string, unknown>;

        expect(opts['module']).toBe('preserve');
        expect(opts['moduleResolution']).toBe('bundler');
        expect(opts['resolveJsonModule']).toBe(true);
      });

      it('preserves non-compilerOptions fields', () => {
        const existing = JSON.stringify(
          {
            compilerOptions: { strict: true },
            include: ['src/**/*.ts'],
            exclude: ['node_modules'],
          },
          null,
          2,
        );
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;

        expect(merged['include']).toEqual(['src/**/*.ts']);
        expect(merged['exclude']).toEqual(['node_modules']);
      });

      it('creates compilerOptions if missing', () => {
        const existing = JSON.stringify({ include: ['src'] }, null, 2);
        const merged = JSON.parse(mergeTsConfig(existing)) as Record<string, unknown>;
        const opts = merged['compilerOptions'] as Record<string, unknown>;

        for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
          expect(opts[key]).toBe(value);
        }
        expect(merged['include']).toEqual(['src']);
      });

      it('produces valid JSON', () => {
        const existing = JSON.stringify({ compilerOptions: { target: 'ES2020' } }, null, 2);
        expect(() => JSON.parse(mergeTsConfig(existing))).not.toThrow();
      });
    });
  });

  describe('template variable consistency', () => {
    it('quick-reference-postgres.md placeholders match declared variables', () => {
      const mdVars = extractPlaceholders('quick-reference-postgres.md');
      expect(mdVars).toEqual(new Set(quickRefVars));
    });

    it('quick-reference-mongo.md placeholders match declared variables', () => {
      const mdVars = extractPlaceholders('quick-reference-mongo.md');
      expect(mdVars).toEqual(new Set(quickRefVars));
    });

    it('agent-skill-postgres.md placeholders match declared variables', () => {
      const mdVars = extractPlaceholders('agent-skill-postgres.md');
      expect(mdVars).toEqual(new Set(agentSkillVars));
    });

    it('agent-skill-mongo.md placeholders match declared variables', () => {
      const mdVars = extractPlaceholders('agent-skill-mongo.md');
      expect(mdVars).toEqual(new Set(agentSkillVars));
    });
  });
});
