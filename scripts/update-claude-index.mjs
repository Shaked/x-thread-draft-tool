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

const start = '<!-- AUTO-INDEX:START -->';
const end = '<!-- AUTO-INDEX:END -->';

const current = readFileSync(claudePath, 'utf8');
if (!current.includes(start) || !current.includes(end)) {
  throw new Error('claude.md missing AUTO-INDEX markers');
}

const blockBodyLines = [
  '## Feature Index (auto-generated, use directly)',
  ...featureLines,
  '',
  '## Auto Skill Map (use directly)',
  ...skillLines
];
const blockBody = blockBodyLines.join('\n');

// Re-use the existing timestamp when nothing in the indexed content has
// changed. This avoids dirtying claude.md on every pre-commit run, which
// would leave the working tree dirty immediately after commit.
const blockRegex = new RegExp(`${start}[\\s\\S]*?${end}`);
const existingMatch = current.match(blockRegex);
const existingTs = existingMatch
  ? (existingMatch[0].match(/_Last refreshed: ([^_]+)_/) || [])[1]
  : null;
const existingBody = existingMatch
  ? existingMatch[0]
      .replace(start, '')
      .replace(end, '')
      .replace(/_Last refreshed: [^_]+_\n?/, '')
      .replace(/^\s+|\s+$/g, '')
  : null;

const ts =
  existingTs && existingBody === blockBody
    ? existingTs
    : new Date().toISOString().replace('T', ' ').replace('Z', ' UTC');

const block = [
  start,
  `_Last refreshed: ${ts}_`,
  '',
  ...blockBodyLines,
  end
].join('\n');

const updated = current.replace(blockRegex, block);
if (updated !== current) {
  writeFileSync(claudePath, updated);
}
