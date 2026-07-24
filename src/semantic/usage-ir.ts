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
  /** Ordered fields keep output deterministic and binding-order stable. */
  | { kind: 'object'; fields: Array<{ name: string; value: UsageValue }> }
  /** A connected component rendered as a prop value, e.g. `icon={<Icon />}`. */
  | { kind: 'component'; componentName: string }
  | { kind: 'runtime'; note?: string };

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
    return `${name}={undefined /* ${sanitizeComment(value.note ?? DEFAULT_RUNTIME_NOTE)} */}`;
  }

  if (value.kind === 'component') {
    return `${name}={${formatComponentElement(value.componentName)}}`;
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
    return `undefined /* ${sanitizeComment(value.note ?? DEFAULT_RUNTIME_NOTE)} */`;
  }

  if (value.kind === 'component') {
    return formatComponentElement(value.componentName);
  }

  return formatObjectLiteral(value);
}

/** Render a connected component as a self-closing element, validated. */
function formatComponentElement(componentName: string): string {
  if (!COMPONENT_IDENTIFIER_PATTERN.test(componentName)) {
    throw new TypeError(`Invalid component identifier: ${JSON.stringify(componentName)}`);
  }
  return `<${componentName} />`;
}

/** Keep authored notes from breaking out of the block comment. */
function sanitizeComment(note: string): string {
  return note.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ').trim();
}
