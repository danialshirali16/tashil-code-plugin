import { describe, expect, it } from 'vitest';
import type { SourceFileInput } from '../source-schema';
import {
  auditLibraryComponent,
  classifyCompatibilityWarnings,
  compareLibraryAuditToBaseline,
  discoverPublicComponentExports,
  summarizeLibraryCompatibility,
  SWISS_ARMY_KNIFE_COMPATIBILITY,
  validateLibraryCompatibilityManifest,
  type LibraryCompatibilityEntry,
} from './library-compatibility';

const EXPECTED_PUBLIC_EXPORTS = [
  'TashilAuthentication',
  'Drawer',
  'TashilBadge',
  'TashilBreadcrumb',
  'TashilCheckbox',
  'TashilCheckout',
  'TashilDataGrid',
  'TashilDataGridPro',
  'TashilDatePicker',
  'TashilDesktopModal',
  'TashilDropdown',
  'TashilGrid',
  'TashilHelperText',
  'TashilInfoModal',
  'TashilTextInput',
  'TashilMenu',
  'TashilMobileDrawer',
  'TashilNumberInput',
  'TashilOtpInput',
  'TashilRadio',
  'TashilSlider',
  'TashilStepper',
  'TashilTab',
  'TashilThemeContext',
  'TashilThemeProvider',
  'TashilToast',
  'TashilUpload',
  'SingleFilePreview',
  'TashilNewMessage',
  'TashilJalaliDatePicker',
  'TashilSwitch',
  'TashilPopover',
  'Alert',
  'Sessions',
  'Countdown',
  'Button',
  'Checkbox',
  'Icon',
  'IconSymbols',
  'TextInput',
  'NumberInput',
  'Radio',
  'RadioGroup',
  'Switch',
  'TashilTooltip',
  'Pagination',
  'LicensePlateInput',
  'Text',
  'Slider',
] as const;

function fixtureFor(compatibility: LibraryCompatibilityEntry): SourceFileInput[] {
  if (compatibility.support === 'not-applicable') {
    return [];
  }
  if (compatibility.selectedPropsType === undefined) {
    return [{
      contents: `export const ${compatibility.exportName} = () => null;`,
      fileName: `${compatibility.sourceFolder}/index.tsx`,
    }];
  }

  return [{
    contents: `
export interface ${compatibility.selectedPropsType} {
  label?: string;
}
`,
    fileName: `${compatibility.sourceFolder}/types.ts`,
  }];
}

describe('Swiss Army Knife compatibility baseline', () => {
  it('tracks every public export exactly once', () => {
    expect(SWISS_ARMY_KNIFE_COMPATIBILITY.map(({ exportName }) => exportName))
      .toEqual(EXPECTED_PUBLIC_EXPORTS);
    expect(validateLibraryCompatibilityManifest(
      SWISS_ARMY_KNIFE_COMPATIBILITY,
      EXPECTED_PUBLIC_EXPORTS,
    )).toEqual([]);
  });

  it('preserves the audited support totals', () => {
    expect(summarizeLibraryCompatibility()).toEqual({
      blocked: 7,
      'not-applicable': 2,
      partial: 30,
      strong: 10,
    });
  });

  it('distinguishes visual components from contexts and providers', () => {
    const nonVisualExports = SWISS_ARMY_KNIFE_COMPATIBILITY
      .filter(({ exportKind }) => exportKind !== 'component')
      .map(({ exportKind, exportName }) => ({ exportKind, exportName }));

    expect(nonVisualExports).toEqual([
      { exportKind: 'context', exportName: 'TashilThemeContext' },
      { exportKind: 'provider', exportName: 'TashilThemeProvider' },
    ]);
  });

  it('reports public-export drift in either direction', () => {
    const issues = validateLibraryCompatibilityManifest(
      SWISS_ARMY_KNIFE_COMPATIBILITY,
      [...EXPECTED_PUBLIC_EXPORTS.slice(1), 'NewComponent'],
    );

    expect(issues).toContain('Public export "NewComponent" is missing from the manifest.');
    expect(issues).toContain(
      'Manifest export "TashilAuthentication" is not publicly exported.',
    );
  });

  it('runs one source-contract selection fixture for every public export', () => {
    const audits = SWISS_ARMY_KNIFE_COMPATIBILITY.map((compatibility) => ({
      audit: auditLibraryComponent(compatibility, fixtureFor(compatibility)),
      compatibility,
    }));

    for (const { audit, compatibility } of audits) {
      if (compatibility.support === 'not-applicable') {
        expect(audit.status, compatibility.exportName).toBe('not-applicable');
      } else if (compatibility.selectedPropsType === undefined) {
        expect(audit.status, compatibility.exportName).toBe('parse-error');
      } else {
        expect(audit.selectedPropsType, compatibility.exportName)
          .toBe(compatibility.selectedPropsType);
        expect(audit.status, compatibility.exportName).toBe('ok');
      }
    }
  });
});

describe('library compatibility audit', () => {
  it('discovers explicitly named component exports from the package barrel', () => {
    expect(discoverPublicComponentExports(`
export { Button } from './components/button';
export { default as Radio, RadioGroup as Group } from './components/radio';
export * from './types';
export { helper } from './utils';
`)).toEqual([
      { exportName: 'Button', moduleSpecifier: './components/button' },
      { exportName: 'Radio', moduleSpecifier: './components/radio' },
      { exportName: 'Group', moduleSpecifier: './components/radio' },
    ]);
  });

  it('records target categories and keeps object values out of unsupported paths', () => {
    const compatibility: LibraryCompatibilityEntry = {
      exportKind: 'component',
      exportName: 'AuditWidget',
      selectedPropsType: 'AuditWidgetProps',
      sourceFolder: 'audit-widget',
      support: 'partial',
    };
    const audit = auditLibraryComponent(compatibility, [{
      contents: `
interface AuditWidgetProps {
  label?: string;
  onChange?: () => void;
  children?: ReactNode;
  config?: object;
  className?: string;
}
`,
      fileName: 'audit-widget/types.ts',
    }]);

    expect(audit).toMatchObject({
      selectedPropsType: 'AuditWidgetProps',
      status: 'ok',
      targetKindCounts: {
        event: 1,
        excluded: 1,
        node: 1,
        record: 1,
        visual: 1,
      },
      unsupportedTargets: [],
    });
  });

  it('fails when the parser silently selects a different props declaration', () => {
    const compatibility: LibraryCompatibilityEntry = {
      exportKind: 'component',
      exportName: 'Dialog',
      selectedPropsType: 'DialogProps',
      sourceFolder: 'dialog',
      support: 'partial',
    };
    const audit = auditLibraryComponent(compatibility, [{
      contents: 'export interface InfoModalProps { title?: string }',
      fileName: 'dialog/types.ts',
    }]);

    expect(audit).toMatchObject({
      selectedPropsType: 'InfoModalProps',
      status: 'props-mismatch',
      warningKinds: ['fallback-props-type'],
    });
  });

  it('classifies known parser warning categories', () => {
    expect(classifyCompatibilityWarnings([
      'Used BadgeProps because no TashilBadgeProps was found.',
      'Could not resolve base type BaseProps.',
      'Skipped a computed prop name that cannot be mapped safely.',
    ])).toEqual(['fallback-props-type', 'unresolved-base']);
  });

  it('reports target, unsupported-path, and warning drift from the baseline', () => {
    const compatibility: LibraryCompatibilityEntry = {
      exportKind: 'component',
      exportName: 'AuditWidget',
      selectedPropsType: 'AuditWidgetProps',
      sourceFolder: 'audit-widget',
      support: 'partial',
      targetKindCounts: { visual: 2 },
      unsupportedTargets: ['config'],
      warningKinds: ['unresolved-base'],
    };
    const audit = auditLibraryComponent(compatibility, [{
      contents: 'interface AuditWidgetProps { label?: string }',
      fileName: 'audit-widget/types.ts',
    }]);

    expect(compareLibraryAuditToBaseline(compatibility, audit)).toEqual([
      'AuditWidget: target kinds changed from {"visual":2} to {"visual":1}.',
      'AuditWidget: unsupported targets changed from ["config"] to [].',
      'AuditWidget: warning kinds changed from ["unresolved-base"] to [].',
    ]);
  });
});
