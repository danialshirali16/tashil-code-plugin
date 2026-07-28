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
import type { SourcePropValue } from '../types';
import {
  createSourceContentHash,
  selectSourcePropsInterface,
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
};

export type SourceContract = {
  componentName: string;
  fileName: string;
  contentHash: string;
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

  const parsedFiles = files.map((file) => ({
    ...file,
    sourceFile: ts.createSourceFile(
      file.fileName,
      file.contents,
      ts.ScriptTarget.Latest,
      true,
      file.fileName.toLowerCase().endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  }));

  const candidates = parsedFiles.flatMap((file) => {
    return file.sourceFile.statements
      .filter(ts.isInterfaceDeclaration)
      .filter((declaration) => declaration.name.text.endsWith('Props'))
      .map((declaration) => ({ declaration, file }));
  });
  const expectedInterfaceName = requestedComponentName
    ? `${requestedComponentName}Props`
    : undefined;
  const exactMatch = expectedInterfaceName
    ? candidates.find(({ declaration }) => declaration.name.text === expectedInterfaceName)
    : undefined;
  // Keep this selection aligned with `parseSourceComponent` so the visual and
  // semantic editors always describe the same interface.
  const selected = exactMatch ?? selectSourcePropsInterface(candidates, requestedComponentName);

  if (!selected) {
    return {
      message: 'Could not find an interface whose name ends with Props.',
      ok: false,
    };
  }

  const symbols = buildSymbolTable(parsedFiles);
  const aliases = symbols.aliases;
  const warnings: string[] = [];

  if (expectedInterfaceName && !exactMatch) {
    warnings.push(
      `Used ${selected.declaration.name.text} because no ${expectedInterfaceName} was found.`,
    );
  }
  const targets: SourceTargetDescriptor[] = [];

  const members = collectInterfaceMembers(
    selected.declaration,
    selected.file.sourceFile,
    symbols,
    new Set(),
    warnings,
  );

  for (const { member, sourceFile } of members) {
    const name = getPropertyName(member.name);
    if (!name) {
      warnings.push('Skipped a computed prop name that cannot be mapped safely.');
      continue;
    }

    const required = member.questionToken === undefined;
    const typeName = member.type?.getText(sourceFile) ?? 'unknown';

    if (EXCLUDED_PROPS.has(name)) {
      targets.push({ kind: 'excluded', ownerProp: name, path: [name], required, typeName });
      continue;
    }

    // Object-shaped prop (type literal, interface ref, or Omit/Pick of one):
    // flatten one level into nested targets like `submitProps.variant`.
    const objectMembers = resolveObjectMembers(member.type, symbols, warnings);
    if (objectMembers.length > 0) {
      const leaves = extractObjectLeaves(name, required, objectMembers, symbols, aliases, warnings);
      if (leaves.length > 0) {
        targets.push(...leaves);
        continue;
      }
      targets.push({ kind: 'unsupported', ownerProp: name, path: [name], required, typeName });
      continue;
    }

    const typeNode = dealias(member.type, aliases, new Set());
    const leaf = resolveLeafType(name, typeNode, sourceFile);
    targets.push({
      kind: leaf.kind,
      ownerProp: name,
      path: [name],
      required,
      typeName,
      ...(leaf.values ? { values: leaf.values } : {}),
    });
  }

  const componentName = selected.declaration.name.text.replace(/Props$/, '');

  return {
    contract: {
      componentName,
      contentHash: createSourceContentHash(files),
      fileName: selected.file.fileName,
      targets,
    },
    ok: true,
    warnings,
  };
}

function extractObjectLeaves(
  ownerProp: string,
  ownerRequired: boolean,
  members: readonly ResolvedMember[],
  symbols: SymbolTable,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  warnings: string[],
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
    const path = [ownerProp, name];
    const required = ownerRequired && memberRequired;

    if (EXCLUDED_PROPS.has(name)) {
      leaves.push({ insideOptionalObject: !ownerRequired, kind: 'excluded', ownerProp, path, required, typeName });
      continue;
    }

    // v1 supports one nested level only; deeper objects stay unsupported.
    if (resolveObjectMembers(member.type, symbols, warnings).length > 0) {
      leaves.push({ insideOptionalObject: !ownerRequired, kind: 'unsupported', ownerProp, path, required, typeName });
      continue;
    }

    const leaf = resolveLeafType(name, dealias(member.type, aliases, new Set()), sourceFile);
    leaves.push({
      insideOptionalObject: !ownerRequired,
      kind: leaf.kind,
      ownerProp,
      path,
      required,
      typeName,
      ...(leaf.values ? { values: leaf.values } : {}),
    });
  }

  return leaves;
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

  if (ts.isFunctionTypeNode(node)) {
    return { kind: 'event' };
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
    return { kind: 'unsupported' };
  }

  if (node.kind === ts.SyntaxKind.BooleanKeyword) {
    return { kind: 'visual', values: [false, true] };
  }

  if (node.kind === ts.SyntaxKind.StringKeyword || node.kind === ts.SyntaxKind.NumberKeyword) {
    return { kind: 'visual' };
  }

  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName.getText(sourceFile);

    if (/ReactNode|ReactElement|JSX\.Element/.test(typeName)) {
      return { kind: 'node' };
    }

    if (/Handler$|EventHandler$/.test(typeName)) {
      return { kind: 'event' };
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
