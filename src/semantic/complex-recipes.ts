export type ComplexRecipeFamily =
  | 'data-driven'
  | 'form'
  | 'overlay'
  | 'date-range';

export type ComplexComponentRecipe = {
  /** Target groups where only one source may be active at a time. */
  exclusiveTargetGroups?: readonly (readonly string[])[];
  family: ComplexRecipeFamily;
  /** Optional public targets that the component implementation ignores or derives. */
  omittedTargets?: readonly string[];
  /**
   * Optional runtime-capable targets that form the component's useful minimum
   * usage. Required runtime targets are always included independently.
   */
  runtimeTargets: readonly string[];
  summary: string;
};

/**
 * Component-specific defaults stay as data so complex APIs do not introduce
 * JSX branches into the resolver.
 */
export const COMPLEX_COMPONENT_RECIPES: Readonly<
Record<string, ComplexComponentRecipe>
> = {
  Pagination: {
    exclusiveTargetGroups: [['page', 'defaultPage']],
    family: 'data-driven',
    runtimeTargets: ['count', 'page', 'onChange'],
    summary: 'Figma supplies appearance; application code supplies page count, current page, and change handling.',
  },
  Drawer: {
    family: 'overlay',
    runtimeTargets: ['open', 'onClose', 'children', 'actionButtons'],
    summary: 'Figma supplies drawer appearance; application code supplies visibility, close handling, content, and action buttons.',
  },
  TashilDesktopModal: {
    family: 'overlay',
    runtimeTargets: ['open', 'onClose', 'children'],
    summary: 'Figma supplies dialog appearance; application code supplies visibility, close handling, and modal content.',
  },
  TashilDropdown: {
    family: 'data-driven',
    runtimeTargets: ['options', 'value', 'onChange'],
    summary: 'Figma supplies appearance; application code supplies options, value, and onChange.',
  },
  TashilDataGrid: {
    family: 'data-driven',
    runtimeTargets: ['rows', 'columns'],
    summary: 'Figma supplies grid appearance and state; application code supplies rows and columns.',
  },
  TashilDataGridPro: {
    family: 'data-driven',
    runtimeTargets: ['rows', 'columns'],
    summary: 'Figma supplies Pro grid appearance and state; application code supplies rows and columns.',
  },
  TashilDatePicker: {
    family: 'date-range',
    omittedTargets: ['initialDate.day', 'initialDate.month', 'initialDate.year'],
    runtimeTargets: ['onChange', 'onSubmit'],
    summary: 'Figma supplies date-picker copy and validation appearance; application code receives date changes and submission.',
  },
  TashilMenu: {
    family: 'data-driven',
    runtimeTargets: ['options', 'handleClose', 'anchorEl', 'open'],
    summary: 'Figma supplies appearance; application code supplies menu items, anchor, and state.',
  },
  Sessions: {
    family: 'data-driven',
    runtimeTargets: [
      'sessions',
      'activeSession',
      'appName',
      'onDeleteSession',
      'onDeleteAllSessions',
    ],
    summary: 'Figma supplies loading and display state; application code supplies session data and actions.',
  },
  TashilAuthentication: {
    family: 'form',
    runtimeTargets: ['pageState', 'childProps', 'onBack'],
    summary: 'Figma supplies authentication content and appearance; application code supplies the active challenge, page props, and navigation.',
  },
  TashilCheckout: {
    family: 'form',
    runtimeTargets: ['checkoutData', 'banks', 'defaultBank', 'onBack', 'onSubmit'],
    summary: 'Figma supplies checkout appearance; application code supplies line items, payment options, initial selection, and actions.',
  },
  TashilOtpInput: {
    family: 'form',
    runtimeTargets: ['values', 'onChange', 'onComplete'],
    summary: 'Figma supplies OTP validation and appearance; application code supplies entered values and change/completion handling.',
  },
  TashilNewMessage: {
    family: 'form',
    omittedTargets: ['textInputProps.value', 'textInputProps.onChange'],
    runtimeTargets: ['files', 'onChangeFiles', 'onRetry', 'onRemove', 'onSubmit'],
    summary: 'Figma supplies composer content and state; application code supplies attachments and submission actions.',
  },
  TashilUpload: {
    family: 'form',
    runtimeTargets: ['files', 'onChangeFiles', 'onRetry', 'onRemove'],
    summary: 'Figma supplies upload content and validation appearance; application code supplies files and lifecycle actions.',
  },
  TashilTab: {
    exclusiveTargetGroups: [['items', 'components']],
    family: 'data-driven',
    runtimeTargets: ['items'],
    summary: 'Use runtime items or connected component tabs, but never emit both APIs together.',
  },
  TashilInfoModal: {
    family: 'overlay',
    runtimeTargets: ['open', 'onCancel', 'onSubmit', 'actionButtons'],
    summary: 'Figma supplies modal content and appearance; application code supplies visibility and actions.',
  },
  TashilMobileDrawer: {
    family: 'overlay',
    runtimeTargets: ['open', 'onClose', 'children'],
    summary: 'Figma supplies mobile-drawer appearance; application code supplies visibility, close handling, and content.',
  },
  TashilPopover: {
    family: 'overlay',
    runtimeTargets: ['open', 'onClose', 'anchorEl', 'children'],
    summary: 'Figma supplies popover appearance; application code supplies visibility, anchor, close handling, and content.',
  },
  TashilTooltip: {
    family: 'overlay',
    runtimeTargets: ['title', 'children'],
    summary: 'Figma supplies tooltip appearance; application code supplies the trigger and default content, which can be remapped to Figma when appropriate.',
  },
  TashilJalaliDatePicker: {
    family: 'date-range',
    omittedTargets: ['initialDate', 'initialFrom', 'initialTo'],
    runtimeTargets: [
      'onChangeDatePicker',
      'onChangeRangePicker',
      'onSubmit',
      'onCancel',
    ],
    summary: 'Figma supplies Jalali date-picker mode, copy, and validation appearance; application code receives single-date or range changes and actions.',
  },
  TashilSlider: {
    exclusiveTargetGroups: [['value', 'defaultValue']],
    family: 'date-range',
    omittedTargets: ['defaultValue', 'marks'],
    runtimeTargets: ['value', 'onChange'],
    summary: 'Figma supplies slider appearance and bounds; application code supplies the controlled value and change handling.',
  },
  Slider: {
    exclusiveTargetGroups: [['value', 'defaultValue']],
    family: 'date-range',
    omittedTargets: ['defaultValue', 'marks'],
    runtimeTargets: ['value', 'onChange'],
    summary: 'Figma supplies slider appearance and bounds; application code supplies the controlled value and change handling.',
  },
};

export function getComplexComponentRecipe(
  componentName: string,
): ComplexComponentRecipe | undefined {
  return COMPLEX_COMPONENT_RECIPES[componentName];
}

export function getExclusiveTargetSiblings(
  componentName: string,
  targetPath: string,
): readonly string[] {
  const group = getComplexComponentRecipe(componentName)?.exclusiveTargetGroups
    ?.find((targets) => targets.includes(targetPath));
  return group?.filter((candidate) => candidate !== targetPath) ?? [];
}
