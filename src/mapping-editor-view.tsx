import { Button, TextboxMultiline } from '@create-figma-plugin/ui';
import { Fragment, h } from 'preact';
import { useState } from 'preact/hooks';
import type { ConnectionHealth, ConnectionHealthStatus } from './connection-health';
import { isMappingDocument } from './mapping-document';
import { getPropertyMappingKind } from './mapping-editor';
import type {
  FigmaPropertyDescriptor,
  MappingDocument,
  SourcePropDescriptor,
  SourcePropValue,
} from './types';

export type MappingEditorViewProps = {
  connectionHealth?: ConnectionHealth;
  customPropMappings: string;
  customPropMappingsError?: string;
  disabled: boolean;
  mappingDocument: string;
  mappingDocumentError?: string;
  onCustomJsonInput: (value: string) => void;
  onFilesSelected: (files: readonly File[]) => void;
  onLegacyJsonInput: (value: string) => void;
  onScaffold: () => void;
  onPropertyChange: (sourcePropName: string, figmaPropertyId: string) => void;
  onReconcileFigma: () => void;
  onRemoveStaleMapping: (sourcePropName: string) => void;
  onValueChange: (
    sourcePropName: string,
    sourceValue: SourcePropValue,
    figmaValue: string,
  ) => void;
  propMappings: string;
  propMappingsError?: string;
  scaffoldPending: boolean;
  sourceUploading: boolean;
};

function parseDocument(value: string): MappingDocument | undefined {
  if (value.trim() === '') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isMappingDocument(parsed) ? parsed : undefined;
  } catch (_error) {
    return undefined;
  }
}

function getSourceValues(prop: SourcePropDescriptor): SourcePropValue[] {
  if (prop.values && prop.values.length > 0) {
    return prop.values;
  }
  return prop.typeName === 'boolean' ? [false, true] : [];
}

function getCompatibleProperties(
  sourceProp: SourcePropDescriptor,
  properties: readonly FigmaPropertyDescriptor[],
): FigmaPropertyDescriptor[] {
  const kind = getPropertyMappingKind(sourceProp);
  if (kind === 'children') {
    return properties.filter((property) => property.type === 'TEXT');
  }
  if (kind === 'instance-swap') {
    return properties.filter((property) => property.type === 'INSTANCE_SWAP');
  }

  const values = getSourceValues(sourceProp);
  const isBoolean = values.length === 2 && values.every((value) => typeof value === 'boolean');

  return properties.filter((property) => (
    property.type === 'VARIANT' || (isBoolean && property.type === 'BOOLEAN')
  ));
}

function displaySourceValue(value: SourcePropValue): string {
  return typeof value === 'string' ? value : String(value);
}

function getVisibilityGuard(
  sourceProp: SourcePropDescriptor,
  properties: readonly FigmaPropertyDescriptor[],
): string | undefined {
  const expectedName = sourceProp.name === 'renderRightIcon'
    ? 'hasleadingicon'
    : sourceProp.name === 'renderLeftIcon'
      ? 'hastrailingicon'
      : undefined;
  if (!expectedName) {
    return undefined;
  }

  return properties.find((property) => (
    property.type === 'BOOLEAN'
    && property.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === expectedName
  ))?.name;
}

const HEALTH_LABELS: Record<ConnectionHealthStatus, string> = {
  broken: 'Broken',
  healthy: 'Healthy',
  'needs-review': 'Needs review',
  'source-refresh-required': 'Source refresh required',
};

function getMappingProgress(document: MappingDocument): { completed: number; total: number } {
  let completed = 0;
  let total = 0;

  for (const sourceProp of document.sourceSnapshot?.props ?? []) {
    const kind = getPropertyMappingKind(sourceProp);
    if (!kind) {
      continue;
    }
    const mapping = document.mappings.find((candidate) => candidate.sourceProp === sourceProp.name);
    const values = kind === 'property' ? getSourceValues(sourceProp) : [];
    if (values.length === 0) {
      total += 1;
      completed += mapping ? 1 : 0;
    } else {
      total += values.length;
      const mappedValues = new Set(mapping?.values.map((value) => value.sourceValue) ?? []);
      completed += values.filter((value) => mappedValues.has(value)).length;
    }
  }

  return { completed, total };
}

export function MappingEditorView(props: MappingEditorViewProps): h.JSX.Element {
  const [isDragging, setIsDragging] = useState(false);
  const [activePropName, setActivePropName] = useState<string>();
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const document = parseDocument(props.mappingDocument);
  const sourceProps = document?.sourceSnapshot?.props ?? [];
  const contentProps = sourceProps.filter((prop) => getPropertyMappingKind(prop) === 'children');
  const slotProps = sourceProps.filter((prop) => getPropertyMappingKind(prop) === 'instance-swap');
  const standardProps = sourceProps.filter((prop) => getPropertyMappingKind(prop) === 'property');
  const mappableProps = [...contentProps, ...slotProps, ...standardProps];
  const progress = document ? getMappingProgress(document) : undefined;
  const hasFigmaChanges = props.connectionHealth?.changes.some(
    (change) => change.kind.startsWith('figma-'),
  ) ?? false;
  const staleSourceProps = document && props.connectionHealth
    ? Array.from(new Set(props.connectionHealth.changes.flatMap((change) => {
        if (change.severity !== 'error') {
          return [];
        }
        if (change.sourceProp) {
          return [change.sourceProp];
        }
        if (change.figmaPropertyId) {
          return document.mappings
            .filter((mapping) => mapping.figmaPropertyId === change.figmaPropertyId)
            .map((mapping) => mapping.sourceProp);
        }
        return [];
      })))
    : [];
  const uploadDisabled = props.disabled || props.sourceUploading;
  const focusedProp = mappableProps.find((sourceProp) => sourceProp.name === activePropName)
    ?? mappableProps.find((sourceProp) => !document?.mappings.some(
      (mapping) => mapping.sourceProp === sourceProp.name,
    ))
    ?? mappableProps[0];
  const visibleProps = filter === 'review'
    ? mappableProps.filter((sourceProp) => !document?.mappings.some(
      (mapping) => mapping.sourceProp === sourceProp.name,
    ))
    : mappableProps;

  function submitFiles(files: readonly File[]): void {
    if (!uploadDisabled && files.length > 0) {
      props.onFilesSelected(files);
    }
  }

  return (
    <section
      aria-labelledby="tashil-mapping-heading"
      class={isDragging ? 'mapping-editor mapping-editor-dragging' : 'mapping-editor'}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!uploadDisabled) setIsDragging(true);
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
      <header class="mapping-workbench-header">
        <div class="mapping-workbench-title">
          <div class="field-label" id="tashil-mapping-heading">Source &amp; prop mappings</div>
          <div class="mapping-help">Upload TypeScript source, then connect code props to Figma properties.</div>
        </div>
        {document?.sourceSnapshot ? (
          <div class="mapping-workbench-source">
            <span class="source-icon" aria-hidden="true">{'</>'}</span>
            <span>
              <strong>{document.sourceSnapshot.componentName}</strong>
              <small class="source-file">{document.sourceSnapshot.fileName}</small>
            </span>
          </div>
        ) : null}
        {progress ? (
          <div class="mapping-workbench-progress" aria-label={`${progress.completed} of ${progress.total} values mapped`}>
            <strong>{progress.completed}/{progress.total}</strong>
            <span>mapped</span>
            <span class="mapping-progress-track" aria-hidden="true">
              <span style={{
                width: progress.total === 0
                  ? '100%'
                  : `${Math.round((progress.completed / progress.total) * 100)}%`,
              }} />
            </span>
          </div>
        ) : null}
        <label class={uploadDisabled ? 'file-button file-button-disabled' : 'file-button'}>
          {props.sourceUploading ? 'Analyzing…' : document ? 'Replace source' : 'Upload source'}
          <input
            accept=".ts,.tsx"
            disabled={uploadDisabled}
            multiple
            onInput={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              submitFiles(files);
              event.currentTarget.value = '';
            }}
            type="file"
          />
        </label>
      </header>

      {document?.sourceSnapshot ? (
        <Fragment>
          {props.connectionHealth ? (
            <div class={`connection-health connection-health-${props.connectionHealth.status}`}>
              <div class="connection-health-heading">
                <strong>{HEALTH_LABELS[props.connectionHealth.status]}</strong>
                {hasFigmaChanges ? (
                  <button onClick={props.onReconcileFigma} type="button">Review Figma changes</button>
                ) : null}
              </div>
              {props.connectionHealth.status === 'source-refresh-required' ? (
                <small>Re-upload the source files to check whether the code props changed.</small>
              ) : null}
              {props.connectionHealth.changes.length > 0 ? (
                <ul>
                  {props.connectionHealth.changes.slice(0, 6).map((change, index) => (
                    <li key={`${change.kind}-${change.sourceProp ?? change.figmaPropertyId ?? index}`}>
                      {change.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {props.connectionHealth.changes.length > 6 ? (
                <small>And {props.connectionHealth.changes.length - 6} more changes.</small>
              ) : null}
              {staleSourceProps.length > 0 ? (
                <div class="connection-health-actions">
                  {staleSourceProps.map((sourceProp) => (
                    <button
                      key={sourceProp}
                      onClick={() => props.onRemoveStaleMapping(sourceProp)}
                      type="button"
                    >
                      Remove stale {sourceProp} mapping
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div class="mapping-workbench">
            <aside class="mapping-workbench-list" aria-label="Code props">
              <div class="mapping-workbench-list-header">
                <div>
                  <strong>Code props</strong>
                  <span>{mappableProps.length} mappable props</span>
                </div>
                <div class="mapping-filter" role="group" aria-label="Filter code props">
                  <button
                    aria-pressed={filter === 'all'}
                    onClick={() => setFilter('all')}
                    type="button"
                  >
                    All
                  </button>
                  <button
                    aria-pressed={filter === 'review'}
                    onClick={() => setFilter('review')}
                    type="button"
                  >
                    Review
                  </button>
                </div>
              </div>
              <div class="prop-list">
                {visibleProps.map((sourceProp, index) => {
                  const mapping = document.mappings.find(
                    (candidate) => candidate.sourceProp === sourceProp.name,
                  );
                  const compatibleProperties = getCompatibleProperties(
                    sourceProp,
                    document.figmaSnapshot.properties,
                  );
                  const visibilityGuard = getVisibilityGuard(
                    sourceProp,
                    document.figmaSnapshot.properties,
                  );
                  const kind = getPropertyMappingKind(sourceProp);
                  const previousKind = index > 0
                    ? getPropertyMappingKind(visibleProps[index - 1])
                    : undefined;
                  const sectionLabel = kind !== previousKind
                    ? kind === 'children'
                      ? 'Content'
                      : kind === 'instance-swap'
                        ? 'Slots'
                        : 'Variants & states'
                    : undefined;
                  return (
                    <Fragment key={sourceProp.name}>
                      {sectionLabel ? (
                        <div class="mapping-section-label">{sectionLabel}</div>
                      ) : null}
                      <div class="prop-row">
                        <button
                          aria-expanded={sourceProp.name === focusedProp?.name}
                          class="prop-head"
                          onClick={() => setActivePropName(sourceProp.name)}
                          type="button"
                        >
                          <span class="dot-status" data-state={mapping ? 'done' : 'todo'} />
                          <span class="prop-name">
                            <b>{sourceProp.name}</b>
                            <code class="prop-type">{sourceProp.typeName}</code>
                            {visibilityGuard ? (
                              <small class="slot-guard">Visibility: {visibilityGuard}</small>
                            ) : null}
                          </span>
                          <span class="prop-current">
                            {mapping
                              ? document.figmaSnapshot.properties.find(
                                (property) => property.id === mapping.figmaPropertyId,
                              )?.name ?? 'mapped'
                              : 'not mapped'}
                          </span>
                          <span class="prop-caret" aria-hidden="true">›</span>
                        </button>
                        <label class="visually-hidden">
                          Figma property for {sourceProp.name}
                          <select
                            disabled={props.disabled}
                            onInput={(event) => props.onPropertyChange(
                              sourceProp.name,
                              event.currentTarget.value,
                            )}
                            value={mapping?.figmaPropertyId ?? ''}
                          >
                            <option value="">Not mapped</option>
                            {compatibleProperties.map((property) => (
                              <option key={property.id} value={property.id}>{property.name}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </Fragment>
                  );
                })}
                {visibleProps.length === 0 ? (
                  <div class="mapping-list-empty">Everything is mapped.</div>
                ) : null}
              </div>
            </aside>

            <main class="mapping-workbench-inspector">
              {focusedProp ? (() => {
                const mapping = document.mappings.find(
                  (candidate) => candidate.sourceProp === focusedProp.name,
                );
                const figmaProperty = mapping
                  ? document.figmaSnapshot.properties.find(
                    (candidate) => candidate.id === mapping.figmaPropertyId,
                  )
                  : undefined;
                const compatibleProperties = getCompatibleProperties(
                  focusedProp,
                  document.figmaSnapshot.properties,
                );
                const kind = getPropertyMappingKind(focusedProp);
                const visibilityGuard = getVisibilityGuard(
                  focusedProp,
                  document.figmaSnapshot.properties,
                );

                return (
                  <section class="prop-inspector">
                    <div class="prop-inspector-heading">
                      <div>
                        <span class="mapping-inspector-label">Focused code prop</span>
                        <h3>{focusedProp.name}</h3>
                      </div>
                      <code class="prop-type">{focusedProp.typeName}</code>
                    </div>
                    {visibilityGuard ? (
                      <div class="mapping-help">Visibility guard: {visibilityGuard}</div>
                    ) : null}
                    <div class="mapping-mode-group" role="radiogroup" aria-label={`Source mode for ${focusedProp.name}`}>
                      <button
                        aria-checked={Boolean(mapping)}
                        disabled={props.disabled || compatibleProperties.length === 0}
                        onClick={() => props.onPropertyChange(
                          focusedProp.name,
                          mapping?.figmaPropertyId ?? compatibleProperties[0]?.id ?? '',
                        )}
                        role="radio"
                        type="button"
                      >
                        Figma
                      </button>
                      <button
                        aria-checked={!mapping}
                        disabled={props.disabled}
                        onClick={() => props.onPropertyChange(focusedProp.name, '')}
                        role="radio"
                        type="button"
                      >
                        Omit
                      </button>
                    </div>
                    <div class="mapping-inspector-section">
                      <div class="mapping-inspector-label">Figma candidates</div>
                      <div class="choice-list" role="radiogroup" aria-label={`Figma candidates for ${focusedProp.name}`}>
                        {compatibleProperties.length === 0 ? (
                          <p class="choice-none">No compatible Figma property was found.</p>
                        ) : compatibleProperties.map((property) => (
                          <button
                            aria-checked={mapping?.figmaPropertyId === property.id}
                            class="choice"
                            data-on={mapping?.figmaPropertyId === property.id ? 'true' : undefined}
                            disabled={props.disabled}
                            key={property.id}
                            onClick={() => props.onPropertyChange(focusedProp.name, property.id)}
                            role="radio"
                            type="button"
                          >
                            <span class="choice-dot" aria-hidden="true" />
                            <span class="choice-label">{property.name}</span>
                            <span class="choice-detail">{property.type.toLowerCase()}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {mapping && figmaProperty && kind === 'property'
                    && getSourceValues(focusedProp).length > 0 ? (
                      <div class="mapping-inspector-section">
                        <div class="mapping-inspector-label">Value alignment</div>
                        <div class="value-mapping-list">
                          {getSourceValues(focusedProp).map((sourceValue) => {
                            const valueMapping = mapping.values.find(
                              (candidate) => candidate.sourceValue === sourceValue,
                            );
                            return (
                              <div class="value-mapping-row" key={`${focusedProp.name}-${String(sourceValue)}`}>
                                <code>{displaySourceValue(sourceValue)}</code>
                                <span aria-hidden="true">→</span>
                                <label class="select-label">
                                  <span class="visually-hidden">
                                    Figma value for {focusedProp.name} {displaySourceValue(sourceValue)}
                                  </span>
                                  <select
                                    disabled={props.disabled}
                                    onInput={(event) => props.onValueChange(
                                      focusedProp.name,
                                      sourceValue,
                                      event.currentTarget.value,
                                    )}
                                    value={valueMapping?.figmaValue ?? ''}
                                  >
                                    <option value="">Not mapped</option>
                                    {figmaProperty.options.map((option) => (
                                      <option key={option} value={option}>{option}</option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    <section class="mapping-preview">
                      <div class="mapping-inspector-label">Live mapping preview</div>
                      <pre aria-label="Generated prop mappings JSON" class="generated-json-preview">
                        {props.propMappings || '{}'}
                      </pre>
                    </section>
                  </section>
                );
              })() : (
                <div class="mapping-list-empty">No mappable code props were found.</div>
              )}
            </main>
          </div>
        </Fragment>
      ) : (
        <div class="source-empty">
          <strong>Choose the component source files</strong>
          <span>Drop .ts/.tsx files here, or select the props/types and implementation files together.</span>
          <Button disabled={props.disabled} onClick={props.onScaffold} secondary>
            {props.scaffoldPending ? 'Generating…' : 'Generate from component'}
          </Button>
        </div>
      )}

      {props.mappingDocumentError ? (
        <div class="field-error" id="tashil-mapping-document-error">
          {props.mappingDocumentError}
        </div>
      ) : null}

      {document ? (
        <Fragment>
          <details class="advanced-mappings">
            <summary>Custom wildcard &amp; raw mappings</summary>
            <div class="mapping-help">
              Only add mappings that the visual rows cannot represent.
            </div>
            <label class="visually-hidden" htmlFor="tashil-custom-prop-mappings">
              Custom prop mappings JSON
            </label>
            <TextboxMultiline
              aria-invalid={Boolean(props.customPropMappingsError)}
              disabled={props.disabled}
              grow
              id="tashil-custom-prop-mappings"
              onValueInput={props.onCustomJsonInput}
              rows={7}
              spellCheck={false}
              value={props.customPropMappings}
              placeholder="{}"
            />
            {props.customPropMappingsError ? (
              <div class="field-error" id="tashil-custom-prop-mappings-error">
                {props.customPropMappingsError}
              </div>
            ) : null}
          </details>
        </Fragment>
      ) : (
        <details class="advanced-mappings" open={props.propMappings.trim() !== ''}>
          <summary>Legacy prop mappings JSON</summary>
          <label class="visually-hidden" htmlFor="tashil-prop-mappings">Prop mappings JSON</label>
          <TextboxMultiline
            aria-invalid={Boolean(props.propMappingsError)}
            disabled={props.disabled}
            grow
            id="tashil-prop-mappings"
            onValueInput={props.onLegacyJsonInput}
            rows={7}
            spellCheck={false}
            value={props.propMappings}
            placeholder="{}"
          />
          {props.propMappingsError ? (
            <div class="field-error" id="tashil-prop-mappings-error">
              {props.propMappingsError}
            </div>
          ) : null}
        </details>
      )}
    </section>
  );
}
