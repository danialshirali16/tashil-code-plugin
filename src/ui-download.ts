/**
 * Trigger a browser download for a Blob from the UI iframe.
 *
 * Modeled on `src/ui-clipboard.ts`: the Figma main thread has no DOM, so any
 * file delivery to the user must originate here. The synthetic `<a>` is the
 * standard plugin pattern; we revoke the object URL promptly to avoid leaks.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.position = 'fixed';
  anchor.style.opacity = '0';
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // ponytail: revoke on a tick so the click has time to consume the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
