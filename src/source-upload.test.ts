import { describe, expect, it } from 'vitest';
import {
  collectSourceUploadInputs,
  SOURCE_UPLOAD_LIMITS,
  type SourceUploadFile,
} from './source-upload';

function sourceFile(
  name: string,
  contents: string,
  webkitRelativePath = '',
): SourceUploadFile {
  return {
    name,
    size: contents.length,
    text: async () => contents,
    webkitRelativePath,
  };
}

describe('collectSourceUploadInputs', () => {
  it('preserves folder paths, ignores unrelated files, and sorts inputs', async () => {
    const result = await collectSourceUploadInputs([
      sourceFile('README.md', 'ignored', 'project/README.md'),
      sourceFile('index.d.ts', 'export type ReactNode = unknown;', 'project/node_modules/@types/react/index.d.ts'),
      sourceFile('button.tsx', 'export interface ButtonProps {}', 'project/src/button.tsx'),
    ]);

    expect(result).toEqual({
      ignoredFileCount: 1,
      inputs: [
        {
          contents: 'export type ReactNode = unknown;',
          fileName: 'project/node_modules/@types/react/index.d.ts',
        },
        {
          contents: 'export interface ButtonProps {}',
          fileName: 'project/src/button.tsx',
        },
      ],
      ok: true,
    });
  });

  it('rejects flattened duplicate paths', async () => {
    const result = await collectSourceUploadInputs([
      sourceFile('index.ts', 'export const first = true;'),
      sourceFile('index.ts', 'export const second = true;'),
    ]);

    expect(result).toMatchObject({
      message: expect.stringContaining('relative paths stay unique'),
      ok: false,
    });
  });

  it('rejects traversal paths', async () => {
    const result = await collectSourceUploadInputs([
      sourceFile('types.ts', 'export type Value = string;', '../types.ts'),
    ]);

    expect(result).toMatchObject({
      message: expect.stringContaining('is not safe'),
      ok: false,
    });
  });

  it('stops before reading a selection over the file-count limit', async () => {
    let reads = 0;
    const files = Array.from(
      { length: SOURCE_UPLOAD_LIMITS.maxFiles + 1 },
      (_, index): SourceUploadFile => ({
        name: `file-${index}.ts`,
        size: 1,
        text: async () => {
          reads += 1;
          return 'x';
        },
      }),
    );

    const result = await collectSourceUploadInputs(files);

    expect(result).toMatchObject({
      message: expect.stringContaining(`limit is ${SOURCE_UPLOAD_LIMITS.maxFiles}`),
      ok: false,
    });
    expect(reads).toBe(0);
  });

  it('rejects a source file over the per-file limit before reading it', async () => {
    let read = false;
    const result = await collectSourceUploadInputs([{
      name: 'huge.ts',
      size: SOURCE_UPLOAD_LIMITS.maxFileCharacters + 1,
      text: async () => {
        read = true;
        return '';
      },
    }]);

    expect(result).toMatchObject({
      message: expect.stringContaining('per-file source limit'),
      ok: false,
    });
    expect(read).toBe(false);
  });
});
