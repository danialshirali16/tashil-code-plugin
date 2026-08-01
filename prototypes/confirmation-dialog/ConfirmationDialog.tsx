/**
 * Manual-verification fixture for the semantic connect flow
 * (docs/archive/semantic-connect-roadmap.md). Upload this file in the plugin's
 * Implementation mapping editor for the "Dialog" component in the
 * "Semantic Connect Verification" Figma file.
 */

export interface ConfirmationDialogProps {
  intent: 'danger' | 'default';
  title: string;
  description?: string;
  cancelAction: { label: string };
  confirmAction: { label: string };
  onConfirm: () => void;
}

export function ConfirmationDialog(_props: ConfirmationDialogProps): null {
  return null;
}
