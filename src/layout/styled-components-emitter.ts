/**
 * Pure styled-components declaration generation from the serializable layout
 * IR. This module never touches Figma nodes.
 */

import { toComponentName } from './naming';
import type {
  ChildStyle,
  CompositionNode,
  ContainerCompositionNode,
  CssDeclaration,
  LayoutAxis,
  LayoutStyle,
} from './types';

export type StyledDefinition = {
  declarations: CssDeclaration[];
  name: string;
  nodeId: string;
  tag: string;
  /** When set, font-* props were dropped and this comment replaces them. */
  textStyleName?: string;
  /** When set, an effect-style comment is inserted before box-shadow/filter. */
  effectStyleName?: string;
};

/**
 * The five font declarations replaced by a text-style comment when a text node
 * carries `textStyleName`. `font-style` is intentionally retained.
 */
const TEXT_STYLE_REPLACED_PROPERTIES = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
]);

export type StyledRegistry = {
  definitions: StyledDefinition[];
  namesByNodeId: Map<string, string>;
};

const COLOR_PROPERTIES = new Set([
  'background',
  'background-color',
  'border-color',
  'border-block-color',
  'border-block-end-color',
  'border-block-start-color',
  'border-bottom-color',
  'border-inline-color',
  'border-inline-end-color',
  'border-inline-start-color',
  'border-left-color',
  'border-right-color',
  'border-top-color',
  'caret-color',
  'color',
  'fill',
  'flood-color',
  'outline-color',
  'stop-color',
  'stroke',
  'text-decoration-color',
]);

const COLOR_TOKEN_NAMESPACES = new Set([
  'background',
  'border',
  'fill',
  'foreground',
  'icon',
  'stroke',
  'surface',
  'text',
]);

class NameRegistry {
  private readonly used: Set<string>;

  constructor(reserved: Iterable<string>) {
    this.used = new Set(reserved);
  }

  claim(candidate: string): string {
    const base = candidate || 'Layer';
    let name = base;
    let suffix = 2;
    while (this.used.has(name)) {
      name = `${base}${suffix}`;
      suffix += 1;
    }
    this.used.add(name);
    return name;
  }
}

export function createStyledRegistry(
  root: CompositionNode,
  componentName: string,
  reservedNames: Iterable<string> = [],
): StyledRegistry {
  const definitions: StyledDefinition[] = [];
  const namesByNodeId = new Map<string, string>();
  const names = new NameRegistry([
    'styled',
    componentName,
    ...reservedNames,
  ]);

  collectDefinitions(
    root,
    definitions,
    namesByNodeId,
    names,
    undefined,
    true,
    componentName,
  );

  return { definitions, namesByNodeId };
}

export function renderStyledDefinitions(
  definitions: readonly StyledDefinition[],
): string {
  return definitions
    .map((definition) => {
      const lines = definition.declarations.map((declaration) =>
        renderDeclaration(declaration));
      if (definition.textStyleName) {
        const commentIndex = findTextStyleCommentIndex(definition.declarations);
        const comment = `  /* Text style: "${definition.textStyleName}" */`;
        if (commentIndex >= 0 && commentIndex <= lines.length) {
          lines.splice(commentIndex, 0, comment);
        } else {
          lines.push(comment);
        }
      }
      if (definition.effectStyleName) {
        const commentIndex = findEffectStyleCommentIndex(definition.declarations);
        const comment = `  /* ${definition.effectStyleName} */`;
        if (commentIndex >= 0 && commentIndex <= lines.length) {
          lines.splice(commentIndex, 0, comment);
        } else {
          lines.push(comment);
        }
      }
      const declarations = lines.join('\n');
      return [
        `const ${definition.name} = styled.${definition.tag}\``,
        declarations,
        '`;',
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Place the effect-style comment right before `box-shadow`, `filter`, or `backdrop-filter`.
 * Falls back to the top of the block.
 */
function findEffectStyleCommentIndex(declarations: readonly CssDeclaration[]): number {
  const index = declarations.findIndex(({ property }) => {
    const prop = property.trim().toLowerCase();
    return prop === 'box-shadow' || prop === 'filter' || prop === 'backdrop-filter';
  });
  return index !== -1 ? index : 0;
}

/**
 * Place the text-style comment right before `font-style` (the surviving
 * declaration that immediately followed the dropped font props), so it lands
 * between `color` and `font-style` as in the target spec. Falls back to
 * after `color`, then at the top.
 */
function findTextStyleCommentIndex(declarations: readonly CssDeclaration[]): number {
  const fontStyleIndex = declarations.findIndex(({ property }) =>
    property.trim().toLowerCase() === 'font-style');
  if (fontStyleIndex !== -1) {
    return fontStyleIndex;
  }
  const colorIndex = declarations.findIndex(({ property }) =>
    property.trim().toLowerCase() === 'color');
  if (colorIndex !== -1) {
    return colorIndex + 1;
  }
  return 0;
}

export function usesColorTokens(
  definitions: readonly StyledDefinition[],
): boolean {
  return definitions.some(({ declarations }) =>
    declarations.some((declaration) =>
      colorTokenExpression(declaration) !== null));
}

export function colorTokenExpression(
  declaration: Pick<CssDeclaration, 'property' | 'value'>,
): string | null {
  const property = declaration.property.trim().toLowerCase();
  if (!COLOR_PROPERTIES.has(property)) {
    return null;
  }

  const match = declaration.value.trim().match(
    /^var\(\s*--([a-zA-Z0-9_./-]+)(?:\s*,[\s\S]*)?\)$/,
  );
  if (!match) {
    return null;
  }

  const segments = match[1]
    .split(/[./_-]+/)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  if (segments[0] === 'color' || segments[0] === 'colors') {
    segments.shift();
  } else if (!segments[0] || !COLOR_TOKEN_NAMESPACES.has(segments[0])) {
    return null;
  }
  if (segments.length === 0) {
    return null;
  }

  return segments.reduce(
    (expression, segment) =>
      /^[a-z_$][a-z0-9_$]*$/i.test(segment)
        ? `${expression}.${segment}`
        : `${expression}[${JSON.stringify(segment)}]`,
    'colors',
  );
}

function renderDeclaration({ property, value }: CssDeclaration): string {
  const expression = colorTokenExpression({ property, value });
  const renderedValue = expression
    ? '${' + expression + '}'
    : escapeTemplateValue(value);
  return `  ${escapeTemplateValue(property)}: ${renderedValue};`;
}

function collectDefinitions(
  node: CompositionNode,
  definitions: StyledDefinition[],
  namesByNodeId: Map<string, string>,
  names: NameRegistry,
  parentAxis: LayoutAxis | undefined,
  isRoot: boolean,
  componentName: string,
): void {
  if (node.kind === 'container') {
    const candidate = isRoot
      ? `${componentName}Root`
      : toComponentName(last(node.layerPath) ?? 'Layer');
    const name = names.claim(candidate);
    const declarations = containerDeclarations(node, isRoot, parentAxis);
    namesByNodeId.set(node.nodeId, name);
    definitions.push({
      declarations,
      name,
      nodeId: node.nodeId,
      tag: node.element,
      ...(node.effectStyleName ? { effectStyleName: node.effectStyleName } : {}),
    });

    for (const child of node.children) {
      collectDefinitions(
        child,
        definitions,
        namesByNodeId,
        names,
        node.layout.axis,
        false,
        componentName,
      );
    }
    return;
  }

  if (node.kind === 'text' && (node.declarations.length > 0 || node.childStyle)) {
    const name = names.claim(toComponentName(last(node.layerPath) ?? 'Text'));
    namesByNodeId.set(node.nodeId, name);
    const sourceDeclarations = node.textStyleName
      ? node.declarations.filter(({ property }) =>
        !TEXT_STYLE_REPLACED_PROPERTIES.has(property.trim().toLowerCase()))
      : node.declarations;
    definitions.push({
      declarations: mergeDeclarations(
        sourceDeclarations,
        childDeclarations(node.childStyle, parentAxis),
        suppressedProperties(node.childStyle, parentAxis),
      ),
      name,
      nodeId: node.nodeId,
      tag: 'span',
      ...(node.textStyleName ? { textStyleName: node.textStyleName } : {}),
      ...(node.effectStyleName ? { effectStyleName: node.effectStyleName } : {}),
    });
    return;
  }

  if (
    node.kind === 'asset'
    && (node.declarations.length > 0 || node.childStyle || node.mask)
  ) {
    const name = names.claim(toComponentName(last(node.layerPath) ?? 'Asset'));
    namesByNodeId.set(node.nodeId, name);
    const maskDeclarations = node.mask
      ? [
          layout('--icon-mask', `url("${node.src}")`),
          layout('display', 'block'),
          node.mask.color,
          layout(
            '-webkit-mask',
            'var(--icon-mask) center / 100% 100% no-repeat',
          ),
          layout('mask', 'var(--icon-mask) center / 100% 100% no-repeat'),
        ]
      : [];
    definitions.push({
      declarations: mergeDeclarations(
        [...maskDeclarations, ...node.declarations],
        childDeclarations(node.childStyle, parentAxis),
        suppressedProperties(node.childStyle, parentAxis),
      ),
      name,
      nodeId: node.nodeId,
      tag: node.mask ? 'span' : 'img',
    });
    return;
  }

  if (node.kind === 'shape') {
    const name = names.claim(toComponentName(last(node.layerPath) ?? 'Shape'));
    namesByNodeId.set(node.nodeId, name);
    definitions.push({
      declarations: mergeDeclarations(
        node.declarations,
        childDeclarations(node.childStyle, parentAxis),
        suppressedProperties(node.childStyle, parentAxis),
      ),
      name,
      nodeId: node.nodeId,
      tag: 'div',
      ...(node.effectStyleName ? { effectStyleName: node.effectStyleName } : {}),
    });
    return;
  }

  if (node.kind === 'component' && node.childStyle) {
    const base = toComponentName(last(node.layerPath) ?? 'Component');
    const name = names.claim(`${base}Wrapper`);
    namesByNodeId.set(node.nodeId, name);
    definitions.push({
      declarations: childDeclarations(node.childStyle, parentAxis),
      name,
      nodeId: node.nodeId,
      tag: 'div',
    });
  }
}

function containerDeclarations(
  node: ContainerCompositionNode,
  isRoot: boolean,
  parentAxis: LayoutAxis | undefined,
): CssDeclaration[] {
  const structural = mergeDeclarations(
    layoutDeclarations(node.layout, isRoot),
    node.declarations,
  );
  const base = node.children.some((child) =>
    'childStyle' in child && child.childStyle?.position === 'absolute')
    ? mergeDeclarations(structural, [layout('position', 'relative')])
    : structural;
  return mergeDeclarations(
    base,
    childDeclarations(node.childStyle, parentAxis),
    suppressedProperties(node.childStyle, parentAxis),
  );
}

function layoutDeclarations(
  style: LayoutStyle,
  isRoot: boolean,
): CssDeclaration[] {
  const declarations: CssDeclaration[] = style.mode === 'freeform'
    ? [layout('position', 'relative')]
    : [
        layout('display', 'flex'),
        layout('flex-direction', style.axis === 'horizontal' ? 'row' : 'column'),
      ];

  if (style.mode === 'auto-layout' && style.wrap) {
    declarations.push(layout('flex-wrap', 'wrap'));
  }

  if (
    style.mode === 'auto-layout'
    && style.counterGap !== undefined
    && style.wrap
  ) {
    declarations.push(
      layout(
        style.axis === 'horizontal' ? 'column-gap' : 'row-gap',
        formatTokenLength(style.gap, style.tokens?.gap),
      ),
      layout(
        style.axis === 'horizontal' ? 'row-gap' : 'column-gap',
        formatTokenLength(style.counterGap, style.tokens?.counterGap),
      ),
    );
  } else if (
    style.mode === 'auto-layout'
    && (style.gap > 0 || style.tokens?.gap)
  ) {
    declarations.push(
      layout('gap', formatTokenLength(style.gap, style.tokens?.gap)),
    );
  }

  const padding = style.mode === 'auto-layout' ? formatPadding(style) : null;
  if (padding) {
    declarations.push(layout('padding', padding));
  }

  if (
    !isRoot
    && style.width !== undefined
    && (style.mode === 'freeform' || style.sizingHorizontal === 'fixed')
  ) {
    declarations.push(
      layout('width', formatTokenLength(style.width, style.tokens?.width)),
    );
  }
  if (
    style.height !== undefined
    && (style.mode === 'freeform' || style.sizingVertical === 'fixed')
  ) {
    declarations.push(
      layout('height', formatTokenLength(style.height, style.tokens?.height)),
    );
  }

  if (
    style.mode === 'auto-layout'
    && style.justifyContent
    && style.justifyContent !== 'flex-start'
  ) {
    declarations.push(layout('justify-content', style.justifyContent));
  }
  if (
    style.mode === 'auto-layout'
    && style.alignItems
    && style.alignItems !== 'stretch'
  ) {
    declarations.push(layout('align-items', style.alignItems));
  }

  return declarations;
}

function childDeclarations(
  style: ChildStyle | undefined,
  parentAxis: LayoutAxis | undefined,
): CssDeclaration[] {
  if (!style) {
    return [];
  }

  const declarations: CssDeclaration[] = [];
  if (style.position === 'absolute') {
    declarations.push(layout('position', 'absolute'));
    if (style.left !== undefined) {
      declarations.push(layout('left', formatLength(style.left)));
    }
    if (style.top !== undefined) {
      declarations.push(layout('top', formatLength(style.top)));
    }
    if (style.width !== undefined) {
      declarations.push(
        layout('width', formatTokenLength(style.width, style.tokens?.width)),
      );
    }
    if (style.height !== undefined) {
      declarations.push(
        layout('height', formatTokenLength(style.height, style.tokens?.height)),
      );
    }
    return declarations;
  }

  const horizontalMain = parentAxis === 'horizontal';
  const verticalMain = parentAxis === 'vertical';
  const horizontalFill = style.sizingHorizontal === 'fill';
  const verticalFill = style.sizingVertical === 'fill';

  if (horizontalMain && horizontalFill) {
    declarations.push(
      layout('flex', '1 1 0'),
      layout('min-width', '0'),
    );
  } else if (horizontalFill) {
    declarations.push(
      layout('width', '100%'),
      layout('align-self', 'stretch'),
    );
  }

  if (verticalMain && verticalFill) {
    declarations.push(
      layout('flex', '1 1 0'),
      layout('min-height', '0'),
    );
  } else if (verticalFill) {
    declarations.push(
      layout('height', '100%'),
      layout('align-self', 'stretch'),
    );
  }

  if (style.sizingHorizontal === 'fixed' && style.width !== undefined) {
    const width = formatTokenLength(style.width, style.tokens?.width);
    if (horizontalMain) {
      declarations.push(layout('flex', `0 0 ${width}`));
    }
    declarations.push(layout('width', width));
  }

  if (style.sizingVertical === 'fixed' && style.height !== undefined) {
    const height = formatTokenLength(style.height, style.tokens?.height);
    if (verticalMain) {
      declarations.push(layout('flex', `0 0 ${height}`));
    }
    declarations.push(layout('height', height));
  }

  if (
    style.grow !== undefined
    && style.grow > 0
    && !(horizontalMain && horizontalFill)
    && !(verticalMain && verticalFill)
  ) {
    declarations.push(layout('flex-grow', String(style.grow)));
  }

  if (
    style.alignSelf === 'stretch'
    && !declarations.some(({ property }) => property === 'align-self')
  ) {
    declarations.push(layout('align-self', 'stretch'));
  }

  return declarations;
}

function suppressedProperties(
  style: ChildStyle | undefined,
  parentAxis: LayoutAxis | undefined,
): Set<string> {
  const suppressed = new Set<string>();
  if (!style) {
    return suppressed;
  }
  if (parentAxis === 'horizontal' && style.sizingHorizontal === 'fill') {
    suppressed.add('width');
    suppressed.add('flex-grow');
  }
  if (parentAxis === 'vertical' && style.sizingVertical === 'fill') {
    suppressed.add('height');
    suppressed.add('flex-grow');
  }
  return suppressed;
}

function mergeDeclarations(
  base: readonly CssDeclaration[],
  additions: readonly CssDeclaration[],
  suppressed = new Set<string>(),
): CssDeclaration[] {
  const order: string[] = [];
  const byProperty = new Map<string, CssDeclaration>();

  for (const declaration of [...base, ...additions]) {
    const property = declaration.property.trim().toLowerCase();
    if (!property || suppressed.has(property)) {
      continue;
    }
    if (!byProperty.has(property)) {
      order.push(property);
    }
    const existing = byProperty.get(property);
    if (
      existing?.source === 'figma-css'
      && declaration.source === 'layout'
      && /var\(\s*--/.test(existing.value)
    ) {
      continue;
    }
    byProperty.set(property, { ...declaration, property });
  }

  return order
    .map((property) => byProperty.get(property))
    .filter((declaration): declaration is CssDeclaration => Boolean(declaration));
}

function layout(property: string, value: string): CssDeclaration {
  return { property, value, source: 'layout' };
}

function formatPadding(style: LayoutStyle): string | null {
  const {
    paddingTop: top,
    paddingRight: right,
    paddingBottom: bottom,
    paddingLeft: left,
  } = style;

  if (
    top === 0
    && right === 0
    && bottom === 0
    && left === 0
    && !style.tokens?.paddingTop
    && !style.tokens?.paddingRight
    && !style.tokens?.paddingBottom
    && !style.tokens?.paddingLeft
  ) {
    return null;
  }
  const values = [
    formatTokenLength(top, style.tokens?.paddingTop),
    formatTokenLength(right, style.tokens?.paddingRight),
    formatTokenLength(bottom, style.tokens?.paddingBottom),
    formatTokenLength(left, style.tokens?.paddingLeft),
  ];
  if (values[0] === values[2] && values[1] === values[3]) {
    return values[0] === values[1]
      ? values[0]
      : `${values[0]} ${values[1]}`;
  }
  if (values[1] === values[3]) {
    return `${values[0]} ${values[1]} ${values[2]}`;
  }
  return values.join(' ');
}

function formatLength(value: number): string {
  if (!Number.isFinite(value)) {
    return '0px';
  }
  const rounded = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  return `${rounded}px`;
}

function formatTokenLength(
  value: number,
  token: { cssName: string } | undefined,
): string {
  const fallback = formatLength(value);
  return token ? `var(${token.cssName}, ${fallback})` : fallback;
}

function escapeTemplateValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/\r?\n/g, ' ');
}

function last<T>(values: readonly T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}
