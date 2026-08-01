/**
 * Frame inspection domain model (Phase B).
 *
 * Figma-independent, serializable values only. Both the Dev Mode codegen
 * adapter and the Inspect Code UI consume the same {@link FrameInspection}.
 *
 * Spec: docs/archive/layout-composer-roadmap.md §"Target domain model".
 */

import type { ComponentUsage } from '../layout/types';

/** One CSS declaration as emitted by `getCSSAsync()`, passed through unmodified. */
export type CssDeclaration = {
  property: string;
  value: string;
};

/**
 * The selected node's CSS split into the two Dev-Mode-parity sections.
 * Declaration order within each bucket preserves `getCSSAsync()` emission
 * order so the sections read identically to Figma's native inspect panel.
 */
export type NodeCss = {
  layout: CssDeclaration[];
  style: CssDeclaration[];
};

export type AccessibilityFinding = {
  check: 'contrast' | 'touch-target' | 'font-size';
  message: string;
  status: 'pass' | 'warning';
  value: number;
};

export type InspectionDiagnosticReason =
  | 'unconnected-instance'
  | 'invalid-connection'
  | 'missing-main-component'
  | 'css-unavailable'
  | 'node-limit';

export type InspectionDiagnostic = {
  severity: 'info' | 'warning' | 'error';
  reason: InspectionDiagnosticReason;
  message: string;
  nodeId?: string;
  layerPath?: string[];
};

/** A connected component instance found inside the inspected frame. */
export type ConnectedComponentEntry = {
  nodeId: string;
  layerPath: string[];
  componentName: string;
  usage: ComponentUsage;
};

/** The complete inspection result for one selected node. */
export type FrameInspection = {
  accessibility?: AccessibilityFinding[];
  nodeName: string;
  nodeType: string;
  css: NodeCss;
  connectedComponents: ConnectedComponentEntry[];
  diagnostics: InspectionDiagnostic[];
};
