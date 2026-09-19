import {
  Button,
  Dropdown,
  SegmentedControl,
  Textbox,
  Toggle,
} from '@create-figma-plugin/ui';
import { h } from 'preact';
import {
  DEFAULT_OUTPUT_PREFERENCES,
  formatGeneratedCode,
  selectCopyContent,
  type OutputPreferences,
} from '../output-preferences';
import { CodeBlock, Field } from '../components/common';

export const STYLED_PRESETS = [
  { description: 'Root element suffix (default)', label: '{Name}Root', pattern: '{Name}Root' },
  { description: 'Container element wrapper', label: '{Name}Container', pattern: '{Name}Container' },
  { description: 'Generic wrapper suffix', label: '{Name}Wrapper', pattern: '{Name}Wrapper' },
  { description: 'Styled component suffix', label: '{Name}Styled', pattern: '{Name}Styled' },
  { description: 'Box primitive suffix', label: '{Name}Box', pattern: '{Name}Box' },
] as const;

export const SAMPLE_COMPONENT_CODE = `import React from 'react';
import styled from 'styled-components';

export const ButtonRoot = styled.button\`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-weight: 500;
  cursor: pointer;
\`;

export function Button(props) {
  return (
    <ButtonRoot disabled={props.disabled} type="button">
      <span>{props.label}</span>
    </ButtonRoot>
  );
}`;

function SyntaxIcon(): h.JSX.Element {
  return (
    <svg aria-hidden="true" class="settings-section-icon" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <path d="M5.5 3.5L2.5 8L5.5 12.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M10.5 3.5L13.5 8L10.5 12.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M9.5 2.5L6.5 13.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function ArchitectureIcon(): h.JSX.Element {
  return (
    <svg aria-hidden="true" class="settings-section-icon" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="2" y="2" />
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="9" y="2" />
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="2" y="9" />
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="9" y="9" />
    </svg>
  );
}

function WorkspaceIcon(): h.JSX.Element {
  return (
    <svg aria-hidden="true" class="settings-section-icon" fill="none" height="16" viewBox="0 0 16 16" width="16">
      <path d="M10.5 2.5H12.5C13.0523 2.5 13.5 2.94772 13.5 3.5V13.5C13.5 14.0523 13.0523 14.5 12.5 14.5H3.5C2.94772 14.5 2.5 14.0523 2.5 13.5V3.5C2.5 2.94772 2.94772 2.5 3.5 2.5H5.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <rect height="3" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="5.5" y="1.5" />
    </svg>
  );
}

export function OutputSettingsView(props: {
  message: string;
  onChange: (preferences: OutputPreferences) => void;
  preferences: OutputPreferences;
}): h.JSX.Element {
  const update = <K extends keyof OutputPreferences>(key: K, value: OutputPreferences[K]): void => {
    props.onChange({ ...props.preferences, [key]: value });
  };

  const handleReset = (): void => {
    props.onChange({ ...DEFAULT_OUTPUT_PREFERENCES });
  };

  const formattedSample = formatGeneratedCode(SAMPLE_COMPONENT_CODE, props.preferences);
  const copyContentSample = selectCopyContent(formattedSample, props.preferences.copyMode);
  const previewSampleName = props.preferences.styledComponentPattern.replace('{Name}', 'Button');

  return (
    <main aria-labelledby="output-settings-heading" class="output-settings-view">
      <header class="settings-view-header">
        <div class="settings-view-heading-group">
          <div class="settings-title-row">
            <h1 id="output-settings-heading">Output settings</h1>
            <span class="settings-storage-badge">User-local (clientStorage)</span>
          </div>
          <p class="settings-view-subtitle">
            Personalized code generation preferences stored for your Figma user account.
          </p>
        </div>

        <div class="settings-status-bar">
          <div aria-live="polite" class="settings-status-pill" role="status">
            <span class={`settings-status-dot ${props.message ? 'settings-status-dot-pulse' : ''}`} />
            <span class="settings-status-label">{props.message || 'Saved to user storage'}</span>
          </div>
          <Button onClick={handleReset} secondary>
            Reset defaults
          </Button>
        </div>
      </header>

      <div class="settings-bento-grid">
        <div class="settings-controls-column">
          {/* Section 1: Code Formatting */}
          <section aria-labelledby="settings-syntax-heading" class="settings-card">
            <div class="settings-card-header">
              <SyntaxIcon />
              <div>
                <h2 class="settings-card-title" id="settings-syntax-heading">Syntax & Formatting</h2>
                <p class="settings-card-desc">Control quote styles, semicolons, and code indentation rules.</p>
              </div>
            </div>

            <div class="settings-card-body">
              <div class="settings-form-row">
                <Field id="output-quote-style" label="Quote style">
                  <SegmentedControl
                    onValueChange={(value) => update('quoteStyle', value as OutputPreferences['quoteStyle'])}
                    options={[
                      { children: 'Double', value: 'double' },
                      { children: 'Single', value: 'single' },
                    ]}
                    value={props.preferences.quoteStyle}
                  />
                </Field>
                <Field id="output-indentation" label="Indentation">
                  <Dropdown
                    aria-label="Indentation spacing"
                    onValueChange={(value) => update('indentation', value as OutputPreferences['indentation'])}
                    options={[
                      { text: '2 spaces', value: '2' },
                      { text: '4 spaces', value: '4' },
                      { text: 'Tabs', value: 'tab' },
                    ]}
                    value={props.preferences.indentation}
                  />
                </Field>
              </div>

              <div class="settings-toggles-row">
                <Toggle
                  onValueChange={(value) => update('semicolons', value)}
                  value={props.preferences.semicolons}
                >
                  Semicolons
                </Toggle>
                <Toggle
                  onValueChange={(value) => update('trailingComma', value)}
                  value={props.preferences.trailingComma}
                >
                  Trailing commas
                </Toggle>
              </div>
            </div>
          </section>

          {/* Section 2: Styled-Component Pattern */}
          <section aria-labelledby="settings-styled-heading" class="settings-card">
            <div class="settings-card-header">
              <ArchitectureIcon />
              <div>
                <h2 class="settings-card-title" id="settings-styled-heading">Component Architecture</h2>
                <p class="settings-card-desc">Define how styled wrapper elements are named across generated TSX.</p>
              </div>
            </div>

            <div class="settings-card-body">
              <Field id="output-styled-pattern" label="Styled-component naming pattern">
                <Textbox
                  onValueInput={(value) => {
                    if (value.includes('{Name}')) update('styledComponentPattern', value);
                  }}
                  value={props.preferences.styledComponentPattern}
                />
              </Field>

              <div class="settings-presets-block">
                <span class="settings-presets-label">Quick presets:</span>
                <div aria-label="Pattern presets" class="settings-preset-chips" role="group">
                  {STYLED_PRESETS.map((preset) => {
                    const isSelected = props.preferences.styledComponentPattern === preset.pattern;
                    return (
                      <button
                        aria-pressed={isSelected}
                        class={`settings-chip ${isSelected ? 'settings-chip-selected' : ''}`}
                        key={preset.pattern}
                        onClick={() => update('styledComponentPattern', preset.pattern)}
                        title={preset.description}
                        type="button"
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div class="settings-naming-example">
                <span class="settings-example-label">Output example:</span>
                <span class="settings-example-code">
                  <code>Button</code> → <code class="settings-code-highlight">{previewSampleName}</code>
                </span>
              </div>
            </div>
          </section>

          {/* Section 3: Workspace & Clipboard */}
          <section aria-labelledby="settings-workspace-heading" class="settings-card">
            <div class="settings-card-header">
              <WorkspaceIcon />
              <div>
                <h2 class="settings-card-title" id="settings-workspace-heading">Clipboard & Workspace</h2>
                <p class="settings-card-desc">Configure copy button behavior and layout preview direction.</p>
              </div>
            </div>

            <div class="settings-card-body">
              <div class="settings-form-row">
                <Field id="output-copy-mode" label="Copy mode">
                  <Dropdown
                    aria-label="Clipboard copy mode"
                    onValueChange={(value) => update('copyMode', value as OutputPreferences['copyMode'])}
                    options={[
                      { text: 'Full output', value: 'full' },
                      { text: 'Without imports', value: 'without-imports' },
                      { text: 'Imports only', value: 'imports-only' },
                    ]}
                    value={props.preferences.copyMode}
                  />
                </Field>
                <Field id="output-preview-direction" label="Preview direction">
                  <SegmentedControl
                    onValueChange={(value) => update('previewDirection', value as OutputPreferences['previewDirection'])}
                    options={[
                      { children: 'LTR', value: 'ltr' },
                      { children: 'RTL', value: 'rtl' },
                    ]}
                    value={props.preferences.previewDirection}
                  />
                </Field>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Live Code Preview */}
        <div class="settings-preview-column">
          <section aria-labelledby="settings-preview-heading" class="settings-card settings-preview-card">
            <div class="settings-card-header settings-preview-header">
              <div>
                <div class="settings-preview-pill">Interactive Live Preview</div>
                <h2 class="settings-card-title" id="settings-preview-heading">Code formatting sample</h2>
              </div>
              <span class="settings-copy-mode-tag">
                Copy: {props.preferences.copyMode}
              </span>
            </div>
            <p class="settings-card-desc">
              Real-time representation of your active formatting rules applied to styled components.
            </p>

            <div class="settings-preview-code-box">
              <CodeBlock
                code={formattedSample}
                copyLabel="Copy sample component code"
                copyText={copyContentSample}
                direction={props.preferences.previewDirection}
                title="Formatted code"
              />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
