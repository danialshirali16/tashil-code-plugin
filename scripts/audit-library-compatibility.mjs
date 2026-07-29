import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';
import {
  auditLibraryComponent,
  compareLibraryAuditToBaseline,
  discoverPublicComponentExports,
  summarizeLibraryCompatibility,
  SWISS_ARMY_KNIFE_COMPATIBILITY,
  validateLibraryCompatibilityManifest,
} from '../src/semantic/library-compatibility.ts';

const SOURCE_FILE_PATTERN = /\.tsx?$/i;
const IGNORED_SOURCE_PATTERN = /(?:\.stories|\.spec|\.test)\.tsx?$|^styles?\.tsx?$/i;

async function main() {
  const packageRoot = getPackageRoot(process.argv.slice(2));
  if (packageRoot === undefined) {
    throw new Error(
      'Provide --package-root <path> or set SWISS_ARMY_KNIFE_ROOT.',
    );
  }

  const sourceRoot = await resolveSourceRoot(packageRoot);
  const indexPath = join(sourceRoot, 'index.ts');
  const indexSource = await readFile(indexPath, 'utf8');
  const publicExports = discoverPublicComponentExports(indexSource, indexPath);
  const publicExportNames = publicExports.map(({ exportName }) => exportName);
  const issues = validateLibraryCompatibilityManifest(
    SWISS_ARMY_KNIFE_COMPATIBILITY,
    publicExportNames,
  );

  const moduleByExport = new Map(
    publicExports.map(({ exportName, moduleSpecifier }) => [
      exportName,
      moduleSpecifier,
    ]),
  );
  const sourceFilesByFolder = new Map();
  const audits = [];

  for (const compatibility of SWISS_ARMY_KNIFE_COMPATIBILITY) {
    const moduleSpecifier = moduleByExport.get(compatibility.exportName);
    if (moduleSpecifier !== undefined) {
      const discoveredFolder = moduleSpecifier.split('/')[2];
      if (discoveredFolder !== compatibility.sourceFolder) {
        issues.push(
          `${compatibility.exportName}: public module moved from `
          + `${compatibility.sourceFolder} to ${discoveredFolder ?? 'unknown'}.`,
        );
      }
    }

    const sourceCacheKey = `${compatibility.sourceFolder}|${moduleSpecifier ?? ''}`;
    let files = sourceFilesByFolder.get(sourceCacheKey);
    if (files === undefined) {
      files = await readComponentSourceFiles(
        sourceRoot,
        compatibility.sourceFolder,
        moduleSpecifier,
      );
      sourceFilesByFolder.set(sourceCacheKey, files);
    }
    if (files.length === 0) {
      issues.push(
        `${compatibility.exportName}: no auditable source files found in `
        + `components/${compatibility.sourceFolder}.`,
      );
    }

    const audit = auditLibraryComponent(compatibility, files);
    audits.push(audit);
    issues.push(...compareLibraryAuditToBaseline(compatibility, audit));
  }

  printReport(sourceRoot, audits, issues, process.argv.includes('--json'));
  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

function getPackageRoot(args) {
  const rootFlagIndex = args.indexOf('--package-root');
  if (rootFlagIndex >= 0) {
    return args[rootFlagIndex + 1];
  }
  return process.env.SWISS_ARMY_KNIFE_ROOT;
}

async function resolveSourceRoot(packageRoot) {
  const directIndex = join(packageRoot, 'index.ts');
  if (await isFile(directIndex)) {
    return packageRoot;
  }

  const nestedSourceRoot = join(packageRoot, 'src');
  if (await isFile(join(nestedSourceRoot, 'index.ts'))) {
    return nestedSourceRoot;
  }

  throw new Error(
    `Could not find src/index.ts below ${JSON.stringify(packageRoot)}.`,
  );
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readComponentSourceFiles(
  sourceRoot,
  sourceFolder,
  moduleSpecifier,
) {
  const componentRoot = join(sourceRoot, 'components', sourceFolder);
  const filePaths = new Set(await readSourceDirectory(componentRoot));

  if (moduleSpecifier !== undefined) {
    const modulePath = join(sourceRoot, moduleSpecifier.replace(/^\.\//, ''));
    for (const filePath of await resolveModuleSourceFiles(modulePath)) {
      filePaths.add(filePath);
    }
  }

  return Promise.all([...filePaths].sort().map(async (filePath) => ({
    contents: await readFile(filePath, 'utf8'),
    fileName: relative(sourceRoot, filePath),
  })));
}

async function readSourceDirectory(directoryPath) {
  let directoryEntries;
  try {
    directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const fileNames = directoryEntries
    .filter((directoryEntry) => (
      directoryEntry.isFile()
      && SOURCE_FILE_PATTERN.test(directoryEntry.name)
      && !IGNORED_SOURCE_PATTERN.test(directoryEntry.name)
    ))
    .map(({ name }) => name)
    .sort();

  return fileNames.map((fileName) => join(directoryPath, fileName));
}

async function resolveModuleSourceFiles(modulePath) {
  const directCandidates = [
    modulePath,
    `${modulePath}.ts`,
    `${modulePath}.tsx`,
  ];
  for (const candidate of directCandidates) {
    if (await isFile(candidate)) {
      return [candidate];
    }
  }
  return readSourceDirectory(modulePath);
}

function printReport(sourceRoot, audits, issues, json) {
  const summary = summarizeLibraryCompatibility();
  if (json) {
    console.log(JSON.stringify({ audits, issues, sourceRoot, summary }, null, 2));
    return;
  }
  console.log(`Swiss Army Knife compatibility audit: ${sourceRoot}`);
  console.log(
    `Exports: ${audits.length} total — ${summary.strong} strong, `
    + `${summary.partial} partial, ${summary.blocked} blocked, `
    + `${summary['not-applicable']} not applicable`,
  );

  if (issues.length === 0) {
    console.log('Result: PASS — package source matches the checked-in baseline.');
    return;
  }

  console.error(`Result: FAIL — ${issues.length} compatibility change(s):`);
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
