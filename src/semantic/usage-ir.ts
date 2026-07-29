/**
 * Typed component-usage value IR and deterministic formatting.
 *
 * The resolver assembles every target value as structured data first; JSX
 * strings are produced only here, with validated identifiers and escaped
 * values — never by string concatenation of user input. Formatting is
 * deterministic and needs no runtime Prettier.
 */

import type { SourcePropValue } from '../types';
import { formatPropValue, isPropIdentifier } from '../codegen';

const COMPONENT_IDENTIFIER_PATTERN = /^[A-Z_$][A-Za-z0-9_$]*$/;

export type UsageValue =
  | { kind: 'literal'; value: SourcePropValue }
  /** Ordered component/value expressions for repeated slots and collections. */
  | { kind: 'array'; items: UsageValue[] }
  /** Ordered fields keep output deterministic and binding-order stable. */
  | { kind: 'object'; fields: Array<{ name: string; value: UsageValue }> }
  /** A connected component rendered as a prop value, e.g. `icon={<Icon name="trash" />}`. */
  | {
      kind: 'component';
      componentName: string;
      props?: Array<{ name: string; value: UsageValue }>;
      /**
       * A child connection may already have resolved its complete component
       * usage. This remains internal generated JSX, never persisted input.
       */
      renderedJsx?: string;
    }
  | { identifier: string; kind: 'runtime'; note?: string };

export const DEFAULT_RUNTIME_NOTE = 'Set in application.';

/**
 * Format one prop assignment, or null when the value is omitted (boolean
 * false literals follow the existing codegen convention of omission).
 */
export function formatUsageProp(name: string, value: UsageValue): string | null {
  if (!isPropIdentifier(name)) {
    throw new TypeError(`Invalid JSX prop identifier: ${JSON.stringify(name)}`);
  }

  if (value.kind === 'literal') {
    if (value.value === false) {
      return null;
    }
    if (value.value === true) {
      return name;
    }
    return `${name}=${formatPropValue(value.value)}`;
  }

  if (value.kind === 'runtime') {
    assertRuntimeIdentifier(value.identifier);
    return `${name}={${value.identifier} /* ${sanitizeComment(value.note ?? DEFAULT_RUNTIME_NOTE)} */}`;
  }

  if (value.kind === 'component') {
    return `${name}={${formatComponentElement(value)}}`;
  }

  if (value.kind === 'array') {
    return value.items.length === 0
      ? null
      : `${name}={${formatArrayLiteral(value)}}`;
  }

  if (value.fields.length === 0) {
    return null;
  }

  return `${name}={${formatObjectLiteral(value)}}`;
}

function formatObjectLiteral(value: Extract<UsageValue, { kind: 'object' }>): string {
  const fields = value.fields.map(({ name, value: fieldValue }) => {
    if (!isPropIdentifier(name)) {
      throw new TypeError(`Invalid object key: ${JSON.stringify(name)}`);
    }
    return `${name}: ${formatExpression(fieldValue)}`;
  });

  return `{ ${fields.join(', ')} }`;
}

function formatExpression(value: UsageValue): string {
  if (value.kind === 'literal') {
    return typeof value.value === 'string'
      ? JSON.stringify(value.value)
      : String(value.value);
  }

  if (value.kind === 'runtime') {
    assertRuntimeIdentifier(value.identifier);
    return `${value.identifier} /* ${sanitizeComment(value.note ?? DEFAULT_RUNTIME_NOTE)} */`;
  }

  if (value.kind === 'component') {
    return formatComponentElement(value);
  }

  if (value.kind === 'array') {
    return formatArrayLiteral(value);
  }

  return formatObjectLiteral(value);
}

function formatArrayLiteral(value: Extract<UsageValue, { kind: 'array' }>): string {
  return `[${value.items.map(formatExpression).join(', ')}]`;
}

/** Render a connected component as a self-closing element, validated. */
function formatComponentElement(
  value: Extract<UsageValue, { kind: 'component' }>,
): string {
  const { componentName, props = [], renderedJsx } = value;
  if (!COMPONENT_IDENTIFIER_PATTERN.test(componentName)) {
    throw new TypeError(`Invalid component identifier: ${JSON.stringify(componentName)}`);
  }
  if (renderedJsx !== undefined) {
    const expectedPrefix = `<${componentName}`;
    if (!renderedJsx.startsWith(expectedPrefix) || !renderedJsx.endsWith('/>')) {
      throw new TypeError(`Invalid generated component JSX for ${JSON.stringify(componentName)}.`);
    }
    return renderedJsx;
  }
  const formattedProps = props
    .map(({ name, value: propValue }) => formatUsageProp(name, propValue))
    .filter((formatted): formatted is string => formatted !== null);
  return formattedProps.length === 0
    ? `<${componentName} />`
    : `<${componentName} ${formattedProps.join(' ')} />`;
}

/** Keep authored notes from breaking out of the block comment. */
function sanitizeComment(note: string): string {
  return note.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ').trim();
}

function assertRuntimeIdentifier(identifier: string): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)) {
    throw new TypeError(`Invalid runtime identifier: ${JSON.stringify(identifier)}`);
  }
}
