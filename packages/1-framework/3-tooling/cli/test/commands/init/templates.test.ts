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

const TEMPLATES_DIR = join(import.meta.dirname, '../../../src/commands/init/templates');

function extractPlaceholders(templateFile: string): Set<string> {
  const content = readFileSync(join(TEMPLATES_DIR, templateFile), 'utf-8');
  return new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
}

describe('templates', () => {
  describe('starterSchema', () => {
    it('contains User and Post models for postgres', () => {
      const schema = starterSchema('postgres');

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
      expect(schema).toContain('@default(autoincrement())');
    });

    it('includes a relation between User and Post for postgres', () => {
      const schema = starterSchema('postgres');

      expect(schema).toContain('posts     Post[]');
      expect(schema).toContain('author    User');
    });

    it('uses ObjectId ids for mongo', () => {
      const schema = starterSchema('mongo');

      expect(schema).toContain('model User');
      expect(schema).toContain('model Post');
      expect(schema).toContain('ObjectId @id @map("_id")');
      expect(schema).not.toContain('autoincrement');
    });

    it('includes @@map collection names for mongo', () => {
      const schema = starterSchema('mongo');

      expect(schema).toContain('@@map("users")');
      expect(schema).toContain('@@map("posts")');
    });
  });

  describe('configFile', () => {
    it('generates postgres config with dotenv and single import from facade', () => {
      const config = configFile('postgres', './prisma/contract.prisma');

      expect(config).toContain("import 'dotenv/config'");
      expect(config).toContain("from '@prisma-next/postgres/config'");
      expect(config).toContain("contract: './prisma/contract.prisma'");
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

    it('generates mongo db.ts with single @prisma-next import', () => {
      const db = dbFile('mongo');

      expect(db).toContain("from '@prisma-next/mongo/runtime'");
      expect(db).toContain('mongo<Contract>({ contractJson })');
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
      const md = quickReferenceMd('postgres', 'prisma/contract.prisma');

      expect(md).toContain('prisma/contract.prisma');
      expect(md).toContain('prisma/contract.json');
      expect(md).toContain('prisma/db.ts');
      expect(md).toContain('prisma-next.config.ts');
    });

    it('contains postgres-specific content', () => {
      const md = quickReferenceMd('postgres', 'prisma/contract.prisma');

      expect(md).toContain('PostgreSQL');
      expect(md).toContain('@prisma-next/postgres');
      expect(md).toContain('autoincrement()');
      expect(md).toContain('postgresql://');
    });

    it('contains ORM query example for postgres', () => {
      const md = quickReferenceMd('postgres', 'prisma/contract.prisma');

      expect(md).toContain('db.orm.User');
      expect(md).toContain('.where(');
      expect(md).toContain('.first()');
    });

    it('contains common commands', () => {
      const md = quickReferenceMd('postgres', 'prisma/contract.prisma');

      expect(md).toContain('contract emit');
      expect(md).toContain('db init');
    });

    it('contains mongo-specific content', () => {
      const md = quickReferenceMd('mongo', 'prisma/contract.prisma');

      expect(md).toContain('MongoDB');
      expect(md).toContain('@prisma-next/mongo');
      expect(md).toContain('ObjectId');
      expect(md).toContain('mongodb://');
    });

    it('contains ORM query example for mongo', () => {
      const md = quickReferenceMd('mongo', 'prisma/contract.prisma');

      expect(md).toContain('db.connect(');
      expect(md).toContain('client.orm.User');
    });
  });

  describe('agentSkillMd', () => {
    it('contains file locations for postgres', () => {
      const md = agentSkillMd('postgres', 'prisma/contract.prisma');

      expect(md).toContain('prisma/contract.prisma');
      expect(md).toContain('prisma/db.ts');
      expect(md).toContain('prisma-next.config.ts');
    });

    it('contains postgres-specific query pattern', () => {
      const md = agentSkillMd('postgres', 'prisma/contract.prisma');

      expect(md).toContain('PostgreSQL');
      expect(md).toContain('@prisma-next/postgres');
      expect(md).toContain('db.sql');
      expect(md).toContain('.from(');
    });

    it('contains common commands', () => {
      const md = agentSkillMd('postgres', 'prisma/contract.prisma');

      expect(md).toContain('contract emit');
      expect(md).toContain('db init');
    });

    it('contains mongo-specific query pattern', () => {
      const md = agentSkillMd('mongo', 'prisma/contract.prisma');

      expect(md).toContain('MongoDB');
      expect(md).toContain('@prisma-next/mongo');
      expect(md).toContain('db.connect(');
      expect(md).toContain('client.orm.User');
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
