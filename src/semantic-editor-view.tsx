import { Fragment, h } from 'preact';
import { useState } from 'preact/hooks';
import { renderImportLines } from './layout/imports';
import {
  OPTION_OMITTED,
  OPTION_RUNTIME,
  OPTION_STATIC,
  SECTION_LABELS,
  buildTargetRows,
  hasStructuralMismatch,
  validateRecipeDraft,
  type SemanticTargetRow,
} from './semantic/authoring';
import { resolveSemanticUsage } from './semantic/resolver';
import {
  isRemoveOnly,
  type ReconciliationAction,
  type ReconciliationProposal,
} from './semantic/reconcile';
import type { SemanticConnectionRecipe } from './semantic/types';
import type { FigmaComponentSnapshot, SourcePropValue } from './types';

export type SemanticMappingViewProps = {
  componentName: string;
  importPath: string;
  disabled: boolean;
  error?: string;
  figmaSnapshot?: FigmaComponentSnapshot;
  recipe?: SemanticConnectionRecipe;
  proposals?: readonly ReconciliationProposal[];
  onApplyProposal?: (proposal: ReconciliationProposal, action: ReconciliationAction) => void;
  onExportDebugBundle?: () => void;
  onValueMappingChange?: (
    targetPath: readonly string[],
    sourceValue: SourcePropValue,
    figmaOption: string,
  ) => void;
  /** Replace the uploaded source from inside the single mapping card. */
  onFilesSelected?: (files: readonly File[]) => void;
  sourceUploading?: boolean;
  onOptionChange: (
    targetPath: readonly string[],
    optionId: string,
    staticValue?: SourcePropValue,
  ) => void;
};

/**
 * Implementation mapping editor (semantic connect, roadmap M3).
 *
 * Code props stay the primary column; every target gets exactly one
 * searchable value control listing eligible Figma values, static, runtime,
 * and omitted choices. Structural mismatch is an informational note, never an
 * error. A live preview shows the generated usage before save.
 */
export function SemanticMappingView(props: SemanticMappingViewProps): h.JSX.Element | null {
  const [isDragging, setIsDragging] = useState(false);
  const recipe = props.recipe;
  if (!recipe?.sourceContract) {
    return null;
  }

  const rows = buildTargetRows(recipe, props.figmaSnapshot);
  const validation = validateRecipeDraft(recipe);
  const contract = recipe.sourceContract;
  const preview = createPreview(props.componentName, props.importPath, recipe);
  const uploadDisabled = props.disabled || props.sourceUploading === true;

  function submitFiles(files: readonly File[]): void {
    if (!uploadDisabled && files.length > 0) {
      props.onFilesSelected?.(files);
    }
  }

  let previousSection: SemanticTargetRow['section'] | undefined;

  return (
    <section
      aria-labelledby="tashil-semantic-heading"
      class={isDragging ? 'mapping-editor mapping-editor-dragging' : 'mapping-editor'}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!uploadDisabled && props.onFilesSelected) setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        submitFiles(Array.from(event.dataTransfer?.files ?? []));
      }}
    >
      <div class="mapping-editor-heading-row">
        <div>
          <div class="field-label" id="tashil-semantic-heading">Implementation mapping</div>
          <div class="mapping-help">
            Connect each code prop of the public API to the design value that feeds it.
          </div>
        </div>
        {props.onFilesSelected ? (
          <label class={uploadDisabled ? 'file-button file-button-disabled' : 'file-button'}>
            {props.sourceUploading ? 'Analyzing…' : 'Replace source'}
            <input
              accept=".ts,.tsx"
              disabled={uploadDisabled}
              multiple
              onInput={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                if (!uploadDisabled && files.length > 0) {
                  props.onFilesSelected?.(files);
                }
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>
        ) : null}
      </div>

      <div class="source-summary">
        <span class="source-icon" aria-hidden="true">{'</>'}</span>
        <span>
          <strong>{contract.componentName}</strong>
          <small>
            Code target · <span class="source-file">{contract.fileName}</span>
            {validation.progress.total > 0
              ? ` · ${validation.progress.completed}/${validation.progress.total} required values resolved`
              : ''}
          </small>
        </span>
      </div>

      {props.proposals && props.proposals.length > 0 ? (
        <ReconciliationPanel
          disabled={props.disabled}
          onApplyProposal={props.onApplyProposal}
          proposals={props.proposals}
        />
      ) : null}

      {hasStructuralMismatch(recipe) ? (
        <div class="mapping-help" role="note">
          The Figma layers and the code structure differ. That is expected: values from
          nested design regions feed the real component props below.
        </div>
      ) : null}

      <div class="mapping-rows">
        {rows.map((row) => {
          const sectionLabel = row.section !== previousSection
            ? SECTION_LABELS[row.section]
            : undefined;
          previousSection = row.section;
          return (
            <Fragment key={row.targetPath}>
              {sectionLabel ? (
                <div class="mapping-section-label">{sectionLabel}</div>
              ) : null}
              <SemanticTargetRowView
                disabled={props.disabled}
                onOptionChange={props.onOptionChange}
                onValueMappingChange={props.onValueMappingChange}
                row={row}
              />
            </Fragment>
          );
        })}
      </div>

      {validation.errors.length > 0 ? (
        <ul class="field-error" role="list">
          {validation.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}
      {validation.warnings.length > 0 ? (
        <ul class="mapping-help" role="list">
          {validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      {props.error ? (
        <div class="field-error" id="tashil-semantic-recipe-error">{props.error}</div>
      ) : null}

      {preview ? (
        <details class="advanced-mappings" open>
          <summary>Generated code preview</summary>
          <pre aria-label="Generated semantic usage preview" class="generated-json-preview">
            {preview}
          </pre>
        </details>
      ) : null}

      {props.onExportDebugBundle ? (
        <div class="mapping-card-footer">
          <button
            class="link-button"
            disabled={props.disabled}
            onClick={props.onExportDebugBundle}
            title="Records schema versions, mapping structure, and health only — no source code, URLs, design text, or layer names."
            type="button"
          >
            Export debug bundle
          </button>
          <small>Redacted: structure and health only.</small>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Suggested remaps for design/source drift, presented separately from the
 * confirmed mapping rows. Every change is explicit: safe remaps offer Accept,
 * unmappable ones offer only Remove, and nothing is applied automatically.
 */
function ReconciliationPanel(props: {
  disabled: boolean;
  onApplyProposal?: (proposal: ReconciliationProposal, action: ReconciliationAction) => void;
  proposals: readonly ReconciliationProposal[];
}): h.JSX.Element {
  return (
    <section
      aria-labelledby="tashil-semantic-reconcile-heading"
      class="connection-health connection-health-needs-review"
    >
      <div class="connection-health-heading">
        <strong id="tashil-semantic-reconcile-heading">Changes need review</strong>
      </div>
      <ul>
        {props.proposals.map((proposal) => {
          const removeOnly = isRemoveOnly(proposal.kind);
          return (
            <li key={`${proposal.bindingId}-${proposal.kind}`}>
              <span>{proposal.message}</span>
              <div class="connection-health-actions">
                {!removeOnly ? (
                  <button
                    aria-label={`Accept remap for ${proposal.targetPath}`}
                    disabled={props.disabled}
                    onClick={() => props.onApplyProposal?.(proposal, 'accept')}
                    type="button"
                  >
                    Accept remap
                  </button>
                ) : null}
                <button
                  aria-label={`Remove mapping for ${proposal.targetPath}`}
                  disabled={props.disabled}
                  onClick={() => props.onApplyProposal?.(proposal, 'remove')}
                  type="button"
                >
                  Remove mapping
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SemanticTargetRowView(props: {
  disabled: boolean;
  onOptionChange: SemanticMappingViewProps['onOptionChange'];
  onValueMappingChange?: SemanticMappingViewProps['onValueMappingChange'];
  row: SemanticTargetRow;
}): h.JSX.Element {
  const { row } = props;
  const target = row.target;
  const isDesignBindable = target.kind === 'visual';
  const isEvent = target.kind === 'event';
  const showSelect = isDesignBindable || isEvent || target.kind === 'node';
  const suggestionActive = row.suggestion !== undefined
    && row.suggestion.optionId === row.optionId
    && row.optionId !== '';

  return (
    <div class="mapping-row">
      <div class="mapping-property-row">
        <div class="source-prop">
          <strong>{row.targetPath}</strong>
          <small>{target.typeName}</small>
          {target.kind === 'excluded' ? (
            <small>Excluded by policy — styling and DOM props stay in application code.</small>
          ) : target.kind === 'unsupported' ? (
            <small>This type cannot be mapped visually yet.</small>
          ) : null}
        </div>
        {showSelect ? (
          <Fragment>
            <span class="mapping-arrow" aria-hidden="true">›</span>
            <label class="select-label">
              <span class="visually-hidden">Value for {row.targetPath}</span>
              <select
                disabled={props.disabled}
                onInput={(event) => {
                  const optionId = event.currentTarget.value;
                  props.onOptionChange(
                    target.path,
                    optionId,
                    optionId === OPTION_STATIC ? row.staticValue ?? '' : undefined,
                  );
                }}
                value={row.optionId}
              >
                <option value="">Not mapped</option>
                {isDesignBindable && row.options.length > 0 ? (
                  <optgroup label="Figma values">
                    {row.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.detail ? ` (${option.detail})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {isDesignBindable ? (
                  <option value={OPTION_STATIC}>Static value…</option>
                ) : null}
                <option value={OPTION_RUNTIME}>Set in application</option>
                {!target.required ? (
                  <option value={OPTION_OMITTED}>Omitted</option>
                ) : null}
              </select>
            </label>
          </Fragment>
        ) : null}
      </div>

      {row.valueMappings && row.valueMappings.length > 0 ? (
        <div class="value-mapping-list">
          {row.valueMappings.map((valueRow) => (
            <div
              class="value-mapping-row"
              key={`${row.targetPath}-${String(valueRow.sourceValue)}`}
            >
              <code>{String(valueRow.sourceValue)}</code>
              <span aria-hidden="true">←</span>
              <label class="select-label">
                <span class="visually-hidden">
                  Figma option for {row.targetPath} {String(valueRow.sourceValue)}
                </span>
                <select
                  disabled={props.disabled}
                  onInput={(event) => props.onValueMappingChange?.(
                    row.target.path,
                    valueRow.sourceValue,
                    event.currentTarget.value,
                  )}
                  value={valueRow.figmaOption}
                >
                  <option value="">Not mapped</option>
                  {valueRow.options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      ) : null}

      {row.optionId === OPTION_STATIC ? (
        <div class="value-mapping-row">
          <label class="select-label">
            <span class="visually-hidden">Static value for {row.targetPath}</span>
            <input
              disabled={props.disabled}
              onInput={(event) => props.onOptionChange(
                target.path,
                OPTION_STATIC,
                event.currentTarget.value,
              )}
              placeholder="Static value"
              type="text"
              value={typeof row.staticValue === 'string'
                ? row.staticValue
                : String(row.staticValue ?? '')}
            />
          </label>
        </div>
      ) : null}

      {suggestionActive ? (
        <small class="mapping-help">Suggested: {row.suggestion!.reason} Review before saving.</small>
      ) : null}
      {row.optionId === OPTION_RUNTIME ? (
        <small class="mapping-help">Set in application — not a mapping problem.</small>
      ) : null}
    </div>
  );
}

function createPreview(
  componentName: string,
  importPath: string,
  recipe: SemanticConnectionRecipe,
): string | undefined {
  if (!/^[A-Z_$][A-Za-z0-9_$]*$/.test(componentName) || importPath.trim() === '') {
    return undefined;
  }

  try {
    const result = resolveSemanticUsage(componentName, importPath.trim(), recipe, {
      componentProperties: createPreviewProperties(recipe),
      samples: recipe.figmaSnapshot,
    });
    return [renderImportLines(result.usage.imports), '', result.usage.jsx].join('\n');
  } catch (_error) {
    return undefined;
  }
}

function createPreviewProperties(
  recipe: SemanticConnectionRecipe,
): Record<string, string | boolean> {
  const properties: Record<string, string | boolean> = Object.create(null) as Record<
    string,
    string | boolean
  >;

  for (const binding of recipe.bindings) {
    if (binding.source.kind !== 'component-property') {
      continue;
    }
    if (binding.transform?.kind === 'enum') {
      const firstOption = Object.keys(binding.transform.map)[0];
      if (firstOption !== undefined) {
        properties[binding.source.propertyName] = firstOption;
      }
    } else {
      properties[binding.source.propertyName] = 'Sample';
    }
  }

  return properties;
}
