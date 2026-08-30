import { Fragment, h } from 'preact';
import type { FrameInspection } from '../inspect/types';
import type { ReactLayoutResult } from '../layout/types';
import type { VariantLogicResult } from '../layout/variant-logic';
import type { InspectCodeState } from '../types';
import { formatCssBlock } from '../inspect/css-partition';
import { formatUsageSnippet } from '../inspect/usage-snippet';
import { selectCopyContent, type OutputPreferences } from '../output-preferences';
import {
  IconDetach48,
  IconInteractionClickSmall48,
} from '../ui-assets';
import {
  AccessibilityBadges,
  CodeBlock,
  ConnectionReferencesPanel,
  EmptyInspectState,
  insertTextStyleComment,
} from '../components/common';

export function InspectCodeView(props: {
  copyMode: OutputPreferences['copyMode'];
  inspectCodeState: InspectCodeState;
  onGoToConnect: () => void;
  previewDirection: OutputPreferences['previewDirection'];
}): h.JSX.Element {
  const { inspectCodeState } = props;

  if (inspectCodeState.status === 'invalid-selection') {
    return (
      <EmptyInspectState
        icon={<IconInteractionClickSmall48 />}
        label={inspectCodeState.message || 'Select a layer to inspect it'}
      />
    );
  }

  if (inspectCodeState.status === 'not-connected') {
    return (
      <EmptyInspectState
        actionLabel="Go to Connect Component"
        icon={<IconDetach48 />}
        label="This component isn't connected"
        onAction={props.onGoToConnect}
      />
    );
  }

  if (inspectCodeState.status === 'connection-issue') {
    return (
      <EmptyInspectState
        icon={<IconDetach48 />}
        label={inspectCodeState.message || 'Stored connection needs attention'}
      />
    );
  }

  if (inspectCodeState.status === 'inspection') {
    return <InspectionView copyMode={props.copyMode} inspection={inspectCodeState.inspection} />;
  }

  if (inspectCodeState.status === 'layout') {
    return (
      <ReactLayoutView
        inspection={inspectCodeState.inspection}
        copyMode={props.copyMode}
        layout={inspectCodeState.layout}
        showUnconnectedComponents={inspectCodeState.showUnconnectedComponents}
        variantLogic={inspectCodeState.variantLogic}
      />
    );
  }

  const output = inspectCodeState.output;
  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">Inspect code</h1>
      {output.deprecation ? (
        <div class="connection-health connection-health-needs-review" role="note">
          <div class="connection-health-heading">
            <strong>⚠️ Deprecated</strong>
          </div>
          <small>{output.deprecation}</small>
        </div>
      ) : null}
      <CodeBlock
        code={output.code}
        copyText={selectCopyContent(output.code, props.copyMode)}
        direction={props.previewDirection}
        title="Code"
      />
      {output.runtimeRequirements ? (
        <CodeBlock
          code={output.runtimeRequirements}
          title="Set in application"
        />
      ) : null}
      {output.diagnostics ? (
        <CodeBlock
          code={output.diagnostics}
          title="Mapping diagnostics"
        />
      ) : null}
      {output.explanation ? (
        <CodeBlock
          code={output.explanation}
          title="Why this structure?"
        />
      ) : null}
      <ConnectionReferencesPanel references={output.references || {}} />
    </main>
  );
}

export function ReactLayoutView(props: {
  copyMode: OutputPreferences['copyMode'];
  inspection?: FrameInspection;
  layout: ReactLayoutResult;
  showUnconnectedComponents?: boolean;
  variantLogic?: VariantLogicResult;
}): h.JSX.Element {
  const {
    inspection,
    layout,
    showUnconnectedComponents = false,
    variantLogic,
  } = props;
  const layoutCss = inspection ? formatCssBlock(inspection.css.layout) : '';
  const styleCss = inspection
    ? insertTextStyleComment(formatCssBlock(inspection.css.style), inspection.textStyleName)
    : '';
  const unconnectedComponents = showUnconnectedComponents
    ? Array.from(new Set(
        [...layout.diagnostics, ...(inspection?.diagnostics ?? [])]
          .filter((diagnostic) => diagnostic.reason === 'unconnected-instance')
          .map((diagnostic) => {
            const path = diagnostic.layerPath ?? [];
            return path[path.length - 1];
          })
          .filter((name): name is string => Boolean(name)),
      ))
    : [];

  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">
        Generated React layout
      </h1>
      <AccessibilityBadges findings={inspection?.accessibility ?? []} />

      <section class="layout-card" aria-labelledby="tashil-layout-name">
        <div class="layout-card-topline">
          <div>
            <div class="eyebrow">
              {showUnconnectedComponents ? 'React frame structure' : 'React layout'}
            </div>
            <h2 class="layout-card-name" id="tashil-layout-name">{layout.nodeName}</h2>
          </div>
          <span class="layout-status-pill">{layout.nodeType}</span>
        </div>
        {unconnectedComponents.length > 0 ? (
          <div
            aria-label="Component connection status"
            class="layout-component-list"
          >
            {unconnectedComponents.map((componentName) => (
              <div class="layout-component-row" key={componentName}>
                <span class="layout-component-name">{componentName}</span>
                <span class="layout-connection-pill">Not connected</span>
              </div>
            ))}
          </div>
        ) : null}
        <div class="layout-summary-row">
          <span>Connected components</span>
          <span class="layout-summary-value">{layout.componentCount}</span>
        </div>
        <div class="layout-summary-row">
          <span>Generated wrappers</span>
          <span class="layout-summary-value">{layout.wrapperCount}</span>
        </div>
        <div class="layout-summary-row">
          <span>Unresolved components</span>
          <span class="layout-summary-value">{layout.fidelity?.unresolvedComponents ?? 0}</span>
        </div>
        <div class="layout-summary-row">
          <span>Unsupported assets</span>
          <span class="layout-summary-value">{layout.fidelity?.unsupportedAssets ?? 0}</span>
        </div>
        <div class="layout-summary-row">
          <span>Omitted declarations</span>
          <span class="layout-summary-value">{layout.fidelity?.omittedDeclarations ?? 0}</span>
        </div>
        {variantLogic ? (
          <Fragment>
            <div class="layout-summary-row">
              <span>Variant axes</span>
              <span class="layout-summary-value">{variantLogic.axisCount}</span>
            </div>
            <div class="layout-summary-row">
              <span>Valid combinations</span>
              <span class="layout-summary-value">{variantLogic.combinationCount}</span>
            </div>
          </Fragment>
        ) : null}
      </section>

      {layoutCss ? <CodeBlock code={layoutCss} title="Layout" copyLabel="Copy Layout CSS" /> : null}
      {styleCss ? <CodeBlock code={styleCss} title="Style" copyLabel="Copy Style CSS" /> : null}

      <CodeBlock
        code={layout.tsx}
        copyText={selectCopyContent(layout.tsx, props.copyMode)}
        copyLabel="Copy generated React"
        title={`${layout.componentName}.tsx`}
      />

      {variantLogic ? (
        <CodeBlock
          code={variantLogic.code}
          copyLabel="Copy variant logic"
          title="Variant logic"
        />
      ) : null}

      {(layout.runtimeRequirements?.length ?? 0) > 0 ? (
        <CodeBlock
          code={layout.runtimeRequirements?.join('\n') ?? ''}
          title="Set in application"
        />
      ) : null}

      {layout.diagnostics.length > 0 ? (
        <section class="layout-section" aria-labelledby="tashil-layout-notes-heading">
          <h3 class="layout-section-heading" id="tashil-layout-notes-heading">
            Generation notes
          </h3>
          <ul class="layout-diagnostics">
            {layout.diagnostics.map((diagnostic, index) => (
              <li
                key={index}
                class={`layout-diagnostic layout-diagnostic-${diagnostic.severity}`}
              >
                <span class="layout-diagnostic-icon" aria-hidden="true">
                  {diagnostic.severity === 'error' ? '⛔' : diagnostic.severity === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <span class="layout-diagnostic-message">{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

export function InspectionView(props: { copyMode: OutputPreferences['copyMode']; inspection: FrameInspection }): h.JSX.Element {
  const { inspection } = props;
  const layoutCss = formatCssBlock(inspection.css.layout);
  const styleCss = insertTextStyleComment(
    formatCssBlock(inspection.css.style),
    inspection.textStyleName,
  );
  const componentCount = inspection.connectedComponents.length;

  return (
    <main aria-labelledby="tashil-inspect-code-heading" class="inspect-content">
      <h1 class="visually-hidden" id="tashil-inspect-code-heading">Inspect code</h1>
      <AccessibilityBadges findings={props.inspection.accessibility ?? []} />

      <section class="layout-card" aria-labelledby="tashil-inspection-name">
        <div class="layout-card-topline">
          <div>
            <div class="eyebrow">Inspecting</div>
            <h2 class="layout-card-name" id="tashil-inspection-name">{inspection.nodeName}</h2>
          </div>
          <span class="layout-status-pill">{inspection.nodeType}</span>
        </div>
        <div class="layout-summary-row">
          <span>Connected components</span>
          <span class="layout-summary-value">
            {componentCount === 0 ? 'None' : componentCount}
          </span>
        </div>
      </section>

      {layoutCss ? <CodeBlock code={layoutCss} title="Layout" copyLabel="Copy Layout CSS" /> : null}
      {styleCss ? <CodeBlock code={styleCss} title="Style" copyLabel="Copy Style CSS" /> : null}

      {componentCount > 0 ? (
        <section class="layout-section" aria-labelledby="tashil-inspection-components-heading">
          <h3 class="layout-section-heading" id="tashil-inspection-components-heading">
            Connected components
          </h3>
          <ul class="inspect-entries">
            {inspection.connectedComponents.map((entry) => (
              <li key={entry.nodeId} class="inspect-entry">
                <div class="inspect-entry-path">{entry.layerPath.join(' / ')}</div>
                <CodeBlock
                  code={formatUsageSnippet(entry.usage)}
                  copyText={selectCopyContent(formatUsageSnippet(entry.usage), props.copyMode)}
                  title={entry.componentName}
                  copyLabel={`Copy ${entry.componentName}`}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inspection.diagnostics.length > 0 ? (
        <section class="layout-section" aria-labelledby="tashil-inspection-notes-heading">
          <h3 class="layout-section-heading" id="tashil-inspection-notes-heading">Notes</h3>
          <ul class="layout-diagnostics">
            {inspection.diagnostics.map((diagnostic, index) => (
              <li
                key={index}
                class={`layout-diagnostic layout-diagnostic-${diagnostic.severity}`}
              >
                <span class="layout-diagnostic-icon" aria-hidden="true">
                  {diagnostic.severity === 'error' ? '⛔' : diagnostic.severity === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <span class="layout-diagnostic-message">{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
