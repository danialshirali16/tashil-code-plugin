import { describe, expect, it } from 'vitest';
import {
  COMPONENT_AUDIT_REPORT_VERSION,
  createComponentAuditReport,
  formatComponentAuditMarkdown,
  serializeComponentAuditJson,
} from './audit-report';
import type { SourceContract } from './source-contract';

function contract(overrides: Partial<SourceContract> = {}): SourceContract {
  return {
    componentName: 'TashilDropdown',
    contentHash: 'abc123',
    fileName: 'dropdown.tsx',
    targets: [
      { path: ['size'], ownerProp: 'size', typeName: "'small' | 'large'", kind: 'visual', required: false, values: ['small', 'large'] },
      { path: ['options'], ownerProp: 'options', typeName: 'Option[]', kind: 'array', required: true },
      { path: ['onChange'], ownerProp: 'onChange', typeName: '() => void', kind: 'event', required: false },
      { path: ['childProps'], ownerProp: 'childProps', typeName: 'unknown', kind: 'unsupported', required: false },
    ],
    ...overrides,
  };
}

describe('createComponentAuditReport', () => {
  it('counts target kinds and lists unsupported paths from the contract', () => {
    const report = createComponentAuditReport(
      contract(),
      () => new Date('2026-07-30T00:00:00.000Z'),
    );

    expect(report).toStrictEqual({
      version: COMPONENT_AUDIT_REPORT_VERSION,
      componentName: 'TashilDropdown',
      contentHash: 'abc123',
      targetKindCounts: { visual: 1, array: 1, event: 1, unsupported: 1 },
      unsupportedTargets: ['childProps'],
      generatedAt: '2026-07-30T00:00:00.000Z',
    });
  });

  it('omits propsTypeName when the contract has none', () => {
    const report = createComponentAuditReport(contract({ propsTypeName: undefined }));
    expect('propsTypeName' in report).toBe(false);
  });

  it('includes propsTypeName when the contract has one', () => {
    const report = createComponentAuditReport(contract({ propsTypeName: 'DropdownProps' }));
    expect(report.propsTypeName).toBe('DropdownProps');
  });
});

describe('formatComponentAuditMarkdown', () => {
  it('renders header, kind counts in canonical order, and unsupported paths', () => {
    const report = createComponentAuditReport(contract());
    const md = formatComponentAuditMarkdown(report);

    expect(md).toContain('# TashilDropdown compatibility report');
    expect(md).toContain('- Props type: (none selected)');
    // Canonical ordering: visual before event before array before unsupported.
    expect(md.indexOf('- visual: 1')).toBeLessThan(md.indexOf('- event: 1'));
    expect(md.indexOf('- event: 1')).toBeLessThan(md.indexOf('- array: 1'));
    expect(md.indexOf('- array: 1')).toBeLessThan(md.indexOf('- unsupported: 1'));
    expect(md).toContain('- `childProps`');
  });

  it('shows a placeholder when no targets were extracted', () => {
    const report = createComponentAuditReport(contract({ targets: [] }));
    expect(formatComponentAuditMarkdown(report)).toContain('_(no targets extracted)_');
    expect(formatComponentAuditMarkdown(report)).toContain('_(none)_');
  });
});

describe('serializeComponentAuditJson', () => {
  it('round-trips through JSON', () => {
    const report = createComponentAuditReport(contract());
    const json = serializeComponentAuditJson(report);
    expect(JSON.parse(json)).toStrictEqual(report);
  });
});
