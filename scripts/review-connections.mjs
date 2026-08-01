import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { reviewConnectionManifest } from '../src/ci-manifest.ts';

const args = process.argv.slice(2);
const exportPath = flag('--connections');
const sourceRoot = flag('--source-root');
if (!exportPath || !sourceRoot) throw new Error('Usage: npm run review:connections -- --connections <export.json> --source-root <directory> [--json]');
const root = resolve(sourceRoot);
const raw = await readFile(resolve(exportPath), 'utf8');
const report = await reviewConnectionManifest(raw, async (savedPath) => {
  const target = resolve(root, savedPath);
  const relativeTarget = relative(root, target);
  if (isAbsolute(relativeTarget) || relativeTarget === '..' || relativeTarget.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) return undefined;
  let targetStat;
  try { targetStat = await stat(target); } catch { return undefined; }
  const directory = targetStat.isDirectory() ? target : dirname(target);
  const names = (await readdir(directory)).filter((name) => /\.tsx?$/i.test(name)).sort();
  return Promise.all(names.map(async (name) => ({ contents: await readFile(join(directory, name), 'utf8'), fileName: name })));
});

if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Tashil connection review: ${report.ok ? 'PASS' : 'FAIL'}`);
  for (const entry of report.entries) console.log(`${entry.status.toUpperCase()} ${entry.componentName}: ${entry.message}`);
}
if (!report.ok) process.exitCode = 1;
function flag(name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
