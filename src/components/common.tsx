import {
  Button,
  IconButton,
  IconCheck24,
  IconCopySmall24,
  IconFolder24,
  IconNewTab24,
  IconTimeSmall24,
} from '@create-figma-plugin/ui';
import { emit } from '@create-figma-plugin/utilities';
import { Fragment, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FrameInspection } from '../inspect/types';
import type {
  ConnectionReferences,
  OpenExternalHandler,
} from '../types';
import { normalizeHttpUrl } from '../external-url';
import { copyToClipboard } from '../ui-clipboard';
import type { OutputPreferences } from '../output-preferences';
import { REFERENCE_ICONS } from '../ui-assets';
import {
  FORM_FIELD_IDS,
  formatConnectionUpdatedAt,
  getCopyFeedback,
  type CopyStatus,
  type FormErrors,
  type FormField,
} from '../ui-state';

/** Insert a text-style comment into the Style CSS block after the last `color:` declaration. */
export function insertTextStyleComment(css: string, textStyleName?: string): string {
  if (!textStyleName || css.length === 0) {
    return css;
  }
  const comment = `/* Text style: "${textStyleName}" */`;
  const lines = css.split('\n');
  let lastColorIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('color:')) {
      lastColorIndex = i;
    }
  }
  if (lastColorIndex === -1) {
    return `${comment}\n${css}`;
  }
  lines.splice(lastColorIndex + 1, 0, comment);
  return lines.join('\n');
}

export function AccessibilityBadges(props: { findings: NonNullable<FrameInspection['accessibility']> }): h.JSX.Element | null {
  if (props.findings.length === 0) return null;
  return (
    <section aria-label="Accessibility checks" class="accessibility-checks">
      <h2>Accessibility</h2>
      <div class="accessibility-badges">
        {props.findings.map((finding) => (
          <span class={`accessibility-badge accessibility-badge-${finding.status}`} key={finding.check} title={finding.message}>
            {finding.status === 'pass' ? '✓' : '⚠'} {finding.check.replace('-', ' ')}
          </span>
        ))}
      </div>
      {props.findings.filter((finding) => finding.status === 'warning').map((finding) => (
        <p key={`${finding.check}-warning`}>{finding.message}</p>
      ))}
    </section>
  );
}

export function ConnectionReferencesPanel(props: {
  references: ConnectionReferences;
}): h.JSX.Element {
  const references = props.references;
  const updatedAt = formatConnectionUpdatedAt(references.updatedAt);
  const hasReferences = Boolean(
    references.storybookUrl
    || references.sourcePath
    || references.sourceUrl
    || references.updatedAt,
  );

  return (
    <section aria-labelledby="tashil-references-heading" class="reference-section">
      <h2 class="reference-section-heading" id="tashil-references-heading">References</h2>
      {hasReferences ? (
        <dl class="reference-list">
          {references.storybookUrl ? (
            <ReferenceUrlRow
              label="Storybook"
              target="storybook"
              url={references.storybookUrl}
            />
          ) : null}
          {references.sourceUrl ? (
            <ReferenceUrlRow
              label="Source URL"
              target="source"
              url={references.sourceUrl}
            />
          ) : null}
          {references.sourcePath ? (
            <div class="reference-row">
              <ReferenceIcon source="folder" />
              <div class="reference-copy">
                <dt class="reference-label">Source path</dt>
                <dd class="reference-value reference-path">{references.sourcePath}</dd>
              </div>
            </div>
          ) : null}
          {references.updatedAt ? (
            <div class="reference-row">
              <ReferenceIcon source="time" />
              <div class="reference-copy">
                <dt class="reference-label">Last updated</dt>
                <dd class="reference-value reference-date">
                  {updatedAt ? (
                    <time dateTime={updatedAt.dateTime}>{updatedAt.label}</time>
                  ) : (
                    'Not available'
                  )}
                </dd>
              </div>
            </div>
          ) : null}
        </dl>
      ) : (
        <p class="reference-empty">No references saved.</p>
      )}
    </section>
  );
}

export function ReferenceUrlRow(props: {
  label: string;
  target: 'source' | 'storybook';
  url: string;
}): h.JSX.Element {
  const url = normalizeHttpUrl(props.url);

  return (
    <div class="reference-row">
      <ReferenceIcon source={props.target} />
      <div class="reference-copy">
        <dt class="reference-label">{props.label}</dt>
        <dd class="reference-value">
          <span class="reference-url">{props.url}</span>
          {!url ? (
            <span class="reference-warning">
              This saved URL is not a valid HTTP(S) address. Update it in Connect Component.
            </span>
          ) : null}
        </dd>
      </div>
      {url ? (
        <button
          aria-label={`Open ${props.label} in browser`}
          class="reference-open-button"
          onClick={() => {
            emit<OpenExternalHandler>('OPEN_EXTERNAL', {
              target: props.target,
              url,
            });
          }}
          title={`Open ${props.label} in browser`}
          type="button"
        >
          <IconNewTab24 />
        </button>
      ) : null}
    </div>
  );
}

export function ReferenceIcon(props: {
  source: 'folder' | 'source' | 'storybook' | 'time';
}): h.JSX.Element {
  if (props.source === 'folder') {
    return <span aria-hidden="true" class="reference-icon"><IconFolder24 /></span>;
  }
  if (props.source === 'time') {
    return <span aria-hidden="true" class="reference-icon"><IconTimeSmall24 /></span>;
  }

  return (
    <span
      aria-hidden="true"
      class={`reference-icon reference-icon-${props.source}`}
    >
      <img alt="" src={REFERENCE_ICONS[props.source]} />
    </span>
  );
}

export function EmptyInspectState(props: {
  actionLabel?: string;
  icon: h.JSX.Element;
  label: string;
  onAction?: () => void;
}): h.JSX.Element {
  return (
    <main class="inspect-empty">
      <div aria-hidden="true" class="inspect-empty-icon">
        {props.icon}
      </div>
      <h1 class="inspect-empty-label">{props.label}</h1>
      {props.actionLabel && props.onAction ? (
        <Button onClick={props.onAction}>
          {props.actionLabel}
        </Button>
      ) : null}
    </main>
  );
}

export function CodeBlock(props: {
  code: string;
  copyText?: string;
  direction?: OutputPreferences['previewDirection'];
  title: string;
  copyLabel?: string;
  regionLabel?: string;
}): h.JSX.Element {
  const lines = props.code.length > 0 ? props.code.split('\n') : [''];
  const headingId = props.title === 'Code'
    ? 'tashil-generated-code-heading'
    : props.title === 'Mapping diagnostics'
      ? 'tashil-mapping-diagnostics-heading'
      : `tashil-code-heading-${props.title.toLowerCase()}`;
  const regionLabel = props.regionLabel
    ?? (props.title === 'Code'
      ? 'Generated TSX code, horizontally scrollable'
      : props.title === 'Mapping diagnostics'
        ? 'Prop mapping diagnostics, horizontally scrollable'
        : `${props.title} code, horizontally scrollable`);
  const copyLabel = props.copyLabel ?? props.title;

  return (
    <section class="code-section">
      <div class="code-section-header">
        <h2 class="code-section-heading" id={headingId}>{props.title}</h2>
        <CopyButton text={props.copyText ?? props.code} title={copyLabel} />
      </div>
      <pre aria-label={regionLabel} class="code-block" dir={props.direction} role="region" tabIndex={0}>
        <code>
          {lines.map((line, index) => (
            <span class="code-line" key={`${props.title}-${index}`}>
              <span aria-hidden="true" class="code-line-number">{index + 1}</span>
              <span class="code-line-content">{renderCodeLine(line)}</span>
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}

export function CopyButton(props: { text: string; title: string }): h.JSX.Element {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const resetCopyStatusTimerRef = useRef<number>();
  const copyFeedback = getCopyFeedback(copyStatus, props.title);

  useEffect(() => () => {
    if (resetCopyStatusTimerRef.current !== undefined) {
      window.clearTimeout(resetCopyStatusTimerRef.current);
    }
  }, []);

  async function handleCopy(): Promise<void> {
    if (resetCopyStatusTimerRef.current !== undefined) {
      window.clearTimeout(resetCopyStatusTimerRef.current);
    }

    try {
      await copyToClipboard(props.text);
      setCopyStatus('copied');
    } catch (_error) {
      setCopyStatus('error');
    }

    resetCopyStatusTimerRef.current = window.setTimeout(() => {
      setCopyStatus('idle');
    }, 3000);
  }

  return (
    <Fragment>
      <IconButton
        aria-label={copyFeedback.ariaLabel}
        onClick={() => {
          void handleCopy();
        }}
        title={copyFeedback.ariaLabel}
      >
        {copyStatus === 'copied' ? <IconCheck24 /> : <IconCopySmall24 />}
      </IconButton>
      <span aria-atomic="true" aria-live="polite" class="visually-hidden" role="status">
        {copyFeedback.message}
      </span>
    </Fragment>
  );
}

export function renderCodeLine(line: string): Array<h.JSX.Element | string> | string {
  if (line.length === 0) {
    return ' ';
  }

  const tokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|default|export|from|function|import|let|return|var)\b|<\/?[A-Z][A-Za-z0-9.:-]*(?=[\s>/])|[A-Za-z_$][A-Za-z0-9_$-]*(?=\s*=)|[{}]|\/?>)/g;
  const parts: Array<h.JSX.Element | string> = [];
  const expressionContainsJsx: boolean[] = [];
  let cursor = 0;
  let match = tokens.exec(line);

  while (match !== null) {
    const token = match[0];

    if (match.index > cursor) {
      parts.push(line.slice(cursor, match.index));
    }

    if (/^<\/?[A-Z]/.test(token) && expressionContainsJsx.length > 0) {
      expressionContainsJsx[expressionContainsJsx.length - 1] = true;
    }

    const isScalarExpressionValue = expressionContainsJsx.length > 0
      && !expressionContainsJsx[expressionContainsJsx.length - 1];

    parts.push(
      <span
        class={getSyntaxClassName(token, isScalarExpressionValue)}
        key={`${match.index}-${token}`}
      >
        {token}
      </span>
    );

    if (token === '{') {
      expressionContainsJsx.push(false);
    } else if (token === '}') {
      expressionContainsJsx.pop();
    }

    cursor = match.index + token.length;
    match = tokens.exec(line);
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }

  return parts;
}

export function getSyntaxClassName(token: string, isScalarExpressionValue = false): string {
  if (isScalarExpressionValue && /^["'`]/.test(token)) {
    return 'syntax-expression';
  }
  if (/^["'`]/.test(token)) {
    return 'syntax-string';
  }
  if (/^(const|default|export|from|function|import|let|return|var)$/.test(token)) {
    return 'syntax-keyword';
  }
  if (/^<\/?[A-Z]/.test(token)) {
    return 'syntax-tag';
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(token)) {
    return 'syntax-attribute';
  }
  if (/^[{}]$/.test(token)) {
    return 'syntax-expression';
  }
  return 'syntax-punctuation';
}

export function Field(props: {
  children: h.JSX.Element;
  error?: string;
  id: string;
  label: string;
}): h.JSX.Element {
  return (
    <div class="field">
      <label class="field-label" htmlFor={props.id}>
        {props.label}
      </label>
      {props.children}
      {props.error ? (
        <div class="field-error" id={`${props.id}-error`}>
          {props.error}
        </div>
      ) : null}
    </div>
  );
}

export function getFieldErrorId(field: FormField, errors: FormErrors): string | undefined {
  return errors[field] ? `${FORM_FIELD_IDS[field]}-error` : undefined;
}
