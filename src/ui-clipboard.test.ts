import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './ui-clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('copyToClipboard', () => {
  it('uses the async Clipboard API when it is available', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await copyToClipboard('const value = true;');

    expect(writeText).toHaveBeenCalledWith('const value = true;');
  });

  it('falls back to a temporary textarea', async () => {
    const textarea = {
      remove: vi.fn(),
      select: vi.fn(),
      style: { opacity: '', position: '' },
      value: '',
    };
    const append = vi.fn();
    const createElement = vi.fn(() => textarea);
    const execCommand = vi.fn(() => true);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {
      body: { append },
      createElement,
      execCommand,
    });

    await copyToClipboard('fallback value');

    expect(createElement).toHaveBeenCalledWith('textarea');
    expect(textarea.value).toBe('fallback value');
    expect(append).toHaveBeenCalledWith(textarea);
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalledOnce();
  });

  it('reports a failed fallback and still removes the textarea', async () => {
    const textarea = {
      remove: vi.fn(),
      select: vi.fn(),
      style: { opacity: '', position: '' },
      value: '',
    };
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => false),
    });

    await expect(copyToClipboard('value')).rejects.toThrow(/rejected/i);
    expect(textarea.remove).toHaveBeenCalledOnce();
  });
});
