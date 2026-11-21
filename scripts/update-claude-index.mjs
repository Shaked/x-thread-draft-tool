import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const claudePath = join(root, 'CLAUDE.md');
const skillsDir = join(root, '.claude', 'skills');
const featuresDir = join(root, 'docs', 'features');

function listMdFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

function titleFor(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const first = content.split('\n').find((l) => l.startsWith('# '));
  if (first) return first.replace(/^#\s+/, '').trim();
  const parts = filePath.split('/');
  return parts.at(-1) === 'SKILL.md' ? parts.at(-2) : parts.at(-1);
}

function rel(pathAbs) {
  return pathAbs.replace(root + '/', '');
}

const featureFiles = listMdFiles(featuresDir).filter((f) => f !== 'index.md');
// A skill is a flat `<name>.md` file or a `<name>/SKILL.md` folder (the folder form holds templates).
const skillFiles = [
  ...listMdFiles(skillsDir),
  ...readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, 'SKILL.md'))).map((d) => join(d.name, 'SKILL.md'))
].sort();

const now = new Date();
const ts = now.toISOString().replace('T', ' ').replace('Z', ' UTC');

const featureLines = featureFiles.map((f) => {
  const abs = join(featuresDir, f);
  const title = titleFor(abs);
  const path = rel(abs);
  return `- ${title}: [\`${path}\`](./${path})`;
});

const skillLines = skillFiles.map((f) => {
  const abs = join(skillsDir, f);
  const title = titleFor(abs);
  const path = rel(abs);
  return `- ${title}: [\`${path}\`](./${path})`;
});

const block = [
  '<!-- AUTO-INDEX:START -->',
  `_Last refreshed: ${ts}_`,
  '',
  '## Feature Index (auto-generated, use directly)',
  ...featureLines,
  '',
  '## Auto Skill Map (use directly)',
  ...skillLines,
  '<!-- AUTO-INDEX:END -->'
].join('\n');

const current = readFileSync(claudePath, 'utf8');
const start = '<!-- AUTO-INDEX:START -->';
const end = '<!-- AUTO-INDEX:END -->';
if (!current.includes(start) || !current.includes(end)) {
  throw new Error('CLAUDE.md missing AUTO-INDEX markers');
}
const blockPattern = new RegExp(`${start}[\\s\\S]*?${end}`);
// Keep the old timestamp when nothing else in the index changed, so a refresh leaves the file
// untouched and commits do not pick up a timestamp-only diff.
const withoutStamp = (text) => text.replace(/_Last refreshed: [^_]*_/, '');
if (withoutStamp(current.match(blockPattern)[0]) !== withoutStamp(block)) {
  writeFileSync(claudePath, current.replace(blockPattern, block));
}
