import * as ts from 'typescript';
import type {
  SourceComponentSnapshot,
  SourcePropDescriptor,
  SourcePropRole,
  SourcePropValue,
} from './types';

export type SourceFileInput = {
  contents: string;
  fileName: string;
};

export type ParseSourceComponentResult =
  | {
      ok: true;
      snapshot: SourceComponentSnapshot;
      warnings: string[];
    }
  | {
      message: string;
      ok: false;
    };

type ResolvedType = {
  isEvent?: boolean;
  isReactNode?: boolean;
  standard: boolean;
  values?: SourcePropValue[];
};

const UNSUPPORTED_STANDARD_PROPS = new Set(['className', 'id', 'key', 'ref', 'style']);

/** Parse local TS/TSX files without executing or persisting their contents. */
export function parseSourceComponent(
  files: readonly SourceFileInput[],
  requestedComponentName?: string,
): ParseSourceComponentResult {
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
  const selected = expectedInterfaceName
    ? candidates.find(({ declaration }) => declaration.name.text === expectedInterfaceName)
    : candidates.length === 1 ? candidates[0] : undefined;

  if (!selected) {
    if (expectedInterfaceName) {
      return {
        message: `Could not find an interface named ${expectedInterfaceName}.`,
        ok: false,
      };
    }

    if (candidates.length > 1) {
      return {
        message: `Multiple prop interfaces were found: ${candidates.map(({ declaration }) => declaration.name.text).join(', ')}. Choose the component explicitly.`,
        ok: false,
      };
    }

    return {
      message: 'Could not find an interface whose name ends with Props.',
      ok: false,
    };
  }

  const aliases = collectTypeAliases(selected.file.sourceFile);
  const warnings: string[] = [];
  const props = selected.declaration.members.flatMap((member): SourcePropDescriptor[] => {
    if (!ts.isPropertySignature(member)) {
      return [];
    }

    const name = getPropertyName(member.name);
    if (!name) {
      warnings.push('Skipped a computed prop name that cannot be mapped safely.');
      return [];
    }

    const typeName = member.type?.getText(selected.file.sourceFile) ?? 'unknown';
    const resolved = resolveType(member.type, aliases, selected.file.sourceFile, new Set());

    return [{
      name,
      required: member.questionToken === undefined,
      role: classifyPropRole(name, resolved),
      typeName,
      ...(resolved.values ? { values: resolved.values } : {}),
    }];
  });

  const componentName = selected.declaration.name.text.replace(/Props$/, '');
  const defaults = collectImplementationDefaults(parsedFiles.map(({ sourceFile }) => sourceFile));
  const propsWithDefaults = props.map((prop) => {
    const defaultValue = defaults.get(prop.name);
    return defaultValue === undefined ? prop : { ...prop, defaultValue };
  });

  return {
    ok: true,
    snapshot: {
      componentName,
      contentHash: createSourceContentHash(files),
      fileName: selected.file.fileName,
      props: propsWithDefaults,
    },
    warnings,
  };
}

export function createSourceContentHash(files: readonly SourceFileInput[]): string {
  const normalized = [...files]
    .sort((first, second) => first.fileName.localeCompare(second.fileName))
    .map(({ contents, fileName }) => `${fileName}\0${contents}`)
    .join('\0');
  let hash = 0x811c9dc5;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function collectTypeAliases(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode>();
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement)) {
      aliases.set(statement.name.text, statement.type);
    }
  }
  return aliases;
}

function resolveType(
  node: ts.TypeNode | undefined,
  aliases: ReadonlyMap<string, ts.TypeNode>,
  sourceFile: ts.SourceFile,
  seenAliases: Set<string>,
): ResolvedType {
  if (!node) {
    return { standard: false };
  }

  if (ts.isUnionTypeNode(node)) {
    const values = node.types.map(readLiteralTypeValue);
    if (values.every((value) => value !== undefined)) {
      return { standard: true, values: values as SourcePropValue[] };
    }
    return { standard: false };
  }

  if (node.kind === ts.SyntaxKind.BooleanKeyword) {
    return { standard: true, values: [false, true] };
  }

  if (node.kind === ts.SyntaxKind.StringKeyword || node.kind === ts.SyntaxKind.NumberKeyword) {
    return { standard: true };
  }

  if (ts.isFunctionTypeNode(node)) {
    return { isEvent: true, standard: false };
  }

  if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName.getText(sourceFile);
    const alias = aliases.get(typeName);
    if (alias && !seenAliases.has(typeName)) {
      const nextSeenAliases = new Set(seenAliases);
      nextSeenAliases.add(typeName);
      return resolveType(alias, aliases, sourceFile, nextSeenAliases);
    }

    if (/ReactNode|ReactElement|JSX\.Element/.test(typeName)) {
      return { isReactNode: true, standard: false };
    }

    if (/Handler$|EventHandler$/.test(typeName)) {
      return { isEvent: true, standard: false };
    }
  }

  return { standard: false };
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

function classifyPropRole(name: string, type: ResolvedType): SourcePropRole {
  if (name === 'children') {
    return 'children';
  }
  if (type.isEvent || /^on[A-Z]/.test(name)) {
    return 'event';
  }
  if (type.isReactNode) {
    return 'advanced';
  }
  if (type.standard && !UNSUPPORTED_STANDARD_PROPS.has(name)) {
    return 'standard';
  }
  return 'unsupported';
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function collectImplementationDefaults(
  sourceFiles: readonly ts.SourceFile[],
): ReadonlyMap<string, SourcePropValue> {
  const defaults = new Map<string, SourcePropValue>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (!element.initializer) {
          continue;
        }
        const name = element.propertyName
          ? getPropertyName(element.propertyName)
          : ts.isIdentifier(element.name) ? element.name.text : undefined;
        const value = readExpressionValue(element.initializer);
        if (name && value !== undefined) {
          defaults.set(name, value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const sourceFile of sourceFiles) {
    visit(sourceFile);
  }

  return defaults;
}

function readExpressionValue(expression: ts.Expression): SourcePropValue | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text);
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}
