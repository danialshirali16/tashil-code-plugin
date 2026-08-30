import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const files = [
  { path: 'build/main.js', maxBytes: 500 * 1024, label: 'Plugin Main (Figma thread)' },
  { path: 'build/ui.js', maxBytes: 8 * 1024 * 1024, label: 'Plugin UI (Preact app)' },
];

let failed = false;
console.log('\n📦 Bundle Size Audit:');
console.log('--------------------------------------------------');

for (const file of files) {
  const fullPath = resolve(file.path);
  try {
    const fileStat = await stat(fullPath);
    const sizeKb = (fileStat.size / 1024).toFixed(2);
    const maxKb = (file.maxBytes / 1024).toFixed(0);
    const percentage = ((fileStat.size / file.maxBytes) * 100).toFixed(1);

    if (fileStat.size > file.maxBytes) {
      console.error(`❌ ${file.label} (${file.path}): ${sizeKb} KB exceeds budget of ${maxKb} KB (${percentage}%)`);
      failed = true;
    } else {
      console.log(`✅ ${file.label} (${file.path}): ${sizeKb} KB / ${maxKb} KB max (${percentage}%)`);
    }
  } catch (_error) {
    console.error(`❌ ${file.label} (${file.path}): File not found. Run "npm run build" first.`);
    failed = true;
  }
}

console.log('--------------------------------------------------\n');

if (failed) {
  process.exitCode = 1;
}
