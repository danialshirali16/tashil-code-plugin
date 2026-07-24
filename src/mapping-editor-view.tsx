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
      <div class="mapping-editor-heading-row">
        <div>
          <div class="field-label" id="tashil-mapping-heading">Source &amp; prop mappings</div>
          <div class="mapping-help">Upload TypeScript source, then connect code props to Figma properties.</div>
        </div>
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
      </div>

      {document?.sourceSnapshot ? (
        <Fragment>
          <div class="source-summary">
            <span class="source-icon" aria-hidden="true">{'</>'}</span>
            <span>
              <strong>{document.sourceSnapshot.fileName}</strong>
              <small>
                {document.sourceSnapshot.componentName} · {mappableProps.length} mappable props
                {progress ? ` · ${progress.completed}/${progress.total} mapped` : ''}
              </small>
            </span>
          </div>

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

          <div class="mapping-column-labels" aria-hidden="true">
            <span>Code prop</span>
            <span>Figma property</span>
          </div>
          <div class="mapping-rows">
            {mappableProps.map((sourceProp, index) => {
              const mapping = document.mappings.find(
                (candidate) => candidate.sourceProp === sourceProp.name,
              );
              const figmaProperty = mapping
                ? document.figmaSnapshot.properties.find(
                  (candidate) => candidate.id === mapping.figmaPropertyId,
                )
                : undefined;
              const compatibleProperties = getCompatibleProperties(
                sourceProp,
                document.figmaSnapshot.properties,
              );
              const kind = getPropertyMappingKind(sourceProp);
              const previousKind = index > 0
                ? getPropertyMappingKind(mappableProps[index - 1])
                : undefined;
              const sectionLabel = kind !== previousKind
                ? kind === 'children'
                  ? 'Content'
                  : kind === 'instance-swap'
                    ? 'Slots'
                    : 'Variants & states'
                : undefined;
              const visibilityGuard = getVisibilityGuard(
                sourceProp,
                document.figmaSnapshot.properties,
              );

              return (
                <Fragment key={sourceProp.name}>
                  {sectionLabel ? (
                    <div class="mapping-section-label">{sectionLabel}</div>
                  ) : null}
                  <div class="mapping-row">
                    <div class="mapping-property-row">
                      <div class="source-prop">
                        <strong>{sourceProp.name}</strong>
                        <small>{sourceProp.typeName}</small>
                        {visibilityGuard ? (
                          <small class="slot-guard">Visibility: {visibilityGuard}</small>
                        ) : null}
                      </div>
                      <span class="mapping-arrow" aria-hidden="true">›</span>
                      <label class="select-label">
                        <span class="visually-hidden">Figma property for {sourceProp.name}</span>
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

                    {mapping && figmaProperty && kind === 'property'
                    && getSourceValues(sourceProp).length > 0 ? (
                      <div class="value-mapping-list">
                        {getSourceValues(sourceProp).map((sourceValue) => {
                          const valueMapping = mapping.values.find(
                            (candidate) => candidate.sourceValue === sourceValue,
                          );
                          return (
                            <div class="value-mapping-row" key={`${sourceProp.name}-${String(sourceValue)}`}>
                              <code>{displaySourceValue(sourceValue)}</code>
                              <span aria-hidden="true">→</span>
                              <label class="select-label">
                                <span class="visually-hidden">
                                  Figma value for {sourceProp.name} {displaySourceValue(sourceValue)}
                                </span>
                                <select
                                  disabled={props.disabled}
                                  onInput={(event) => props.onValueChange(
                                    sourceProp.name,
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
                    ) : null}
                  </div>
                </Fragment>
              );
            })}
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
          <details class="advanced-mappings">
            <summary>Generated JSON preview</summary>
            <pre aria-label="Generated prop mappings JSON" class="generated-json-preview">
              {props.propMappings || '{}'}
            </pre>
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
