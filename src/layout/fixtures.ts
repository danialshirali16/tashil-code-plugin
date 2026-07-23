/**
 * Mocked Figma fixtures for the layout composer (Phase 0).
 *
 * These are hand-written doubles mirroring the pattern in `main.test.ts`:
 * plain objects carrying only the fields the later extraction/emitter phases
 * read, cast `as unknown as <Node>`. They are the stable *inputs* every later
 * phase tests against; expected outputs live in `golden.test.ts`.
 *
 * No production runtime code imports this module. It exists so Phase 2's
 * `figma-layout-extractor.ts` and the test suite share one source of truth for
 * what a "vertical form" or "wrapping action row" looks like.
 */

import { CURRENT_SCHEMA_VERSION, type ConnectionMetadata } from '../types';

// ---------------------------------------------------------------------------
// Shared builder primitives
// ---------------------------------------------------------------------------

/** A connected main component's serialized connection metadata. */
export function connection(overrides: Partial<ConnectionMetadata> = {}): ConnectionMetadata {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    componentName: 'Button',
    importPath: '@tashilcar/ui',
    ...overrides,
  } as ConnectionMetadata;
}

type FrameOptions = {
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  width?: number;
  height?: number;
  visible?: boolean;
};

export type FrameDouble = FrameNode;
export type GroupDouble = GroupNode;
export type InstanceDouble = InstanceNode;
export type TextDouble = TextNode;
export type VectorDouble = VectorNode;

/** A FRAME node. Defaults match a vertical auto-layout container. */
export function frame(
  id: string,
  name: string,
  children: ReadonlyArray<SceneNode> = [],
  options: FrameOptions = {},
): FrameDouble {
  return {
    children: [...children],
    id,
    layoutMode: options.layoutMode ?? 'VERTICAL',
    layoutWrap: options.layoutWrap ?? 'NO_WRAP',
    itemSpacing: options.itemSpacing ?? 0,
    counterAxisSpacing: options.counterAxisSpacing ?? 0,
    paddingTop: options.paddingTop ?? 0,
    paddingRight: options.paddingRight ?? 0,
    paddingBottom: options.paddingBottom ?? 0,
    paddingLeft: options.paddingLeft ?? 0,
    primaryAxisAlignItems: options.primaryAxisAlignItems ?? 'MIN',
    counterAxisAlignItems: options.counterAxisAlignItems ?? 'MIN',
    layoutSizingHorizontal: options.layoutSizingHorizontal ?? 'HUG',
    layoutSizingVertical: options.layoutSizingVertical ?? 'HUG',
    width: options.width ?? 320,
    height: options.height ?? 200,
    name,
    parent: { type: 'PAGE' },
    type: 'FRAME',
    visible: options.visible ?? true,
  } as unknown as FrameDouble;
}

/** A GROUP node — treated as a transparent container with no layout meaning. */
export function group(
  id: string,
  name: string,
  children: ReadonlyArray<SceneNode>,
  visible = true,
): GroupDouble {
  return {
    children: [...children],
    id,
    name,
    parent: { type: 'PAGE' },
    type: 'GROUP',
    visible,
  } as unknown as GroupDouble;
}

type ChildLayoutOptions = {
  layoutGrow?: number;
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  visible?: boolean;
};

/** A standalone TEXT node (outside any component instance). */
export function text(
  id: string,
  name: string,
  characters: string,
  childOptions: ChildLayoutOptions = {},
): TextDouble {
  return {
    characters,
    id,
    layoutGrow: childOptions.layoutGrow ?? 0,
    layoutAlign: childOptions.layoutAlign ?? 'INHERIT',
    layoutPositioning: childOptions.layoutPositioning ?? 'AUTO',
    name,
    parent: { type: 'PAGE' },
    type: 'TEXT',
    visible: childOptions.visible ?? true,
  } as unknown as TextDouble;
}

export type ComponentDouble = ComponentNode & {
  getSharedPluginData: (namespace: string, key: string) => string;
};

/**
 * A main COMPONENT carrying connection metadata via `getSharedPluginData`.
 * Matches the `createComponent` double in `main.test.ts`.
 */
export function component(
  id: string,
  name: string,
  sharedPluginData = '',
  componentPropertyDefinitions: ComponentNode['componentPropertyDefinitions'] = {},
): ComponentDouble {
  return {
    componentPropertyDefinitions,
    getSharedPluginData: () => sharedPluginData,
    id,
    name,
    parent: { type: 'PAGE' },
    type: 'COMPONENT',
    variantProperties: null,
  } as unknown as ComponentDouble;
}

/**
 * An INSTANCE whose main component resolves via `getMainComponentAsync`. The
 * resolved component carries serialized `ConnectionMetadata` (or empty string
 * when unconnected) readable through `getSharedPluginData`.
 */
export function instance(
  id: string,
  name: string,
  mainComponent: ComponentDouble | null,
  childOptions: ChildLayoutOptions = {},
): InstanceDouble {
  return {
    componentProperties: {},
    getMainComponentAsync: () => Promise.resolve(mainComponent),
    id,
    layoutGrow: childOptions.layoutGrow ?? 0,
    layoutAlign: childOptions.layoutAlign ?? 'INHERIT',
    layoutPositioning: childOptions.layoutPositioning ?? 'AUTO',
    layoutSizingHorizontal: childOptions.layoutSizingHorizontal ?? 'HUG',
    layoutSizingVertical: childOptions.layoutSizingVertical ?? 'HUG',
    name,
    parent: { type: 'PAGE' },
    type: 'INSTANCE',
    visible: childOptions.visible ?? true,
  } as unknown as InstanceDouble;
}

/** An unsupported VECTOR node. */
export function vector(
  id: string,
  name: string,
  childOptions: ChildLayoutOptions = {},
): VectorDouble {
  return {
    id,
    layoutGrow: childOptions.layoutGrow ?? 0,
    layoutAlign: childOptions.layoutAlign ?? 'INHERIT',
    layoutPositioning: childOptions.layoutPositioning ?? 'AUTO',
    name,
    parent: { type: 'PAGE' },
    type: 'VECTOR',
    visible: childOptions.visible ?? true,
  } as unknown as VectorDouble;
}

// ---------------------------------------------------------------------------
// The 12 representative fixtures from the roadmap (Phase 0)
// ---------------------------------------------------------------------------

/**
 * A connected main component double, with metadata pre-serialized exactly as
 * the plugin stores it. Reused across fixtures that need a connected instance.
 */
function connectedComponent(
  id: string,
  name: string,
  metadata: ConnectionMetadata,
): ComponentDouble {
  return component(id, name, JSON.stringify(metadata));
}

const BUTTON = connection({ componentName: 'Button', importPath: '@tashilcar/ui' });
const TEXT_FIELD = connection({
  componentName: 'TextField',
  importPath: '@tashilcar/ui',
});
const ICON_BUTTON = connection({
  componentName: 'IconButton',
  importPath: '@tashilcar/ui',
});

/** 1. Vertical form: a column frame with two connected component instances. */
export function verticalForm(): FrameDouble {
  const button = connectedComponent('c:button', 'Button / Submit', {
    ...BUTTON,
    propMappings: { intent: { primary: { prop: 'variant', value: 'primary' } } },
  });
  const field = connectedComponent('c:field', 'TextField / Email', TEXT_FIELD);
  return frame('f:form', 'Payment form', [
    instance('i:field', 'TextField / Email', field),
    instance('i:button', 'Button / Submit', button, { layoutSizingHorizontal: 'FILL' }),
  ], {
    layoutMode: 'VERTICAL',
    itemSpacing: 16,
    paddingTop: 24,
    paddingRight: 24,
    paddingBottom: 24,
    paddingLeft: 24,
  });
}

/** 2. Horizontal header: a row frame with an icon button and label text. */
export function horizontalHeader(): FrameDouble {
  const iconButton = connectedComponent('c:back', 'IconButton / Back', ICON_BUTTON);
  return frame('f:header', 'Page header', [
    instance('i:back', 'IconButton / Back', iconButton),
    text('t:title', 'Title', 'Checkout', { layoutGrow: 1 }),
  ], {
    layoutMode: 'HORIZONTAL',
    itemSpacing: 12,
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'CENTER',
  });
}

/** 3. Nested auto-layout: frame > frame > instance. */
export function nestedAutoLayout(): FrameDouble {
  const field = connectedComponent('c:field', 'TextField / Card number', TEXT_FIELD);
  const inner = frame('f:inner', 'Card fields', [instance('i:card', 'TextField / Card number', field)], {
    layoutMode: 'VERTICAL',
    itemSpacing: 8,
  });
  return frame('f:outer', 'Payment section', [inner], {
    layoutMode: 'VERTICAL',
    itemSpacing: 16,
  });
}

/** 4. Wrapping action row: a horizontal frame with wrap enabled. */
export function wrappingActionRow(): FrameDouble {
  const chip = connectedComponent('c:chip', 'Tag / Filter', connection({
    componentName: 'Tag',
    importPath: '@tashilcar/ui',
  }));
  return frame('f:chips', 'Filter chips', [
    instance('i:c1', 'Tag / Filter', chip),
    instance('i:c2', 'Tag / Filter', chip),
    instance('i:c3', 'Tag / Filter', chip),
    instance('i:c4', 'Tag / Filter', chip),
  ], {
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP',
    itemSpacing: 8,
    counterAxisSpacing: 8,
  });
}

/**
 * 5. Connected components from one package: two instances sharing an import
 * path. Pinned in `golden.test.ts` to the exact current TSX output.
 */
export function connectedOnePackage(): FrameDouble {
  const button = connectedComponent('c:button', 'Button / Continue', {
    ...BUTTON,
    propMappings: { intent: { primary: { prop: 'variant', value: 'primary' } } },
  });
  const link = connectedComponent('c:link', 'Button / Back', {
    ...BUTTON,
    componentName: 'Button',
  });
  return frame('f:row', 'Actions', [
    instance('i:back', 'Button / Back', link),
    instance('i:continue', 'Button / Continue', button),
  ], {
    layoutMode: 'HORIZONTAL',
    itemSpacing: 12,
  });
}

/**
 * 6. Connected components from multiple packages: two instances, two import
 * paths. Drives the dedup-across-paths case.
 */
export function connectedMultiplePackages(): FrameDouble {
  const uiButton = connectedComponent('c:uibutton', 'Button', {
    ...BUTTON,
    importPath: '@tashilcar/ui',
  });
  const formsField = connectedComponent('c:formsfield', 'Field', {
    ...TEXT_FIELD,
    componentName: 'Field',
    importPath: '@tashilcar/forms',
  });
  return frame('f:mixed', 'Mixed sources', [
    instance('i:uibutton', 'Button', uiButton),
    instance('i:formsfield', 'Field', formsField),
  ], {
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
  });
}

/**
 * 7. Duplicate component names from different packages: same `componentName`,
 * different `importPath`. Drives the deterministic-alias tests in Phase 1.
 */
export function duplicateNamesAcrossPackages(): FrameDouble {
  const uiCard = connectedComponent('c:uicard', 'Card', {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    componentName: 'Card',
    importPath: '@tashilcar/ui',
  });
  const formsCard = connectedComponent('c:formscard', 'Card', {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    componentName: 'Card',
    importPath: '@tashilcar/forms',
  });
  return frame('f:dup', 'Duplicate names', [
    instance('i:uicard', 'Card', uiCard),
    instance('i:formscard', 'Card', formsCard),
  ], {
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
  });
}

/** 8. Unconnected instance: main component present but no connection metadata. */
export function unconnectedInstance(): FrameDouble {
  const main = component('c:unconnected', 'Button / Ghost');
  return frame('f:with-unconnected', 'Frame with unconnected instance', [
    instance('i:unconnected', 'Button / Ghost', main),
  ], { layoutMode: 'VERTICAL', itemSpacing: 8 });
}

/** 9. Broken component metadata: instance whose main component resolves null. */
export function brokenInstance(): FrameDouble {
  return frame('f:with-broken', 'Frame with broken instance', [
    instance('i:broken', 'Button / Missing', null),
  ], { layoutMode: 'VERTICAL', itemSpacing: 8 });
}

/** 10. Raw text node (standalone, not inside an instance). */
export function rawText(): TextDouble {
  return text('t:label', 'Caption', 'Add a payment method');
}

/** 11. Absolute-positioned child: a frame with one absolutely positioned child. */
export function absolutePositionedChild(): FrameDouble {
  const badge = text('t:badge', 'Badge', 'New', { layoutPositioning: 'ABSOLUTE' });
  return frame('f:absolute', 'Card with badge', [badge], {
    layoutMode: 'VERTICAL',
    itemSpacing: 0,
  });
}

/** 12. Unsupported vector/image layer. */
export function unsupportedVector(): VectorDouble {
  return vector('v:divider', 'Divider');
}

/**
 * Convenience registry so tests and Phase 2 can iterate every fixture by name.
 * Keep the keys stable; later phases reference them.
 */
export const fixtures = {
  verticalForm,
  horizontalHeader,
  nestedAutoLayout,
  wrappingActionRow,
  connectedOnePackage,
  connectedMultiplePackages,
  duplicateNamesAcrossPackages,
  unconnectedInstance,
  brokenInstance,
  rawText,
  absolutePositionedChild,
  unsupportedVector,
} as const;
