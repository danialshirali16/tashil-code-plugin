import type { SourceFileInput } from '../source-schema';
import * as ts from 'typescript';
import {
  extractSourceContract,
  type SourceTargetKind,
} from './source-contract';

export type LibrarySupportLevel = 'strong' | 'partial' | 'blocked' | 'not-applicable';
export type LibraryExportKind = 'component' | 'context' | 'provider';
export type CompatibilityWarningKind = 'fallback-props-type' | 'unresolved-base';

export type TargetKindCounts = Partial<Record<SourceTargetKind, number>>;

export type LibraryCompatibilityEntry = {
  exportName: string;
  sourceFolder: string;
  exportKind: LibraryExportKind;
  support: LibrarySupportLevel;
  /** Props declaration selected by the current parser, including the Props suffix. */
  selectedPropsType?: string;
  targetKindCounts?: TargetKindCounts;
  unsupportedTargets?: readonly string[];
  warningKinds?: readonly CompatibilityWarningKind[];
  blockedReason?: 'no-props-contract' | 'no-usable-targets' | 'wrong-props-contract';
};

export type LibraryComponentAudit = {
  exportName: string;
  support: LibrarySupportLevel;
  status: 'ok' | 'parse-error' | 'props-mismatch' | 'not-applicable';
  selectedPropsType?: string;
  targetKindCounts: TargetKindCounts;
  unsupportedTargets: string[];
  warnings: string[];
  warningKinds: CompatibilityWarningKind[];
  message?: string;
};

export type PublicComponentExport = {
  exportName: string;
  moduleSpecifier: string;
};

function entry(
  exportName: string,
  sourceFolder: string,
  support: LibrarySupportLevel,
  details: Omit<LibraryCompatibilityEntry, 'exportName' | 'sourceFolder' | 'support' | 'exportKind'> = {},
): LibraryCompatibilityEntry {
  return {
    exportKind: 'component',
    exportName,
    sourceFolder,
    support,
    ...details,
  };
}

/**
 * Compatibility baseline captured from the public exports in
 * `@tashilcar/swiss-army-knife` on 2026-07-29.
 *
 * Keep this list explicit: a public export being added, removed, or selecting a
 * different props declaration must be a reviewed compatibility change.
 */
export const SWISS_ARMY_KNIFE_COMPATIBILITY: readonly LibraryCompatibilityEntry[] = [
  entry('TashilAuthentication', 'tashil-authentication', 'partial', {
    selectedPropsType: 'TashilAuthenticationProps',
    targetKindCounts: { event: 1, node: 1, unsupported: 1, visual: 6 },
    unsupportedTargets: ['childProps'],
  }),
  entry('Drawer', 'drawer', 'partial', {
    selectedPropsType: 'DrawerProps',
    targetKindCounts: { array: 1, event: 1 },
  }),
  entry('TashilBadge', 'tashil-badge', 'partial', {
    selectedPropsType: 'BadgeProps',
    targetKindCounts: { event: 1, excluded: 1, node: 2, unsupported: 1, visual: 4 },
    unsupportedTargets: ['color'],
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilBreadcrumb', 'tashil-breadcrumb', 'partial', {
    selectedPropsType: 'BreadcrumbProps',
    targetKindCounts: { array: 2 },
    warningKinds: ['fallback-props-type', 'unresolved-base'],
  }),
  entry('TashilCheckbox', 'tashil-checkbox', 'partial', {
    selectedPropsType: 'checkboxPropsType',
    targetKindCounts: { controlled: 1, event: 1, excluded: 1, visual: 4 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilCheckout', 'tashil-checkout', 'partial', {
    selectedPropsType: 'TashilCheckoutProps',
    targetKindCounts: { array: 2, event: 2, node: 1, visual: 3 },
  }),
  entry('TashilDataGrid', 'tashil-data-grid', 'blocked', {
    blockedReason: 'no-usable-targets',
    selectedPropsType: 'Props',
    warningKinds: ['fallback-props-type', 'unresolved-base'],
  }),
  entry('TashilDataGridPro', 'tashil-data-grid-pro', 'blocked', {
    blockedReason: 'no-usable-targets',
    selectedPropsType: 'TashilDataGridProProps',
    warningKinds: ['unresolved-base'],
  }),
  entry('TashilDatePicker', 'tashil-date-picker', 'partial', {
    selectedPropsType: 'DatePickerPropsType',
    targetKindCounts: { event: 3, visual: 16 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilDesktopModal', 'tashil-desktop-modal', 'partial', {
    selectedPropsType: 'DesktopModalProps',
    targetKindCounts: {
      controlled: 1,
      environment: 3,
      event: 2,
      node: 1,
      render: 2,
      styling: 1,
      unsupported: 1,
      visual: 6,
    },
    unsupportedTargets: ['maxWidth'],
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilDropdown', 'tashil-dropdown', 'partial', {
    selectedPropsType: 'DropdownProps',
    targetKindCounts: {
      array: 2,
      controlled: 2,
      environment: 2,
      event: 9,
      excluded: 1,
      node: 1,
      record: 2,
      render: 1,
      styling: 1,
      unsupported: 5,
      visual: 41,
    },
    unsupportedTargets: [
      'blurOnSelect',
      'clearIcon',
      'popupIcon',
      'forcePopupIcon',
      'noOptionsText',
    ],
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilGrid', 'tashil-grid', 'blocked', {
    blockedReason: 'no-props-contract',
  }),
  entry('TashilHelperText', 'tashil-helpertext', 'strong', {
    selectedPropsType: 'TashilHelperTextProps',
    targetKindCounts: { node: 1, visual: 7 },
  }),
  entry('TashilInfoModal', 'tashil-info-modal', 'partial', {
    selectedPropsType: 'InfoModalProps',
    targetKindCounts: {
      array: 1,
      event: 2,
      excluded: 1,
      node: 3,
      unsupported: 5,
      visual: 16,
    },
    unsupportedTargets: [
      'submitProps',
      'cancelProps',
      'CancelVariant',
      'cancelSize',
      'submitSize',
    ],
    warningKinds: ['fallback-props-type', 'unresolved-base'],
  }),
  entry('TashilTextInput', 'tashil-input', 'partial', {
    selectedPropsType: 'TextInputProps',
    targetKindCounts: { event: 1, unsupported: 2, visual: 9 },
    unsupportedTargets: ['customStartAdornment', 'customEndAdornment'],
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilMenu', 'tashil-menu', 'partial', {
    selectedPropsType: 'TashilMenuProps',
    targetKindCounts: { array: 1, event: 1, unsupported: 1, visual: 3 },
    unsupportedTargets: ['searchBoxProps'],
  }),
  entry('TashilMobileDrawer', 'tashil-mobile-drawer', 'blocked', {
    blockedReason: 'no-usable-targets',
    selectedPropsType: 'MobileDrawerPropsType',
    warningKinds: ['fallback-props-type', 'unresolved-base'],
  }),
  entry('TashilNumberInput', 'tashil-number-input', 'partial', {
    selectedPropsType: 'TashilNumberInputProps',
    targetKindCounts: { controlled: 1, event: 1, excluded: 2, node: 1, visual: 12 },
    warningKinds: ['unresolved-base'],
  }),
  entry('TashilOtpInput', 'tashil-otp-input', 'partial', {
    selectedPropsType: 'TashilOtpInputProps',
    targetKindCounts: { array: 2, event: 2, excluded: 2, visual: 14 },
  }),
  entry('TashilRadio', 'tashil-radio', 'partial', {
    selectedPropsType: 'RadioProps',
    targetKindCounts: { controlled: 1, event: 1, node: 1, unsupported: 1, visual: 2 },
    unsupportedTargets: ['type'],
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilSlider', 'tashil-slider', 'partial', {
    selectedPropsType: 'TashilSliderProps',
    targetKindCounts: {
      event: 3,
      excluded: 3,
      controlled: 1,
      environment: 1,
      record: 7,
      render: 9,
      styling: 2,
      unsupported: 2,
      visual: 14,
    },
    unsupportedTargets: [
      'defaultValue',
      'marks',
    ],
  }),
  entry('TashilStepper', 'tashil-stepper', 'partial', {
    selectedPropsType: 'StepperPropsType',
    targetKindCounts: { array: 1, visual: 4 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilTab', 'tashil-tab', 'partial', {
    selectedPropsType: 'TabProps',
    targetKindCounts: { array: 2, record: 1, visual: 4 },
    warningKinds: ['fallback-props-type'],
  }),
  {
    exportKind: 'context',
    exportName: 'TashilThemeContext',
    sourceFolder: 'tashil-theme-provider',
    support: 'not-applicable',
  },
  {
    exportKind: 'provider',
    exportName: 'TashilThemeProvider',
    sourceFolder: 'tashil-theme-provider',
    support: 'not-applicable',
  },
  entry('TashilToast', 'tashil-toast', 'strong', {
    selectedPropsType: 'ToastProps',
    targetKindCounts: { event: 1, node: 1, visual: 3 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilUpload', 'tashil-upload', 'partial', {
    selectedPropsType: 'TashilUploadProps',
    targetKindCounts: { array: 1, event: 4, excluded: 1, unsupported: 1, visual: 7 },
    unsupportedTargets: ['helperText'],
    warningKinds: ['unresolved-base'],
  }),
  entry('SingleFilePreview', 'tashil-upload', 'partial', {
    selectedPropsType: 'SelectedItemProps',
    targetKindCounts: { event: 2, file: 1, visual: 5 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilNewMessage', 'tashil-new-message', 'partial', {
    selectedPropsType: 'NewMessageProps',
    targetKindCounts: { event: 1, unsupported: 1, visual: 5 },
    unsupportedTargets: ['textInputProps'],
    warningKinds: ['fallback-props-type', 'unresolved-base'],
  }),
  entry('TashilJalaliDatePicker', 'tashil-jalali-date-picker', 'partial', {
    selectedPropsType: 'DatePickerJalaliProps',
    targetKindCounts: { event: 4, excluded: 2, unsupported: 3, visual: 15 },
    unsupportedTargets: ['initialDate', 'initialFrom', 'initialTo'],
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilSwitch', 'tashil-switch', 'strong', {
    selectedPropsType: 'SwitchProps',
    targetKindCounts: { controlled: 1, event: 1, excluded: 1, visual: 3 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('TashilPopover', 'tashil-popover', 'blocked', {
    blockedReason: 'no-usable-targets',
    selectedPropsType: 'TashilPopoverProps',
    warningKinds: ['unresolved-base'],
  }),
  entry('Alert', 'alert', 'strong', {
    selectedPropsType: 'AlertProps',
    targetKindCounts: { event: 1, node: 2, visual: 6 },
  }),
  entry('Sessions', 'sessions', 'partial', {
    selectedPropsType: 'ISessionsProps',
    targetKindCounts: { array: 1, event: 2, unsupported: 1, visual: 3 },
    unsupportedTargets: ['activeSession'],
    warningKinds: ['fallback-props-type'],
  }),
  entry('Countdown', 'countdown', 'partial', {
    selectedPropsType: 'ICountdownProps',
    targetKindCounts: { array: 1, event: 1, unsupported: 1, visual: 5 },
    unsupportedTargets: ['labels'],
    warningKinds: ['fallback-props-type'],
  }),
  entry('Button', 'button', 'partial', {
    selectedPropsType: 'ButtonProps',
    targetKindCounts: { event: 1, excluded: 1, node: 3, visual: 7 },
    warningKinds: ['unresolved-base'],
  }),
  entry('Checkbox', 'checkbox', 'strong', {
    selectedPropsType: 'Props',
    targetKindCounts: { controlled: 1, event: 1, node: 1, visual: 3 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('Icon', 'icon', 'strong', {
    selectedPropsType: 'IconProps',
    targetKindCounts: { excluded: 2, visual: 3 },
  }),
  entry('IconSymbols', 'icon', 'partial', {
    selectedPropsType: 'IconSymbolsProps',
    targetKindCounts: { array: 1 },
  }),
  entry('TextInput', 'input', 'partial', {
    selectedPropsType: 'TextInputProps',
    targetKindCounts: { event: 2, unsupported: 2, visual: 9 },
    unsupportedTargets: ['customStartAdornment', 'customEndAdornment'],
  }),
  entry('NumberInput', 'number-input', 'partial', {
    selectedPropsType: 'NumberInputProps',
    targetKindCounts: { controlled: 1, event: 1, excluded: 2, node: 1, visual: 16 },
    warningKinds: ['unresolved-base'],
  }),
  entry('Radio', 'radio-group', 'strong', {
    selectedPropsType: 'Props',
    targetKindCounts: { controlled: 1, event: 1, excluded: 1, node: 1, visual: 4 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('RadioGroup', 'radio-group', 'strong', {
    selectedPropsType: 'Props',
    targetKindCounts: { controlled: 1, event: 1, node: 1, visual: 7 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('Switch', 'switch', 'strong', {
    selectedPropsType: 'SwitchProps',
    targetKindCounts: { controlled: 1, event: 1, excluded: 1, visual: 3 },
  }),
  entry('TashilTooltip', 'tashil-tooltip', 'blocked', {
    blockedReason: 'no-usable-targets',
    selectedPropsType: 'TashilTooltipProps',
    warningKinds: ['unresolved-base'],
  }),
  entry('Pagination', 'pagination', 'blocked', {
    blockedReason: 'no-usable-targets',
    selectedPropsType: 'TashilPaginationProps',
    warningKinds: ['fallback-props-type', 'unresolved-base'],
  }),
  entry('LicensePlateInput', 'license-plate-input', 'strong', {
    selectedPropsType: 'LicenseProps',
    targetKindCounts: { event: 1, visual: 6 },
    warningKinds: ['fallback-props-type'],
  }),
  entry('Text', 'text', 'partial', {
    selectedPropsType: 'TypographyProps',
    targetKindCounts: { node: 1, unsupported: 2, visual: 1 },
    unsupportedTargets: ['as', 'variant'],
    warningKinds: ['fallback-props-type'],
  }),
  entry('Slider', 'slider', 'partial', {
    selectedPropsType: 'SliderProps',
    targetKindCounts: { visual: 1 },
    warningKinds: ['unresolved-base'],
  }),
] as const;

export function auditLibraryComponent(
  compatibility: LibraryCompatibilityEntry,
  files: readonly SourceFileInput[],
): LibraryComponentAudit {
  if (compatibility.support === 'not-applicable') {
    return {
      exportName: compatibility.exportName,
      status: 'not-applicable',
      support: compatibility.support,
      targetKindCounts: {},
      unsupportedTargets: [],
      warningKinds: [],
      warnings: [],
    };
  }

  const result = extractSourceContract(files, compatibility.exportName);
  if (!result.ok) {
    return {
      exportName: compatibility.exportName,
      message: result.message,
      status: 'parse-error',
      support: compatibility.support,
      targetKindCounts: {},
      unsupportedTargets: [],
      warningKinds: [],
      warnings: [],
    };
  }

  const selectedPropsType = result.contract.propsTypeName
    ?? `${result.contract.componentName}Props`;
  const targetKindCounts = countTargetKinds(
    result.contract.targets.map((target) => target.kind),
  );
  const unsupportedTargets = result.contract.targets
    .filter((target) => target.kind === 'unsupported')
    .map((target) => target.path.join('.'));
  const warningKinds = classifyCompatibilityWarnings(result.warnings);

  return {
    exportName: compatibility.exportName,
    selectedPropsType,
    status: compatibility.selectedPropsType !== undefined
      && selectedPropsType !== compatibility.selectedPropsType
      ? 'props-mismatch'
      : 'ok',
    support: compatibility.support,
    targetKindCounts,
    unsupportedTargets,
    warningKinds,
    warnings: result.warnings,
  };
}

export function discoverPublicComponentExports(
  indexSource: string,
  fileName = 'index.ts',
): PublicComponentExport[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    indexSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return sourceFile.statements.flatMap((statement): PublicComponentExport[] => {
    if (
      !ts.isExportDeclaration(statement)
      || statement.exportClause === undefined
      || !ts.isNamedExports(statement.exportClause)
      || statement.moduleSpecifier === undefined
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.startsWith('./components/')
    ) {
      return [];
    }

    const moduleSpecifier = statement.moduleSpecifier.text;
    return statement.exportClause.elements.map((element) => ({
      exportName: element.name.text,
      moduleSpecifier,
    }));
  });
}

export function compareLibraryAuditToBaseline(
  compatibility: LibraryCompatibilityEntry,
  audit: LibraryComponentAudit,
): string[] {
  const issues: string[] = [];
  const prefix = `${compatibility.exportName}:`;

  if (compatibility.support === 'not-applicable') {
    if (audit.status !== 'not-applicable') {
      issues.push(`${prefix} expected not-applicable, received ${audit.status}.`);
    }
    return issues;
  }

  if (compatibility.selectedPropsType === undefined) {
    if (audit.status !== 'parse-error') {
      issues.push(
        `${prefix} expected no props contract, selected `
        + `${audit.selectedPropsType ?? 'none'}.`,
      );
    }
    return issues;
  }

  if (audit.status === 'parse-error') {
    issues.push(`${prefix} source parser failed: ${audit.message ?? 'unknown error'}`);
    return issues;
  }
  if (audit.status === 'props-mismatch') {
    issues.push(
      `${prefix} expected ${compatibility.selectedPropsType}, selected `
      + `${audit.selectedPropsType ?? 'none'}.`,
    );
  }

  if (!equalRecords(compatibility.targetKindCounts ?? {}, audit.targetKindCounts)) {
    issues.push(
      `${prefix} target kinds changed from `
      + `${JSON.stringify(compatibility.targetKindCounts ?? {})} to `
      + `${JSON.stringify(audit.targetKindCounts)}.`,
    );
  }
  if (!equalStrings(compatibility.unsupportedTargets ?? [], audit.unsupportedTargets)) {
    issues.push(
      `${prefix} unsupported targets changed from `
      + `${JSON.stringify(compatibility.unsupportedTargets ?? [])} to `
      + `${JSON.stringify(audit.unsupportedTargets)}.`,
    );
  }
  if (!equalStrings(compatibility.warningKinds ?? [], audit.warningKinds)) {
    issues.push(
      `${prefix} warning kinds changed from `
      + `${JSON.stringify(compatibility.warningKinds ?? [])} to `
      + `${JSON.stringify(audit.warningKinds)}.`,
    );
  }

  return issues;
}

export function countTargetKinds(kinds: readonly SourceTargetKind[]): TargetKindCounts {
  const counts: TargetKindCounts = {};
  for (const kind of kinds) {
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

export function classifyCompatibilityWarnings(
  warnings: readonly string[],
): CompatibilityWarningKind[] {
  const kinds = new Set<CompatibilityWarningKind>();
  for (const warning of warnings) {
    if (/^Used .+ because no .+ was found\.$/.test(warning)) {
      kinds.add('fallback-props-type');
    }
    if (/^Could not resolve base type /.test(warning)) {
      kinds.add('unresolved-base');
    }
  }
  return [...kinds];
}

export function summarizeLibraryCompatibility(
  entries: readonly LibraryCompatibilityEntry[] = SWISS_ARMY_KNIFE_COMPATIBILITY,
): Record<LibrarySupportLevel, number> {
  const summary: Record<LibrarySupportLevel, number> = {
    blocked: 0,
    'not-applicable': 0,
    partial: 0,
    strong: 0,
  };
  for (const compatibility of entries) {
    summary[compatibility.support] += 1;
  }
  return summary;
}

export function validateLibraryCompatibilityManifest(
  entries: readonly LibraryCompatibilityEntry[] = SWISS_ARMY_KNIFE_COMPATIBILITY,
  publicExportNames?: readonly string[],
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const compatibility of entries) {
    if (seen.has(compatibility.exportName)) {
      issues.push(`Duplicate public export ${JSON.stringify(compatibility.exportName)}.`);
    }
    seen.add(compatibility.exportName);

    if (
      compatibility.support === 'blocked'
      && compatibility.blockedReason === undefined
    ) {
      issues.push(
        `Blocked export ${JSON.stringify(compatibility.exportName)} has no blockedReason.`,
      );
    }
    if (
      compatibility.support !== 'blocked'
      && compatibility.blockedReason !== undefined
    ) {
      issues.push(
        `Non-blocked export ${JSON.stringify(compatibility.exportName)} has a blockedReason.`,
      );
    }
    if (
      compatibility.support === 'not-applicable'
      && compatibility.exportKind === 'component'
    ) {
      issues.push(
        `Not-applicable export ${JSON.stringify(compatibility.exportName)} is marked as a component.`,
      );
    }
    if (
      (compatibility.support === 'strong' || compatibility.support === 'partial')
      && compatibility.selectedPropsType === undefined
    ) {
      issues.push(
        `Supported export ${JSON.stringify(compatibility.exportName)} has no selectedPropsType.`,
      );
    }
    if (
      (compatibility.support === 'strong' || compatibility.support === 'partial')
      && compatibility.targetKindCounts === undefined
    ) {
      issues.push(
        `Supported export ${JSON.stringify(compatibility.exportName)} has no targetKindCounts.`,
      );
    }

    const unsupportedCount = compatibility.targetKindCounts?.unsupported ?? 0;
    if (unsupportedCount !== (compatibility.unsupportedTargets?.length ?? 0)) {
      issues.push(
        `Export ${JSON.stringify(compatibility.exportName)} records ${unsupportedCount} `
        + `unsupported targets but names ${compatibility.unsupportedTargets?.length ?? 0}.`,
      );
    }
  }

  if (publicExportNames !== undefined) {
    const publicExports = new Set(publicExportNames);
    if (publicExports.size !== publicExportNames.length) {
      issues.push('The package barrel contains duplicate public component exports.');
    }

    for (const exportName of publicExports) {
      if (!seen.has(exportName)) {
        issues.push(`Public export ${JSON.stringify(exportName)} is missing from the manifest.`);
      }
    }
    for (const exportName of seen) {
      if (!publicExports.has(exportName)) {
        issues.push(`Manifest export ${JSON.stringify(exportName)} is not publicly exported.`);
      }
    }
  }

  return issues;
}

function equalRecords(
  left: TargetKindCounts,
  right: TargetKindCounts,
): boolean {
  const kinds: SourceTargetKind[] = [
    'visual',
    'event',
    'node',
    'array',
    'record',
    'date',
    'file',
    'render',
    'styling',
    'controlled',
    'environment',
    'excluded',
    'unsupported',
  ];
  return kinds.every((kind) => (left[kind] ?? 0) === (right[kind] ?? 0));
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
