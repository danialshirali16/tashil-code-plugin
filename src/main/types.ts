import type { ResolvedInstanceSwap } from '../codegen';
import type {
  CodegenBlock,
  ConnectionIssue,
  ConnectionMetadata,
} from '../types';
import type { ComponentUsage } from '../layout/types';

export type ConnectableComponentNode = ComponentNode | ComponentSetNode;

export type ResolvedSelection = {
  mainComponent: ConnectableComponentNode;
  componentProperties: Record<string, string | boolean>;
  displayText: string;
  instanceSwaps: Record<string, ResolvedInstanceSwap>;
};

export type ConnectionReadResult =
  | { ok: true; metadata: ConnectionMetadata }
  | { issue?: ConnectionIssue; ok: false; message: string };

export type MutationTargetResult =
  | { ok: true; selection: ResolvedSelection }
  | { ok: false; message: string };

export type ConnectedOutput = {
  code: string;
  diagnostics?: string;
  explanation?: string;
  runtimeRequirements?: string;
  deprecation?: string;
  usage: ComponentUsage;
};

export function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function createPlainTextBlock(title: string, code: string): CodegenBlock {
  return {
    title,
    language: 'PLAINTEXT',
    code,
  };
}

export function formatDiagnostics(
  diagnostics: ReadonlyArray<{
    layerPath?: string[];
    message: string;
    severity: 'error' | 'info' | 'warning';
  }>,
): string | null {
  if (diagnostics.length === 0) {
    return null;
  }
  return diagnostics
    .map((diagnostic) => {
      const severity = diagnostic.severity === 'error'
        ? '⛔'
        : diagnostic.severity === 'warning'
          ? '⚠️'
          : 'ℹ️';
      const path = diagnostic.layerPath?.length ? ` (${diagnostic.layerPath.join(' / ')})` : '';
      return `${severity} ${diagnostic.message}${path}`;
    })
    .join('\n');
}

export function formatUnexpectedError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'Unknown error.';
}

export function errorMessage(error: unknown, action: string): string {
  const detail = error instanceof Error && error.message.trim() !== ''
    ? `: ${error.message}`
    : '.';
  return `Could not ${action}${detail}`;
}

export function runBestEffort(effect: () => void | Promise<void>): void {
  try {
    void Promise.resolve(effect()).catch(() => undefined);
  } catch {
    // Event entry points and post-mutation effects must not leak host failures.
  }
}

export function createMutationFailureMessage(action: string, error: unknown): string {
  const detail = error instanceof Error && error.message.trim() !== ''
    ? ` ${error.message}`
    : '';
  return `Could not ${action}.${detail}`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function normalizeComponentPropertyName(propertyName: string): string {
  return propertyName.split('#')[0];
}
