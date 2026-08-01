/**
 * Layout composer intermediate representation (Phase 1).
 *
 * Figma-independent. These types describe a *resolved* layout document that
 * the styled-components TSX emitter consumes. They contain serializable values
 * only — no Figma node references. The extraction layer (Phase 2) is the only
 * place that touches Figma types and produces this IR.
 *
 * Spec: docs/layout-composer-roadmap.md §"Target domain model".
 */

import type { MappingDiagnostic } from '../codegen';

/**
 * A single import line represented structurally so the importer can
 * deduplicate across component descendants and resolve same-name conflicts with
 * deterministic local aliases.
 */
export type ComponentImport = {
  /** Original exported name in the source module, e.g. `Button`. */
  importedName: string;
  /** Name used in generated JSX/TSX. Equals `importedName` when unambiguous. */
  localName: string;
  /** Persisted module specifier; composed layouts normalize it to the Swiss Army Knife package. */
  modulePath: string;
};

/**
 * A resolved connected-component usage, split into its structural imports and
 * JSX so a layout can collect and deduplicate imports across descendants.
 *
 * `jsx` is one or more lines of JSX (an element plus optional children),
 * already formatted and escaped. `imports` are the named imports that JSX
 * depends on; the importer deduplicates them.
 */
export type ComponentUsage = {
  imports: ComponentImport[];
  jsx: string;
  diagnostics: MappingDiagnostic[];
  /** JSX attribute fragments reused as CSF args by Storybook generation. */
  storyArgs?: string[];
  /** Application-owned values required by a semantic component recipe. */
  runtimeRequirements?: string[];
};

/** Layout direction for a container, derived from Figma `layoutMode`. */
export type LayoutAxis = 'horizontal' | 'vertical';

/** Main-axis alignment, from Figma `primaryAxisAlignItems`. */
export type JustifyContent = 'flex-start' | 'center' | 'flex-end' | 'space-between';

/** Cross-axis alignment, from Figma `counterAxisAlignItems`. */
export type AlignItems = 'flex-start' | 'center' | 'flex-end' | 'baseline' | 'stretch';

/** Figma sizing mode → CSS. `HUG` is the default (document flow); omitted. */
export type SizingMode = 'fill' | 'fixed' | 'hug';

export type CssTokenReference = {
  cssName: string;
  variableId: string;
};

export type LayoutTokenField =
  | 'gap'
  | 'counterGap'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'width'
  | 'height';

/**
 * The flexbox contract a container emits. Captures the structural flex
 * properties (direction, wrap, gap, alignment, padding) plus the container's
 * own sizing (`sizingHorizontal`/`sizingVertical`, `width`/`height`).
 */
export type LayoutStyle = {
  /** Auto-layout uses flex; freeform parents establish a positioning context. */
  mode: 'auto-layout' | 'freeform';
  axis: LayoutAxis;
  wrap: boolean;
  gap: number;
  /** Counter-axis gap, only applied when `wrap` is true. */
  counterGap?: number;
  justifyContent?: JustifyContent;
  alignItems?: AlignItems;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  /** Container's own horizontal sizing in its parent. */
  sizingHorizontal?: SizingMode;
  /** Container's own vertical sizing in its parent. */
  sizingVertical?: SizingMode;
  /** Fixed width in px, applied when `sizingHorizontal === 'fixed'`. */
  width?: number;
  /** Fixed height in px, applied when `sizingVertical === 'fixed'`. */
  height?: number;
  tokens?: Partial<Record<LayoutTokenField, CssTokenReference>>;
};

/**
 * How a node behaves as a flex item in its parent. A node only carries this
 * when it has grow, stretch, or explicit sizing to emit; absence means default
 * document flow.
 */
export type ChildStyle = {
  /** Absolute children use their Figma-local coordinates inside the parent. */
  position?: 'absolute';
  left?: number;
  top?: number;
  /** `layoutGrow: 1` → `flex-grow: 1`. */
  grow?: number;
  /** `layoutAlign: STRETCH` → `align-self: stretch` (cross axis). */
  alignSelf?: 'stretch';
  /** Horizontal sizing as a flex child. */
  sizingHorizontal?: SizingMode;
  /** Vertical sizing as a flex child. */
  sizingVertical?: SizingMode;
  /** Fixed width in px, applied when `sizingHorizontal === 'fixed'`. */
  width?: number;
  /** Fixed height in px, applied when `sizingVertical === 'fixed'`. */
  height?: number;
  tokens?: Partial<Record<'width' | 'height', CssTokenReference>>;
};

/**
 * One CSS declaration captured from Figma or derived from layout properties.
 * Values are already serialized CSS strings. In particular, Figma-emitted
 * `var(--token, fallback)` values must pass through unchanged.
 */
export type CssDeclaration = {
  property: string;
  value: string;
  source: 'figma-css' | 'layout';
};

export type CompositionNode =
  | AssetCompositionNode
  | ComponentCompositionNode
  | ContainerCompositionNode
  | ShapeCompositionNode
  | TextCompositionNode
  | PlaceholderCompositionNode;

/** A connected component instance emitted as one atomic React element. */
export type ComponentCompositionNode = {
  kind: 'component';
  nodeId: string;
  layerPath: string[];
  usage: ComponentUsage;
  /**
   * Present when the instance needs flex-item behavior (grow, stretch, sizing)
   * in its parent. The TSX emitter wraps the component in a `<div>` carrying
   * this class so the connected component stays atomic.
   */
  childStyle?: ChildStyle;
  /** Class name for the wrapper, present only when `childStyle` is set. */
  className?: string;
};

/** A layout wrapper `<div>` with its own CSS class. */
export type ContainerCompositionNode = {
  kind: 'container';
  nodeId: string;
  layerPath: string[];
  className: string;
  element: 'div' | 'section';
  layout: LayoutStyle;
  /** Token-aware visual/typography/layout CSS returned by `getCSSAsync()`. */
  declarations: CssDeclaration[];
  children: CompositionNode[];
  /** How this container behaves as a flex item in its parent. */
  childStyle?: ChildStyle;
};

/** A safely exported visual leaf rendered as an image or token-colored mask. */
export type AssetCompositionNode = {
  kind: 'asset';
  nodeId: string;
  layerPath: string[];
  alt: string;
  src: string;
  declarations: CssDeclaration[];
  childStyle?: ChildStyle;
  /**
   * Monochrome SVGs with one token-bound paint render as a CSS mask so the
   * generated color token controls their pixels. Ordinary/multicolor assets
   * remain image elements.
   */
  mask?: {
    color: CssDeclaration;
  };
};

/** A non-text visual leaf, such as a divider, rendered as a styled element. */
export type ShapeCompositionNode = {
  kind: 'shape';
  nodeId: string;
  layerPath: string[];
  className: string;
  declarations: CssDeclaration[];
  childStyle?: ChildStyle;
};

/** An unconnected text node emitted as escaped JSX text. */
export type TextCompositionNode = {
  kind: 'text';
  nodeId: string;
  layerPath: string[];
  className?: string;
  text: string;
  /** Token-aware text CSS returned by `getCSSAsync()`. */
  declarations: CssDeclaration[];
  /** How this text behaves as a flex item in its parent. */
  childStyle?: ChildStyle;
};

/**
 * A node the layout generator does not fully support in version 1. Emits an
 * inline JSX comment and a diagnostic; never silently omitted.
 */
export type PlaceholderCompositionNode = {
  kind: 'placeholder';
  nodeId: string;
  layerPath: string[];
  reason: LayoutDiagnosticReason;
  /** Optional human-readable label, included in the emitted comment. */
  label?: string;
};

export type LayoutDiagnosticReason =
  | 'unconnected-instance'
  | 'invalid-connection'
  | 'missing-main-component'
  | 'unsupported-root'
  | 'unsupported-node'
  | 'unsupported-layout-mode'
  | 'grid-layout'
  | 'absolute-positioning'
  | 'unsupported-paint'
  | 'unsupported-effect'
  | 'hidden-layer'
  | 'name-collision'
  | 'node-limit'
  | 'depth-limit'
  | 'root-fixed-size-omitted'
  | 'css-unavailable';

export type LayoutDiagnostic = {
  severity: 'info' | 'warning' | 'error';
  reason: LayoutDiagnosticReason;
  message: string;
  nodeId?: string;
  layerPath?: string[];
};

export type LayoutDocument = {
  root: CompositionNode;
  name: string;
  diagnostics: LayoutDiagnostic[];
};

export type GeneratedLayout = {
  componentName: string;
  componentCount: number;
  wrapperCount: number;
  tsx: string;
  diagnostics: LayoutDiagnostic[];
  runtimeRequirements?: string[];
  fidelity?: {
    unresolvedComponents: number;
    unsupportedAssets: number;
    omittedDeclarations: number;
  };
};

/** Full-tree styled-components output plus selection metadata shown to users. */
export type ReactLayoutResult = GeneratedLayout & {
  nodeName: string;
  nodeType: string;
};
