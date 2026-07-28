const TOKEN_NAMESPACE = [
  'colors?',
  'spacing',
  'radius',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
].join('|');

const TOKEN_PATH_SOURCE = `(?:${TOKEN_NAMESPACE})(?:[./][A-Za-z0-9_-]+)*`;
const BARE_TOKEN_PATH = new RegExp(`^${TOKEN_PATH_SOURCE}$`, 'i');
const TOKEN_PATH_IN_VALUE = new RegExp(
  `(^|[^A-Za-z0-9_-])(${TOKEN_PATH_SOURCE})(?![A-Za-z0-9_-])`,
  'gi',
);

/**
 * Figma can return design-token paths without CSS syntax (for example
 * `spacing.0`). Convert known token paths into valid CSS custom-property
 * references, including each token in compound values such as
 * `spacing.6 spacing.12`; ordinary CSS values remain byte-identical.
 */
export function normalizeCssValue(value: string): string {
  const trimmed = value.trim();
  if (BARE_TOKEN_PATH.test(trimmed)) {
    return toCssVariable(trimmed);
  }

  TOKEN_PATH_IN_VALUE.lastIndex = 0;
  if (!TOKEN_PATH_IN_VALUE.test(value)) {
    return value;
  }

  TOKEN_PATH_IN_VALUE.lastIndex = 0;
  return value.replace(
    TOKEN_PATH_IN_VALUE,
    (_match, prefix: string, tokenPath: string) =>
      `${prefix}${toCssVariable(tokenPath)}`,
  );
}

function toCssVariable(tokenPath: string): string {
  const tokenName = tokenPath
    .split(/[./]+/)
    .filter(Boolean)
    .map((segment) => segment
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .toLowerCase())
    .join('-');
  return `var(--${tokenName})`;
}
