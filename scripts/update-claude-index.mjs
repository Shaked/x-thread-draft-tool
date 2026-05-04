import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const claudePath = join(root, 'claude.md');
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
  return first ? first.replace(/^#\s+/, '').trim() : filePath.split('/').pop();
}

function rel(pathAbs) {
  return pathAbs.replace(root + '/', '');
}

const featureFiles = listMdFiles(featuresDir).filter((f) => f !== 'index.md');
const skillFiles = listMdFiles(skillsDir);

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
  throw new Error('claude.md missing AUTO-INDEX markers');
}
const updated = current.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block);
writeFileSync(claudePath, updated);
