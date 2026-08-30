import {
  Dropdown,
  SegmentedControl,
  Textbox,
  Toggle,
} from '@create-figma-plugin/ui';
import { h } from 'preact';
import type { OutputPreferences } from '../output-preferences';
import { Field } from '../components/common';

export function OutputSettingsView(props: {
  message: string;
  onChange: (preferences: OutputPreferences) => void;
  preferences: OutputPreferences;
}): h.JSX.Element {
  const update = <K extends keyof OutputPreferences>(key: K, value: OutputPreferences[K]): void => {
    props.onChange({ ...props.preferences, [key]: value });
  };
  return (
    <main aria-labelledby="output-settings-heading" class="output-settings-view">
      <h1 id="output-settings-heading">Output settings</h1>
      <p>Stored for your Figma user only. Defaults preserve existing generated output.</p>
      <div class="output-settings-grid">
        <Field id="output-quote-style" label="Quote style">
          <SegmentedControl
            onValueChange={(value) => update('quoteStyle', value as OutputPreferences['quoteStyle'])}
            options={[{ value: 'double', children: 'Double' }, { value: 'single', children: 'Single' }]}
            value={props.preferences.quoteStyle}
          />
        </Field>
        <Field id="output-indentation" label="Indentation">
          <Dropdown
            onValueChange={(value) => update('indentation', value as OutputPreferences['indentation'])}
            options={[{ value: '2', text: '2 spaces' }, { value: '4', text: '4 spaces' }, { value: 'tab', text: 'Tabs' }]}
            value={props.preferences.indentation}
          />
        </Field>
        <Field id="output-copy-mode" label="Copy mode">
          <Dropdown
            onValueChange={(value) => update('copyMode', value as OutputPreferences['copyMode'])}
            options={[{ value: 'full', text: 'Full output' }, { value: 'without-imports', text: 'Without imports' }, { value: 'imports-only', text: 'Imports only' }]}
            value={props.preferences.copyMode}
          />
        </Field>
        <Field id="output-preview-direction" label="Preview direction">
          <SegmentedControl
            onValueChange={(value) => update('previewDirection', value as OutputPreferences['previewDirection'])}
            options={[{ value: 'ltr', children: 'LTR' }, { value: 'rtl', children: 'RTL' }]}
            value={props.preferences.previewDirection}
          />
        </Field>
        <Field id="output-styled-pattern" label="Styled-component naming pattern">
          <Textbox
            onValueInput={(value) => { if (value.includes('{Name}')) update('styledComponentPattern', value); }}
            value={props.preferences.styledComponentPattern}
          />
        </Field>
        <Toggle onValueChange={(value) => update('semicolons', value)} value={props.preferences.semicolons}>Semicolons</Toggle>
        <Toggle onValueChange={(value) => update('trailingComma', value)} value={props.preferences.trailingComma}>Trailing commas</Toggle>
      </div>
      <p aria-live="polite" role="status">{props.message}</p>
    </main>
  );
}
