import type { SourceFileInput } from './source-schema';

export const SOURCE_UPLOAD_LIMITS = {
  maxFileCharacters: 1_000_000,
  maxFiles: 512,
  maxTotalCharacters: 8_000_000,
} as const;

export type SourceUploadFile = {
  name: string;
  size: number;
  text: () => Promise<string>;
  webkitRelativePath?: string;
};

export type CollectSourceUploadResult =
  | {
      ignoredFileCount: number;
      inputs: SourceFileInput[];
      ok: true;
    }
  | {
      message: string;
      ok: false;
    };

const SOURCE_FILE_PATTERN = /\.tsx?$/i;

export async function collectSourceUploadInputs(
  files: readonly SourceUploadFile[],
): Promise<CollectSourceUploadResult> {
  const sourceFiles = files.filter((file) => SOURCE_FILE_PATTERN.test(file.name));
  if (sourceFiles.length === 0) {
    return {
      message: 'Choose a folder or files containing .ts, .tsx, or .d.ts source.',
      ok: false,
    };
  }
  if (sourceFiles.length > SOURCE_UPLOAD_LIMITS.maxFiles) {
    return {
      message: `The source selection contains ${sourceFiles.length} TypeScript files; `
        + `the limit is ${SOURCE_UPLOAD_LIMITS.maxFiles}. Choose a smaller component `
        + 'folder or prepared declaration bundle.',
      ok: false,
    };
  }

  const inputs: SourceFileInput[] = [];
  const seenPaths = new Set<string>();
  let totalCharacters = 0;
  for (const file of sourceFiles) {
    const fileName = normalizeUploadPath(file.webkitRelativePath || file.name);
    if (!fileName) {
      return {
        message: `The selected path for ${JSON.stringify(file.name)} is not safe.`,
        ok: false,
      };
    }
    if (seenPaths.has(fileName)) {
      return {
        message: `Two selected files resolve to ${JSON.stringify(fileName)}. `
          + 'Choose their containing folder so relative paths stay unique.',
        ok: false,
      };
    }
    seenPaths.add(fileName);

    if (file.size > SOURCE_UPLOAD_LIMITS.maxFileCharacters) {
      return {
        message: `${JSON.stringify(fileName)} exceeds the per-file source limit.`,
        ok: false,
      };
    }
    const contents = await file.text();
    if (contents.length > SOURCE_UPLOAD_LIMITS.maxFileCharacters) {
      return {
        message: `${JSON.stringify(fileName)} exceeds the per-file source limit.`,
        ok: false,
      };
    }
    totalCharacters += contents.length;
    if (totalCharacters > SOURCE_UPLOAD_LIMITS.maxTotalCharacters) {
      return {
        message: `The selected TypeScript source exceeds the total `
          + `${SOURCE_UPLOAD_LIMITS.maxTotalCharacters.toLocaleString()}-character limit.`,
        ok: false,
      };
    }
    inputs.push({ contents, fileName });
  }

  inputs.sort((left, right) => left.fileName.localeCompare(right.fileName));
  return {
    ignoredFileCount: files.length - sourceFiles.length,
    inputs,
    ok: true,
  };
}

export function configureDirectoryInput(
  input: HTMLInputElement | null,
): void {
  if (input) {
    input.setAttribute('directory', '');
    input.setAttribute('webkitdirectory', '');
  }
}

function normalizeUploadPath(fileName: string): string | undefined {
  const normalized = fileName.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (
    normalized.startsWith('/')
    || normalized.split('/').some((segment) => segment === '..')
  ) {
    return undefined;
  }
  const segments = normalized.split('/').filter(
    (segment) => segment !== '' && segment !== '.',
  );
  return segments.length > 0 ? segments.join('/') : undefined;
}
