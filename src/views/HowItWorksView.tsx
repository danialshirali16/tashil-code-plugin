import {
  Container,
  Stack,
  Text,
  VerticalSpace,
} from '@create-figma-plugin/ui';
import { h } from 'preact';

export function HowItWorksView(): h.JSX.Element {
  return (
    <main aria-labelledby="tashil-help-heading" class="help-page">
      <Container space="medium">
        <VerticalSpace space="medium" />
        <div class="section-heading">
          <h1 class="page-heading" id="tashil-help-heading" tabIndex={-1}>Workflow</h1>
          <Text>Use setup in Design mode, then copy generated code in Dev Mode.</Text>
        </div>
        <VerticalSpace space="medium" />
        <Stack space="large">
          <HelpSection title="What this plugin does">
            <Text>
              Tashil Code connects a Figma main component or component set to Storybook/source metadata.
              After saving the connection, developers can select an instance in Dev Mode and copy the
              generated Tashil UI usage snippet from the Code panel.
            </Text>
          </HelpSection>

          <HelpSection title="Connect a component">
            <ol class="help-list">
              <li>Select a main component, component set, or component instance in Figma.</li>
              <li>Open Plugins, Tashil Code, Connect component.</li>
              <li>Confirm the Figma name, then enter the Source component name and Import path.</li>
              <li>Add optional Storybook and source references.</li>
              <li>Upload the component's .ts/.tsx source files.</li>
              <li>Connect each code prop and value to its matching Figma property and variant.</li>
              <li>Click Save. The data is stored on the selected main component as shared plugin data.</li>
            </ol>
          </HelpSection>

          <HelpSection title="Use it in Dev Mode">
            <ol class="help-list">
              <li>Switch to Dev Mode and select a connected component instance.</li>
              <li>Open the Code section and choose Tashil UI.</li>
              <li>Copy the generated TSX, open reference links, and copy the source path.</li>
            </ol>
          </HelpSection>

          <HelpSection title="Connection fields">
            <div class="help-table">
              <HelpRow label="Figma component name" value="Selected design component used as the connection reference." />
              <HelpRow label="Source component name" value="React component export used in generated code, for example Button." />
              <HelpRow label="Import path" value="Package import path, for example tashil-ui." />
              <HelpRow label="Storybook URL" value="The matching Storybook story or docs page." />
              <HelpRow label="Source path" value="The source file path for developer reference." />
              <HelpRow label="Source URL" value="An optional browser link to the source file." />
              <HelpRow label="Source & prop mappings" value="Upload TypeScript and visually connect code props to Figma properties." />
              <HelpRow label="Connection health" value="Re-upload source and review Figma changes before confirming updates." />
              <HelpRow label="Custom mappings" value="Optional wildcard/raw JSON for cases the visual rows cannot represent." />
            </div>
          </HelpSection>

          <HelpSection title="Keep a connection up to date">
            <Text>
              The plugin compares the current Figma component with the saved snapshot. Re-upload
              source after code changes. Review additions, renames, removals, and type changes;
              stale mappings remain visible until you explicitly remove them and save. Healthy,
              Needs review, Broken, and Source refresh required describe the current state.
            </Text>
          </HelpSection>
        </Stack>
        <VerticalSpace space="medium" />
      </Container>
    </main>
  );
}

export function HelpSection(props: { children: h.JSX.Element | h.JSX.Element[]; title: string }): h.JSX.Element {
  return (
    <section class="help-section">
      <Stack space="small">
        <h2 class="help-section-heading">{props.title}</h2>
        {props.children}
      </Stack>
    </section>
  );
}

export function HelpRow(props: { label: string; value: string }): h.JSX.Element {
  return (
    <div class="help-row">
      <Text>{props.label}</Text>
      <Text>{props.value}</Text>
    </div>
  );
}
