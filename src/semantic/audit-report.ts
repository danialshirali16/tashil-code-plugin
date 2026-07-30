/**
 * Single-component compatibility report (roadmap M7: "Export the component
 * compatibility report as Markdown or JSON").
 *
 * Derived from the live {@link SourceContract} already on the recipe — not from
 * `auditLibraryComponent`, which needs raw source files and a baseline entry.
 * The plugin never persists raw source (see project-brief privacy model), so the
 * contract is the correct input. The per-kind / unsupported derivation mirrors
 * `auditLibraryComponent` (`library-compatibility.ts:401-408`) so the numbers
 * agree with the CI audit.
 */

import { countTargetKinds, type TargetKindCounts } from './library-compatibility';
import type {
  SourceContract,
  SourceTargetKind,
} from './source-contract';

export const COMPONENT_AUDIT_REPORT_VERSION = 1;

export type ComponentAuditReport = {
  /** Report schema revision; bump when the exported shape changes. */
  version: typeof COMPONENT_AUDIT_REPORT_VERSION;
  /** Export/component name, taken from the source contract. */
  componentName: string;
  /** Public props declaration the parser selected for this component. */
  propsTypeName?: string;
  /** Content hash of the uploaded source the contract was derived from. */
  contentHash: string;
  /** Per-kind counts across the contract's targets. */
  targetKindCounts: TargetKindCounts;
  /** Dotted paths of targets the parser could not safely represent yet. */
  unsupportedTargets: string[];
  /** ISO timestamp of the export. */
  generatedAt: string;
};

/**
 * Build a report from a resolved source contract. Pure: no I/O, no clock deps
 * except the explicit `generatedAt` (injectable for tests via `now`).
 */
export function createComponentAuditReport(
  contract: SourceContract,
  now: () => Date = () => new Date(),
): ComponentAuditReport {
  return {
    version: COMPONENT_AUDIT_REPORT_VERSION,
    componentName: contract.componentName,
    ...(contract.propsTypeName !== undefined
      ? { propsTypeName: contract.propsTypeName }
      : {}),
    contentHash: contract.contentHash,
    targetKindCounts: countTargetKinds(
      contract.targets.map((target) => target.kind),
    ),
    unsupportedTargets: contract.targets
      .filter((target) => target.kind === 'unsupported')
      .map((target) => target.path.join('.')),
    generatedAt: now().toISOString(),
  };
}

/** Deterministic pretty JSON for the export. */
export function serializeComponentAuditJson(report: ComponentAuditReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Human-readable Markdown export. One line per target kind with a non-zero
 * count, then any unsupported paths. Stable ordering by the canonical kind list
 * so diffs between exports are minimal.
 */
export function formatComponentAuditMarkdown(report: ComponentAuditReport): string {
  const lines: string[] = [
    `# ${report.componentName} compatibility report`,
    '',
    `- Props type: ${report.propsTypeName ?? '(none selected)'}`,
    `- Source hash: \`${report.contentHash}\``,
    `- Generated: ${report.generatedAt}`,
    '',
    '## Target kinds',
  ];

  const counts = report.targetKindCounts;
  const hasAny = KIND_ORDER.some((kind) => (counts[kind] ?? 0) > 0);
  if (hasAny) {
    for (const kind of KIND_ORDER) {
      const count = counts[kind];
      if (count !== undefined && count > 0) {
        lines.push(`- ${kind}: ${count}`);
      }
    }
  } else {
    lines.push('- _(no targets extracted)_');
  }

  lines.push('', '## Unsupported targets');
  if (report.unsupportedTargets.length > 0) {
    for (const path of report.unsupportedTargets) {
      lines.push(`- \`${path}\``);
    }
  } else {
    lines.push('- _(none)_');
  }

  return lines.join('\n') + '\n';
}

// ponytail: KIND_ORDER is a hand-maintained display ordering of the kind union.
// Ceiling: if SourceTargetKind gains a member and it's forgotten here, that
// kind simply renders in arbitrary JSON order rather than being lost — counts
// are computed from countTargetKinds over the live union, not this list.
const KIND_ORDER: readonly SourceTargetKind[] = [
  'visual',
  'node',
  'render',
  'event',
  'controlled',
  'array',
  'record',
  'date',
  'file',
  'styling',
  'environment',
  'excluded',
  'unsupported',
];
