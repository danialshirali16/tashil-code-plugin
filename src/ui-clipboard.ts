export async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';

  try {
    document.body.append(textarea);
    textarea.select();

    if (!document.execCommand('copy')) {
      throw new Error('The browser rejected the clipboard copy command.');
    }
  } finally {
    textarea.remove();
  }
}
