import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MAX_DESCRIPTION_LENGTH, runCheck, validateSkillMd } from './validate-skills.mjs';

const validSkill = `---
name: example-skill
description: >
  A short description that is safe for YAML and long enough to be meaningful
  without bare colons on the same line as mapping keys.
---

# Example
`;

describe('validateSkillMd', () => {
  it('passes valid frontmatter', () => {
    deepStrictEqual(validateSkillMd(validSkill), []);
  });

  it('fails when bare colons break YAML parsing', () => {
    const broken = `---
name: drive-discussion
description: Invoke when resolution: before/inside drive-specify-project (pre-spec).
---

# Discussion
`;
    const errors = validateSkillMd(broken);
    strictEqual(errors.length, 1);
    strictEqual(errors[0].startsWith('frontmatter parse error:'), true);
  });

  it('fails when description exceeds the agentskills limit', () => {
    const longDescription = 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1);
    const content = `---
name: long-desc
description: ${longDescription}
---

# Long
`;
    const errors = validateSkillMd(content);
    deepStrictEqual(errors, [
      `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${MAX_DESCRIPTION_LENGTH + 1}); use a folded block scalar (description: >) or shorten the text`,
    ]);
  });

  it('fails when frontmatter is missing', () => {
    deepStrictEqual(validateSkillMd('# No frontmatter\n'), ['missing frontmatter block']);
  });
});

describe('runCheck', () => {
  it('validates every skill under a skills directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-skills-'));
    const skillDir = join(root, 'skills-contrib', 'good-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), validSkill.replace('example-skill', 'good-skill'));

    deepStrictEqual(runCheck({ root }), []);
  });

  it('reports offences for broken skills in a directory tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'validate-skills-bad-'));
    const skillDir = join(root, 'skills-contrib', 'bad-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: bad-skill
description: broken yaml: this colon breaks parsing
---

# Bad
`,
    );

    const offences = runCheck({ root });
    strictEqual(offences.length, 1);
    strictEqual(offences[0].file, 'skills-contrib/bad-skill/SKILL.md');
    strictEqual(offences[0].errors[0].startsWith('frontmatter parse error:'), true);
  });
});
