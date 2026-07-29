/**
 * Source contract v2: describe a component's public API as *code prop
 * targets*, including nested object leaves such as `confirmAction.label`.
 *
 * Builds on the same local, execution-free TypeScript parsing rules as
 * `src/source-schema.ts` but flattens serializable object props one level deep
 * and keeps callbacks and unsupported types visible instead of discarding
 * them. Source text is never persisted; only the derived contract is.
 *
 * Spec: docs/semantic-connect-roadmap.md §"Source contract v2".
 */

import * as ts from 'typescript';
import {
  collectSourcePropsMembers,
  selectSourcePropsDeclaration,
  type ParsedSourceFile,
} from '../source-props';
import type { SourcePropValue } from '../types';
import {
  createSourceContentHash,
  type SourceFileInput,
} from '../source-schema';
import { SEMANTIC_LIMITS } from './types';

export type SourceTargetKind =
  /** Serializable design value: string, number, boolean, literal union. */
  | 'visual'
  /** Callback or event handler; a visible runtime requirement. */
  | 'event'
  /** React node slot (children or render prop). */
  | 'node'
  /** Array, tuple, set, or other collection supplied by application data. */
  | 'array'
  /** Object/record value that must be assembled by application code. */
  | 'record'
  /** Date-like value supplied by application code. */
  | 'date'
  /** Browser file/blob value supplied by application code. */
  | 'file'
  /** Render function or component type supplied by application code. */
  | 'render'
  /** Framework styling/system value kept out of design-value mapping. */
  | 'styling'
  /** State value paired with a public change/close callback. */
  | 'controlled'
  /** Framework or host value such as a theme, anchor, or MUI slot config. */
  | 'environment'
  /** Excluded by policy (className, style, ref, ...). */
  | 'excluded'
  /** Type the parser cannot model; kept visible with its type text. */
  | 'unsupported';

export type SourceTargetDescriptor = {
  /** Validated path segments, e.g. `['confirmAction', 'label']`. */
  path: string[];
  /** Top-level prop that owns this target (`confirmAction` for the above). */
  ownerProp: string;
  typeName: string;
  kind: SourceTargetKind;
  /** Required along the whole path (an optional parent makes leaves optional). */
  required: boolean;
  /** True when this leaf lives inside an optional parent object. */
  insideOptionalObject?: boolean;
  values?: SourcePropValue[];
  defaultValue?: SourcePropValue;
  /** Bounded item/key/value schemas for application-provided collections. */
  itemSchemas?: SourceCollectionItemSchema[];
  /** Companion callback that updates this controlled value. */
  controlledBy?: string[];
};

export type SourceCollectionItemSchema = {
  kind: SourceTargetKind;
  role: 'item' | 'key' | 'value';
  /** Nested field within an object-valued item, e.g. `component`. */
  path?: string[];
  typeName: string;
  values?: SourcePropValue[];
};

export function isRuntimeSourceTargetKind(kind: SourceTargetKind): boolean {
  return kind === 'event'
    || kind === 'array'
    || kind === 'record'
    || kind === 'date'
    || kind === 'file'
    || kind === 'render'
    || kind === 'styling'
    || kind === 'controlled'
    || kind === 'environment';
}

export type SourceContract = {
  componentName: string;
  fileName: string;
  contentHash: string;
  propsTypeName?: string;
  targets: SourceTargetDescriptor[];
};

export type ExtractSourceContractResult =
  | { ok: true; contract: SourceContract; warnings: string[] }
  | { ok: false; message: string };

const EXCLUDED_PROPS = new Set(['className', 'id', 'key', 'ref', 'style']);

type ResolvedLeaf = {
  kind: SourceTargetKind;
  values?: SourcePropValue[];
};

export function extractSourceContract(
  files: readonly SourceFileInput[],
  requestedComponentName?: string,
): ExtractSourceContractResult {
  if (files.length === 0) {
    return { message: 'Choose at least one .ts or .tsx source file.', ok: false };
  }

  const invalidFile = files.find(({ fileName }) => !/\.tsx?$/i.test(fileName));
  if (invalidFile) {
    return {
      message: `${JSON.stringify(invalidFile.fileName)} is not a .ts or .tsx file.`,
      ok: false,
    };
  }

  const parsedFiles: ParsedSourceFile[] = files.map((file) => ({
    ...file,
    sourceFile: ts.createSourceFile(
      file.fileName,
      file.contents,
      ts.ScriptTarget.Latest,
      true,
      file.fileName.toLowerCase().endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  }));

  const selected = selectSourcePropsDeclaration(parsedFiles, requestedComponentName);

  if (!selected) {
    return {
      message: 'Could not resolve a props interface or type alias for this component.',
      ok: false,
    };
  }

  const symbols = buildSymbolTable(parsedFiles);
  const aliases = symbols.aliases;
  const warnings: string[] = [];
  const expectedPropsName = requestedComponentName
    ? `${requestedComponentName}Props`
    : undefined;
  if (
    expectedPropsName
    && selected.declaration.name.text !== expectedPropsName
  ) {
    warnings.push(
      `Used ${selected.declaration.name.text} because no ${expectedPropsName} was found.`,
    );
  }
  const targets: SourceTargetDescriptor[] = [];

  const members = collectSourcePropsMembers(selected, parsedFiles, warnings);

  for (const {
    member,
    required: checkedRequired,
    sourceFile,
    typeName: checkedTypeName,
    typeNode: checkedTypeNode,
  } of members) {
    const name = getPropertyName(member.name);
    if (!name) {
      warnings.push('Skipped a computed prop name that cannot be mapped safely.');
      continue;
    }

    const required = checkedRequired ?? member.questionToken === undefined;
    const typeName = checkedTypeName ?? member.type?.getText(sourceFile) ?? 'unknown';
    const typeNode = checkedTypeNode ?? member.type;
    const typeSourceFile = checkedTypeNode?.getSourceFile() ?? sourceFile;

    if (EXCLUDED_PROPS.has(name)) {
      targets.push({ kind: 'excluded', ownerProp: name, path: [name], required, typeName });
      continue;
    }

    // Object-shaped prop (type literal, interface ref, or Omit/Pick of one):
    // recursively flatten safe leaves into paths like
    // `submitProps.button.appearance.variant`.
    const objectMembers = resolveObjectMembers(typeNode, symbols, warnings);
    if (objectMembers.length > 0) {
      const leaves = extractObjectLeaves(
        name,
        required,
        objectMembers,
        symbols,
        aliases,
        warnings,
        [name],
        !required,
        createObjectTypeTrail(typeNode, typeSourceFile),
      );
      if (leaves.length > 0) {
        targets.push(...leaves);
        continue;
      }
      targets.push({ kind: 'unsupported', ownerProp: name, path: [name], required, typeName });
      continue;
    }

    const resolvedTypeNode = dealias(typeNode, aliases, new Set());
    const leaf = resolveLeafType(name, resolvedTypeNode, typeSourceFile);
    const itemSchemas = leaf.kind === 'array'
      ? resolveCollectionItemSchemas(
          resolvedTypeNode,
          typeSourceFile,
          symbols,
          aliases,
          warnings,
        )
      : [];
    targets.push({
      kind: leaf.kind,
      ownerProp: name,
      path: [name],
      required,
      typeName,
      ...(leaf.values ? { values: leaf.values } : {}),
      ...(itemSchemas.length > 0 ? { itemSchemas } : {}),
    });
  }

  const classifiedTargets = classifyControlledTargets(
    classifyFrameworkTargets(targets),
  );
  const componentName = selected.reason === 'name-affinity'
    ? selected.declaration.name.text
      .replace(/Props(?:Type)?$/i, '')
      .replace(/^I(?=[A-Z])/, '')
    : requestedComponentName
      ?? selected.declaration.name.text
        .replace(/Props(?:Type)?$/i, '')
        .replace(/^I(?=[A-Z])/, '');

  return {
    contract: {
      componentName,
      contentHash: createSourceContentHash(files),
      fileName: selected.file.fileName,
      propsTypeName: selected.declaration.name.text,
      targets: classifiedTargets,
    },
    ok: true,
    warnings,
  };
}

function classifyFrameworkTargets(
  targets: readonly SourceTargetDescriptor[],
): SourceTargetDescriptor[] {
  return targets.map((target) => {
    if (target.kind !== 'unsupported') {
      return target;
    }

    const leafName = target.path[target.path.length - 1] ?? target.ownerProp;
    if (/Component$/.test(leafName)) {
      return { ...target, kind: 'render' };
    }
    if (
      /^(?:theme|typography|anchorEl|container|portalContainer|transitionDuration|PaperProps|TransitionProps)$/
        .test(leafName)
      || target.path[0] === 'componentsProps'
      || target.path[0] === 'slotProps'
    ) {
      return { ...target, kind: 'environment' };
    }
    return target;
  });
}

function classifyControlledTargets(
  targets: readonly SourceTargetDescriptor[],
): SourceTargetDescriptor[] {
  const callbacks = targets.filter(
    (target) => target.kind === 'event' && target.path.length === 1,
  );
  const candidates = targets.filter(
    (target) => target.path.length === 1 && isControlledValueName(target.ownerProp),
  );
  const controlledBy = new Map<string, SourceTargetDescriptor>();

  for (const callback of callbacks) {
    const matches = candidates
      .filter((candidate) => controlsValue(callback.ownerProp, candidate.ownerProp))
      .sort((left, right) => (
        controlledValuePriority(left.ownerProp) - controlledValuePriority(right.ownerProp)
      ));
    const controlled = matches[0];
    if (controlled !== undefined && !controlledBy.has(controlled.ownerProp)) {
      controlledBy.set(controlled.ownerProp, callback);
    }
  }

  return targets.map((target) => {
    if (target.path.length !== 1 || !isControlledValueName(target.ownerProp)) {
      return target;
    }

    const callback = controlledBy.get(target.ownerProp);
    return callback === undefined
      ? target
      : {
          ...target,
          controlledBy: [...callback.path],
          kind: 'controlled',
        };
  });
}

function controlledValuePriority(name: string): number {
  return [
    'value',
    'checked',
    'selectedValue',
    'selected',
    'selection',
    'inputValue',
    'expanded',
    'activeStep',
    'open',
    'isOpen',
  ].indexOf(name);
}

function isControlledValueName(name: string): boolean {
  return /^(?:value|inputValue|checked|selected|selectedValue|selection|open|isOpen|expanded|activeStep)$/
    .test(name);
}

function controlsValue(callbackName: string, valueName: string): boolean {
  if (callbackName === 'onChange') {
    return valueName !== 'open' && valueName !== 'isOpen';
  }
  if (valueName === 'open' || valueName === 'isOpen') {
    return callbackName === 'onOpenChange' || callbackName === 'onClose';
  }
  const stem = valueName.startsWith('is') && valueName.length > 2
    ? valueName.slice(2)
    : valueName;
  return callbackName === `on${stem[0]?.toUpperCase() ?? ''}${stem.slice(1)}Change`;
}

function extractObjectLeaves(
  ownerProp: string,
  ownerRequired: boolean,
  members: readonly ResolvedMember[],
  symbols: SymbolTable,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  warnings: string[],
  parentPath: readonly string[] = [ownerProp],
  insideOptionalObject = !ownerRequired,
  objectTypeTrail: ReadonlySet<string> = new Set(),
): SourceTargetDescriptor[] {
  const leaves: SourceTargetDescriptor[] = [];

  for (const { member, sourceFile } of members) {
    const name = getPropertyName(member.name);
    if (!name) {
      warnings.push(
        `Skipped a computed member of ${JSON.stringify(ownerProp)} that cannot be mapped safely.`,
      );
      continue;
    }

    if (leaves.length >= SEMANTIC_LIMITS.maxNestedSources) {
      break;
    }

    const memberRequired = member.questionToken === undefined;
    const typeName = member.type?.getText(sourceFile) ?? 'unknown';
    const path = [...parentPath, name];
    const required = ownerRequired && memberRequired;

    if (EXCLUDED_PROPS.has(name)) {
      leaves.push({
        insideOptionalObject,
        kind: 'excluded',
        ownerProp,
        path,
        required,
        typeName,
      });
      continue;
    }

    const nestedMembers = resolveObjectMembers(member.type, symbols, warnings);
    const nestedTypeIdentity = getObjectTypeIdentity(member.type, sourceFile);
    const repeatsObjectType = nestedTypeIdentity !== undefined
      && objectTypeTrail.has(nestedTypeIdentity);
    if (
      nestedMembers.length > 0
      && path.length < SEMANTIC_LIMITS.maxTargetPathDepth
      && !repeatsObjectType
    ) {
      const nextTypeTrail = new Set(objectTypeTrail);
      if (nestedTypeIdentity !== undefined) {
        nextTypeTrail.add(nestedTypeIdentity);
      }
      const nestedLeaves = extractObjectLeaves(
        ownerProp,
        required,
        nestedMembers,
        symbols,
        aliases,
        warnings,
        path,
        insideOptionalObject || !memberRequired,
        nextTypeTrail,
      );
      leaves.push(...nestedLeaves);
      continue;
    }

    // At the bounded depth, preserve the remaining object as one explicit
    // runtime record instead of silently dropping its public API.
    if (nestedMembers.length > 0) {
      leaves.push({
        insideOptionalObject,
        kind: 'record',
        ownerProp,
        path,
        required,
        typeName,
      });
      continue;
    }

    const resolvedMemberType = dealias(member.type, aliases, new Set());
    const leaf = resolveLeafType(name, resolvedMemberType, sourceFile);
    const itemSchemas = leaf.kind === 'array'
      ? resolveCollectionItemSchemas(
          resolvedMemberType,
          sourceFile,
          symbols,
          aliases,
          warnings,
        )
      : [];
    leaves.push({
      insideOptionalObject,
      kind: leaf.kind,
      ownerProp,
      path,
      required,
      typeName,
      ...(leaf.values ? { values: leaf.values } : {}),
      ...(itemSchemas.length > 0 ? { itemSchemas } : {}),
    });
  }

  return leaves;
}

function createObjectTypeTrail(
  node: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const identity = getObjectTypeIdentity(node, sourceFile);
  return identity === undefined ? new Set() : new Set([identity]);
}

function getObjectTypeIdentity(
  node: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (!node) {
    return undefined;
  }
  if (ts.isTypeReferenceNode(node)) {
    return node.typeName.getText(sourceFile);
  }
  return undefined;
}

function resolveCollectionItemSchemas(
  node: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  symbols: SymbolTable,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  warnings: string[],
): SourceCollectionItemSchema[] {
  if (!node) {
    return [];
  }

  if (ts.isArrayTypeNode(node)) {
    return createCollectionItemSchemas(
      'item',
      node.elementType,
      sourceFile,
      symbols,
      aliases,
      warnings,
    );
  }

  if (ts.isTupleTypeNode(node)) {
    return node.elements.slice(0, 16).flatMap((element) => createCollectionItemSchemas(
      'item',
      unwrapTupleElement(element),
      sourceFile,
      symbols,
      aliases,
      warnings,
    )).slice(0, 16);
  }

  if (!ts.isTypeReferenceNode(node)) {
    return [];
  }

  const typeName = node.typeName.getText(sourceFile);
  const typeArguments = node.typeArguments ?? [];
  if (/^(?:Array|ReadonlyArray|Set|ReadonlySet)$/.test(typeName)) {
    const itemType = typeArguments[0];
    return itemType === undefined
      ? []
      : createCollectionItemSchemas(
          'item',
          itemType,
          sourceFile,
          symbols,
          aliases,
          warnings,
        );
  }

  if (/^(?:Map|ReadonlyMap)$/.test(typeName) && typeArguments.length >= 2) {
    return [
      ...createCollectionItemSchemas(
        'key',
        typeArguments[0],
        sourceFile,
        symbols,
        aliases,
        warnings,
      ),
      ...createCollectionItemSchemas(
        'value',
        typeArguments[1],
        sourceFile,
        symbols,
        aliases,
        warnings,
      ),
    ];
  }

  return [];
}

function createCollectionItemSchemas(
  role: SourceCollectionItemSchema['role'],
  node: ts.TypeNode,
  sourceFile: ts.SourceFile,
  symbols: SymbolTable,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  warnings: string[],
): SourceCollectionItemSchema[] {
  const resolvedNode = dealias(node, aliases, new Set());
  const objectMembers = resolveObjectMembers(resolvedNode, symbols, warnings);
  if (objectMembers.length > 0) {
    const leaves = extractObjectLeaves(
      'item',
      true,
      objectMembers,
      symbols,
      aliases,
      warnings,
      ['item'],
      false,
      createObjectTypeTrail(resolvedNode, sourceFile),
    );
    if (leaves.some((leaf) => leaf.kind === 'node')) {
      return leaves.slice(0, 16).map((leaf) => ({
        kind: leaf.kind,
        path: leaf.path.slice(1),
        role,
        typeName: leaf.typeName,
        ...(leaf.values ? { values: leaf.values } : {}),
      }));
    }
    return [{ kind: 'record', role, typeName: node.getText(sourceFile) }];
  }
  const leaf = resolveLeafType('item', resolvedNode, sourceFile);
  return [{
    kind: leaf.kind,
    role,
    typeName: node.getText(sourceFile),
    ...(leaf.values ? { values: leaf.values } : {}),
  }];
}

function unwrapTupleElement(node: ts.TypeNode): ts.TypeNode {
  if (ts.isNamedTupleMember(node)) {
    return node.type;
  }
  if (ts.isOptionalTypeNode(node) || ts.isRestTypeNode(node)) {
    return node.type;
  }
  return node;
}

/**
 * Resolve a type node that denotes an object shape (type literal, interface
 * reference, or `Omit`/`Pick` of one) to its property members. Returns an
 * empty list for non-object types, so callers treat a non-empty result as
 * "this prop is an assemblable object".
 */
function resolveObjectMembers(
  node: ts.TypeNode | undefined,
  symbols: SymbolTable,
  warnings: string[],
): ResolvedMember[] {
  return node === undefined ? [] : resolveTypeToMembers(node, symbols, new Set(), warnings);
}

function resolveLeafType(
  name: string,
  node: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
): ResolvedLeaf {
  if (!node) {
    return { kind: 'unsupported' };
  }

  if (/^(?:sx|classes|slotProps|componentsProps)$/.test(name)) {
    return { kind: 'styling' };
  }

  if (ts.isFunctionTypeNode(node)) {
    return /^(?:render[A-Z].*|.*Renderer|.*Component)$/.test(name)
      ? { kind: 'render' }
      : { kind: 'event' };
  }

  if (/^on[A-Z]/.test(name)) {
    return { kind: 'event' };
  }

  if (name === 'children') {
    return { kind: 'node' };
  }

  if (ts.isUnionTypeNode(node)) {
    const meaningful = node.types.filter(
      (member) => member.kind !== ts.SyntaxKind.UndefinedKeyword
        && !(ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword),
    );
    const values = meaningful.map(readLiteralTypeValue);
    if (meaningful.length > 0 && values.every((value) => value !== undefined)) {
      return { kind: 'visual', values: values as SourcePropValue[] };
    }
    // A union that accepts a bare `string` (e.g. `string | ReactNode`) is
    // free text: bindable to a Figma text source, with runtime/omitted still
    // offered as alternatives by the authoring layer.
    if (meaningful.some((member) => member.kind === ts.SyntaxKind.StringKeyword)) {
      return { kind: 'visual' };
    }
    const resolvedKinds = meaningful.map(
      (member) => resolveLeafType(name, member, sourceFile).kind,
    );
    const firstKind = resolvedKinds[0];
    if (
      firstKind !== undefined
      && firstKind !== 'unsupported'
      && resolvedKinds.every((kind) => kind === firstKind)
    ) {
      return { kind: firstKind };
    }
    return { kind: 'unsupported' };
  }

  if (node.kind === ts.SyntaxKind.BooleanKeyword) {
    return { kind: 'visual', values: [false, true] };
  }

  if (node.kind === ts.SyntaxKind.StringKeyword || node.kind === ts.SyntaxKind.NumberKeyword) {
    return { kind: 'visual' };
  }

  if (ts.isArrayTypeNode(node) || ts.isTupleTypeNode(node)) {
    return { kind: 'array' };
  }

  if (node.kind === ts.SyntaxKind.ObjectKeyword || ts.isTypeLiteralNode(node)) {
    return { kind: 'record' };
  }

  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName.getText(sourceFile);

    if (typeName === 'Node' || /ReactNode|ReactElement|JSX\.Element/.test(typeName)) {
      return { kind: 'node' };
    }

    if (/Handler$|EventHandler$/.test(typeName)) {
      return { kind: 'event' };
    }

    if (/^(?:Array|ReadonlyArray|Set|ReadonlySet|Map|ReadonlyMap)$/.test(typeName)) {
      return { kind: 'array' };
    }

    if (/^(?:Record|Object|WeakMap|WeakSet)$/.test(typeName)) {
      return { kind: 'record' };
    }

    if (/^(?:Date|Dayjs|Moment)$/.test(typeName) || /Date$/.test(typeName)) {
      return { kind: 'date' };
    }

    if (/^(?:File|FileList|Blob|FormData|DataTransfer)$/.test(typeName)) {
      return { kind: 'file' };
    }

    if (
      /(?:ComponentType|ElementType|FunctionComponent|React\.FC|Renderer)$/.test(typeName)
    ) {
      return { kind: 'render' };
    }

    if (
      /(?:SxProps|SystemStyleObject|CSSProperties|ClassNameMap|Classes)$/.test(typeName)
    ) {
      return { kind: 'styling' };
    }
  }

  return { kind: 'unsupported' };
}

function dealias(
  node: ts.TypeNode | undefined,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  seen: Set<string>,
): ts.TypeNode | undefined {
  if (node && ts.isTypeReferenceNode(node) && node.typeArguments === undefined) {
    const name = ts.isIdentifier(node.typeName) ? node.typeName.text : undefined;
    const alias = name === undefined ? undefined : aliases.get(name);
    if (name && alias && !seen.has(name)) {
      seen.add(name);
      return dealias(alias, aliases, seen);
    }
  }
  return node;
}

type ParsedFile = { sourceFile: ts.SourceFile };

type InterfaceEntry = { declaration: ts.InterfaceDeclaration; sourceFile: ts.SourceFile };

type ResolvedMember = { member: ts.PropertySignature; sourceFile: ts.SourceFile };

/**
 * Symbol tables spanning every uploaded file. Interface and type-alias names
 * are resolved across files so `extends`/`Omit`/`Pick` heritage and imported
 * aliases (e.g. `ButtonVariantType` from a sibling `button/types.ts`) resolve
 * when the user uploads the relevant files. Names declared in the selected
 * component's own file win on conflict.
 */
type SymbolTable = {
  interfaces: ReadonlyMap<string, InterfaceEntry>;
  aliases: ReadonlyMap<string, ts.TypeNode>;
};

function buildSymbolTable(files: readonly ParsedFile[]): SymbolTable {
  const interfaces = new Map<string, InterfaceEntry>();
  const aliases = new Map<string, ts.TypeNode>();

  for (const { sourceFile } of files) {
    for (const statement of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(statement) && !interfaces.has(statement.name.text)) {
        interfaces.set(statement.name.text, { declaration: statement, sourceFile });
      }
      if (ts.isTypeAliasDeclaration(statement) && !aliases.has(statement.name.text)) {
        aliases.set(statement.name.text, statement.type);
      }
    }
  }

  return { aliases, interfaces };
}

/**
 * Collect an interface's property members including those inherited through
 * `extends` clauses, supporting bare base interfaces plus `Omit<Base, keys>`
 * and `Pick<Base, keys>`. Own members win over inherited ones with the same
 * name and keep their declaration order; inherited members are appended.
 * Unresolvable bases (external libraries such as `ComponentPropsWithoutRef`)
 * are skipped with a warning rather than failing the scan.
 */
function collectInterfaceMembers(
  declaration: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
  symbols: SymbolTable,
  seen: Set<string>,
  warnings: string[],
): ResolvedMember[] {
  if (seen.has(declaration.name.text)) {
    return [];
  }
  seen.add(declaration.name.text);

  const collected: ResolvedMember[] = [];
  const names = new Set<string>();

  const add = (members: readonly ResolvedMember[]): void => {
    for (const entry of members) {
      const name = getPropertyName(entry.member.name);
      if (name === undefined || names.has(name)) {
        continue;
      }
      names.add(name);
      collected.push(entry);
    }
  };

  add(
    declaration.members
      .filter(ts.isPropertySignature)
      .map((member) => ({ member, sourceFile })),
  );

  for (const heritage of declaration.heritageClauses ?? []) {
    for (const type of heritage.types) {
      add(resolveHeritageMembers(type, symbols, seen, warnings));
    }
  }

  return collected;
}

function resolveHeritageMembers(
  type: ts.ExpressionWithTypeArguments,
  symbols: SymbolTable,
  seen: Set<string>,
  warnings: string[],
): ResolvedMember[] {
  const baseName = ts.isIdentifier(type.expression) ? type.expression.text : undefined;
  const args = type.typeArguments ?? [];

  if ((baseName === 'Omit' || baseName === 'Pick') && args.length >= 2) {
    const baseMembers = resolveTypeToMembers(args[0], symbols, seen, warnings);
    const keys = new Set(extractKeyLiterals(args[1]));
    return baseMembers.filter((entry) => {
      const name = getPropertyName(entry.member.name);
      if (name === undefined) {
        return false;
      }
      return baseName === 'Omit' ? !keys.has(name) : keys.has(name);
    });
  }

  if (baseName !== undefined && symbols.interfaces.has(baseName)) {
    const entry = symbols.interfaces.get(baseName)!;
    return collectInterfaceMembers(entry.declaration, entry.sourceFile, symbols, seen, warnings);
  }

  if (baseName !== undefined) {
    warnings.push(
      `Could not resolve base type ${JSON.stringify(baseName)}; its props were not included. Upload its source file to map them.`,
    );
  }

  return [];
}

/** Resolve a type node that should denote an object shape to its members. */
function resolveTypeToMembers(
  node: ts.TypeNode,
  symbols: SymbolTable,
  seen: Set<string>,
  warnings: string[],
): ResolvedMember[] {
  if (ts.isTypeLiteralNode(node)) {
    const sourceFile = node.getSourceFile();
    return node.members
      .filter(ts.isPropertySignature)
      .map((member) => ({ member, sourceFile }));
  }

  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;

    if ((name === 'Omit' || name === 'Pick') && node.typeArguments) {
      return resolveHeritageMembers(
        ts.factory.createExpressionWithTypeArguments(node.typeName, node.typeArguments),
        symbols,
        seen,
        warnings,
      );
    }

    const interfaceEntry = symbols.interfaces.get(name);
    if (interfaceEntry) {
      return collectInterfaceMembers(
        interfaceEntry.declaration,
        interfaceEntry.sourceFile,
        symbols,
        seen,
        warnings,
      );
    }

    const alias = symbols.aliases.get(name);
    if (alias) {
      return resolveTypeToMembers(alias, symbols, seen, warnings);
    }
  }

  return [];
}

/** Read the string-literal keys from an `Omit`/`Pick` key argument. */
function extractKeyLiterals(node: ts.TypeNode): string[] {
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    return [node.literal.text];
  }
  if (ts.isUnionTypeNode(node)) {
    return node.types.flatMap(extractKeyLiterals);
  }
  return [];
}

function readLiteralTypeValue(node: ts.TypeNode): SourcePropValue | undefined {
  if (!ts.isLiteralTypeNode(node)) {
    return undefined;
  }

  const literal = node.literal;
  if (ts.isStringLiteral(literal) || ts.isNumericLiteral(literal)) {
    return ts.isStringLiteral(literal) ? literal.text : Number(literal.text);
  }

  if (literal.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (literal.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  return undefined;
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}
