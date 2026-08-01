import * as ts from 'typescript';
import type { SourceFileInput } from './source-schema';
import { resolveSourcePropsWithTypeChecker } from './source-type-program';

export type ParsedSourceFile = SourceFileInput & {
  sourceFile: ts.SourceFile;
};

export type SourcePropsDeclaration =
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration;

export type SourcePropsSelection = {
  componentName?: string;
  declaration: SourcePropsDeclaration;
  file: ParsedSourceFile;
  reason: 'component-declaration' | 'exact-name' | 'name-affinity' | 'fallback';
};

export type ResolvedSourceMember = {
  member: ts.PropertySignature;
  required?: boolean;
  sourceFile: ts.SourceFile;
  typeName?: string;
  typeNode?: ts.TypeNode;
};

type SourcePropsCandidate = {
  declaration: SourcePropsDeclaration;
  file: ParsedSourceFile;
};

type InferredPropsReference = {
  componentName?: string;
  file: ParsedSourceFile;
  typeName: string;
};

type ComponentDeclaration =
  | ts.FunctionDeclaration
  | ts.VariableDeclaration;

type ResolvedComponentDeclaration = {
  declaration: ComponentDeclaration;
  file: ParsedSourceFile;
};

type SourceSymbolTable = {
  aliases: ReadonlyMap<string, SourcePropsCandidate>;
  interfaces: ReadonlyMap<string, SourcePropsCandidate>;
};

export function selectSourcePropsDeclaration(
  files: readonly ParsedSourceFile[],
  requestedComponentName?: string,
): SourcePropsSelection | undefined {
  const candidates = collectPropsCandidates(files);
  const expectedName = requestedComponentName
    ? `${requestedComponentName}Props`
    : undefined;

  if (requestedComponentName) {
    const inferred = inferComponentPropsReference(files, requestedComponentName);
    if (inferred) {
      const inferredCandidate = candidates.find(({ declaration, file }) => (
        declaration.name.text === inferred.typeName
        && file.sourceFile === inferred.file.sourceFile
      )) ?? candidates.find(
        ({ declaration }) => declaration.name.text === inferred.typeName,
      );
      if (inferredCandidate) {
        return { ...inferredCandidate, reason: 'component-declaration' };
      }
    }
  }

  const exact = expectedName === undefined
    ? undefined
    : candidates.find(({ declaration }) => declaration.name.text === expectedName);
  if (exact) {
    return { ...exact, reason: 'exact-name' };
  }

  const affinity = selectByNameAffinity(candidates, requestedComponentName);
  if (affinity) {
    return { ...affinity, reason: 'name-affinity' };
  }

  const inferred = inferUniqueComponentPropsReference(files, candidates);
  if (inferred) {
    const inferredCandidate = candidates.find(({ declaration, file }) => (
      declaration.name.text === inferred.typeName
      && file.sourceFile === inferred.file.sourceFile
    )) ?? candidates.find(
      ({ declaration }) => declaration.name.text === inferred.typeName,
    );
    if (inferredCandidate) {
      return {
        ...inferredCandidate,
        componentName: inferred.componentName,
        reason: 'component-declaration',
      };
    }
  }

  const fallback = selectStrongestCandidate(candidates);
  return fallback ? { ...fallback, reason: 'fallback' } : undefined;
}

export function collectSourcePropsMembers(
  selection: SourcePropsSelection,
  files: readonly ParsedSourceFile[],
  warnings: string[],
): { members: ResolvedSourceMember[]; chain: string[] } {
  const symbols = buildSourceSymbolTable(files);
  const fallbackWarnings: string[] = [];
  const fallbackChain: string[] = [];
  const fallbackMembers = collectDeclarationMembers(
    selection.declaration,
    selection.file.sourceFile,
    symbols,
    new Set(),
    fallbackWarnings,
    fallbackChain,
  );
  const checked = resolveSourcePropsWithTypeChecker(
    files,
    selection.file.fileName,
    selection.declaration.name.text,
  );
  const retainedFallbackWarnings = checked.members.length > fallbackMembers.length
    ? fallbackWarnings.filter((warning) => !warning.startsWith('Could not resolve base type '))
    : fallbackWarnings;
  warnings.push(...retainedFallbackWarnings, ...checked.warnings);
  if (checked.members.length > 0) {
    return {
      members: checked.members,
      chain: [...new Set([...checked.baseTypeNames, ...fallbackChain])],
    };
  }
  return { members: fallbackMembers, chain: fallbackChain };
}

function collectPropsCandidates(
  files: readonly ParsedSourceFile[],
): SourcePropsCandidate[] {
  return files
    .filter((file) => !isDependencyDeclarationFile(file.fileName))
    .flatMap((file) => file.sourceFile.statements.flatMap(
    (statement): SourcePropsCandidate[] => {
      if (
        (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
        && /props/i.test(statement.name.text)
      ) {
        return [{ declaration: statement, file }];
      }
      return [];
    },
    ));
}

function isDependencyDeclarationFile(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, '/');
  return normalized.startsWith('node_modules/')
    || normalized.includes('/node_modules/');
}

function inferComponentPropsReference(
  files: readonly ParsedSourceFile[],
  requestedComponentName: string,
): InferredPropsReference | undefined {
  const componentFiles = files.filter(
    (file) => !isDependencyDeclarationFile(file.fileName),
  );
  const resolved = resolveExportedComponent(
    componentFiles,
    requestedComponentName,
    new Set(),
  ) ?? findComponentDeclaration(componentFiles, requestedComponentName);
  if (!resolved) {
    return undefined;
  }

  const typeName = ts.isFunctionDeclaration(resolved.declaration)
    ? readParameterPropsType(resolved.declaration.parameters[0])
    : readVariablePropsType(resolved.declaration);
  return typeName ? { file: resolved.file, typeName } : undefined;
}

function inferUniqueComponentPropsReference(
  files: readonly ParsedSourceFile[],
  candidates: readonly SourcePropsCandidate[],
): InferredPropsReference | undefined {
  const candidateNames = new Set(
    candidates.map(({ declaration }) => declaration.name.text),
  );
  const references: Array<InferredPropsReference & { exported: boolean }> = [];

  for (const file of files) {
    if (isDependencyDeclarationFile(file.fileName)) {
      continue;
    }
    for (const statement of file.sourceFile.statements) {
      const declarations: ComponentDeclaration[] = ts.isFunctionDeclaration(statement)
        ? statement.name ? [statement] : []
        : ts.isVariableStatement(statement)
          ? [...statement.declarationList.declarations]
          : [];
      for (const declaration of declarations) {
        const componentName = ts.isFunctionDeclaration(declaration)
          ? declaration.name?.text
          : ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
        const typeName = ts.isFunctionDeclaration(declaration)
          ? readParameterPropsType(declaration.parameters[0])
          : readVariablePropsType(declaration);
        if (componentName && typeName && candidateNames.has(typeName)) {
          references.push({
            componentName,
            exported: isDeclarationExported(declaration),
            file,
            typeName,
          });
        }
      }
    }
  }

  const exported = references.filter((reference) => reference.exported);
  const eligible = exported.length > 0 ? exported : references;
  const typeNames = new Set(eligible.map(({ typeName }) => typeName));
  if (typeNames.size !== 1) {
    return undefined;
  }
  const selected = eligible[0];
  return selected
    ? {
        componentName: selected.componentName,
        file: selected.file,
        typeName: selected.typeName,
      }
    : undefined;
}

function resolveExportedComponent(
  files: readonly ParsedSourceFile[],
  exportName: string,
  seen: Set<string>,
): ResolvedComponentDeclaration | undefined {
  for (const file of files) {
    const resolved = resolveExportFromFile(files, file, exportName, seen);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function resolveExportFromFile(
  files: readonly ParsedSourceFile[],
  file: ParsedSourceFile,
  exportName: string,
  seen: Set<string>,
): ResolvedComponentDeclaration | undefined {
  const key = `${file.fileName}:${exportName}`;
  if (seen.has(key)) {
    return undefined;
  }
  const nextSeen = new Set(seen);
  nextSeen.add(key);

  const local = findComponentDeclarationInFile(file, exportName);
  if (local && isDeclarationExported(local.declaration)) {
    return local;
  }

  for (const statement of file.sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) {
      continue;
    }

    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const specifier = statement.exportClause.elements.find(
        (element) => element.name.text === exportName,
      );
      if (!specifier) {
        continue;
      }
      const importedName = specifier.propertyName?.text ?? specifier.name.text;
      if (!statement.moduleSpecifier) {
        return importedName === 'default'
          ? resolveDefaultExportFromFile(files, file, nextSeen)
          : findComponentDeclarationInFile(file, importedName);
      }
      const targetFile = resolveModuleFile(files, file, statement.moduleSpecifier);
      if (!targetFile) {
        continue;
      }
      return importedName === 'default'
        ? resolveDefaultExportFromFile(files, targetFile, nextSeen)
        : resolveExportFromFile(files, targetFile, importedName, nextSeen);
    }

    if (!statement.exportClause && statement.moduleSpecifier) {
      const targetFile = resolveModuleFile(files, file, statement.moduleSpecifier);
      if (targetFile) {
        const resolved = resolveExportFromFile(
          files,
          targetFile,
          exportName,
          nextSeen,
        );
        if (resolved) {
          return resolved;
        }
      }
    }
  }

  return exportName === 'default'
    ? resolveDefaultExportFromFile(files, file, nextSeen)
    : undefined;
}

function resolveDefaultExportFromFile(
  files: readonly ParsedSourceFile[],
  file: ParsedSourceFile,
  seen: Set<string>,
): ResolvedComponentDeclaration | undefined {
  for (const statement of file.sourceFile.statements) {
    if (
      ts.isExportAssignment(statement)
      && !statement.isExportEquals
      && ts.isIdentifier(statement.expression)
    ) {
      return findComponentDeclarationInFile(file, statement.expression.text);
    }
    if (
      ts.isFunctionDeclaration(statement)
      && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      return { declaration: statement, file };
    }
    if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
    ) {
      const defaultSpecifier = statement.exportClause.elements.find(
        (element) => element.name.text === 'default',
      );
      if (!defaultSpecifier) {
        continue;
      }
      const importedName = defaultSpecifier.propertyName?.text ?? 'default';
      if (!statement.moduleSpecifier) {
        return findComponentDeclarationInFile(file, importedName);
      }
      const targetFile = resolveModuleFile(files, file, statement.moduleSpecifier);
      if (!targetFile) {
        continue;
      }
      if (importedName === 'default') {
        const targetKey = `${targetFile.fileName}:default`;
        if (seen.has(targetKey)) {
          return undefined;
        }
        const nextSeen = new Set(seen);
        nextSeen.add(targetKey);
        return resolveDefaultExportFromFile(files, targetFile, nextSeen);
      }
      return resolveExportFromFile(files, targetFile, importedName, seen);
    }
  }
  return undefined;
}

function findComponentDeclaration(
  files: readonly ParsedSourceFile[],
  componentName: string,
): ResolvedComponentDeclaration | undefined {
  for (const file of files) {
    const declaration = findComponentDeclarationInFile(file, componentName);
    if (declaration) {
      return declaration;
    }
  }
  return undefined;
}

function findComponentDeclarationInFile(
  file: ParsedSourceFile,
  componentName: string,
): ResolvedComponentDeclaration | undefined {
  for (const statement of file.sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      && statement.name?.text === componentName
    ) {
      return { declaration: statement, file };
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        ({ name }) => ts.isIdentifier(name) && name.text === componentName,
      );
      if (declaration) {
        return { declaration, file };
      }
    }
  }
  return undefined;
}

function isDeclarationExported(declaration: ComponentDeclaration): boolean {
  const statement = ts.isVariableDeclaration(declaration)
    ? declaration.parent.parent
    : declaration;
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function resolveModuleFile(
  files: readonly ParsedSourceFile[],
  fromFile: ParsedSourceFile,
  moduleSpecifier: ts.Expression,
): ParsedSourceFile | undefined {
  if (!ts.isStringLiteral(moduleSpecifier) || !moduleSpecifier.text.startsWith('.')) {
    return undefined;
  }
  const fromDirectory = getDirectoryName(fromFile.fileName);
  const basePath = normalizeSourcePath(`${fromDirectory}/${moduleSpecifier.text}`);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
  ];
  return files.find(({ fileName }) => (
    candidates.includes(normalizeSourcePath(fileName))
  ));
}

function getDirectoryName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex < 0 ? '.' : normalized.slice(0, separatorIndex);
}

function normalizeSourcePath(fileName: string): string {
  const segments: string[] = [];
  for (const segment of fileName.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

function readVariablePropsType(
  declaration: ts.VariableDeclaration,
): string | undefined {
  const annotationType = readComponentAnnotationType(declaration.type);
  if (annotationType) {
    return annotationType;
  }

  const initializer = declaration.initializer;
  if (initializer === undefined) {
    return undefined;
  }
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
    return readParameterPropsType(initializer.parameters[0]);
  }
  if (ts.isCallExpression(initializer)) {
    const callName = getLastName(initializer.expression);
    if (callName === 'forwardRef') {
      const typeArgument = initializer.typeArguments?.[1];
      const typeName = getTypeReferenceName(typeArgument);
      if (typeName) {
        return typeName;
      }
    }
    const callback = initializer.arguments.find(
      (argument): argument is ts.ArrowFunction | ts.FunctionExpression => (
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
      ),
    );
    return callback ? readParameterPropsType(callback.parameters[0]) : undefined;
  }
  return undefined;
}

function readComponentAnnotationType(
  node: ts.TypeNode | undefined,
): string | undefined {
  if (!node || !ts.isTypeReferenceNode(node)) {
    return undefined;
  }
  const annotationName = getLastName(node.typeName);
  if (
    annotationName !== 'FC'
    && annotationName !== 'FunctionComponent'
    && annotationName !== 'ComponentType'
  ) {
    return undefined;
  }
  return getTypeReferenceName(node.typeArguments?.[0]);
}

function readParameterPropsType(
  parameter: ts.ParameterDeclaration | undefined,
): string | undefined {
  return getTypeReferenceName(parameter?.type);
}

function getTypeReferenceName(node: ts.TypeNode | undefined): string | undefined {
  if (!node || !ts.isTypeReferenceNode(node)) {
    return undefined;
  }
  return getLastName(node.typeName);
}

function getLastName(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (ts.isQualifiedName(node)) {
    return node.right.text;
  }
  return undefined;
}

function selectByNameAffinity(
  candidates: readonly SourcePropsCandidate[],
  requestedComponentName?: string,
): SourcePropsCandidate | undefined {
  if (!requestedComponentName) {
    return [...candidates]
      .map((candidate, index) => ({
        candidate,
        index,
        score: getDeclarationWeight(candidate.declaration),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0]
      ?.candidate;
  }

  const requested = normalizePropsName(requestedComponentName);
  const ranked = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: getNameAffinity(
        normalizePropsName(candidate.declaration.name.text),
        requested,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return ranked[0]?.candidate;
}

function selectStrongestCandidate(
  candidates: readonly SourcePropsCandidate[],
): SourcePropsCandidate | undefined {
  return [...candidates]
    .map((candidate, index) => ({
      candidate,
      index,
      score: getDeclarationWeight(candidate.declaration),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]
    ?.candidate;
}

function getDeclarationWeight(declaration: SourcePropsDeclaration): number {
  const isExported = declaration.modifiers?.some(
    ({ kind }) => kind === ts.SyntaxKind.ExportKeyword,
  ) ?? false;
  const memberCount = ts.isInterfaceDeclaration(declaration)
    ? declaration.members.length
    : ts.isTypeLiteralNode(declaration.type) ? declaration.type.members.length : 0;
  return (isExported ? 100 : 0) + memberCount;
}

function normalizePropsName(name: string): string {
  return name
    .trim()
    .replace(/^I(?=[A-Z])/, '')
    .replace(/Props(?:Type)?$/i, '')
    .toLowerCase();
}

function getNameAffinity(candidate: string, requested: string): number {
  if (!candidate) {
    return 0;
  }
  if (candidate === requested) {
    return 10_000;
  }
  if (candidate.endsWith(requested)) {
    return 9_000 - (candidate.length - requested.length);
  }
  if (candidate.startsWith(requested)) {
    return 8_000 - (candidate.length - requested.length);
  }
  if (candidate.includes(requested)) {
    return 7_000 - (candidate.length - requested.length);
  }
  if (requested.includes(candidate)) {
    return 6_000 - (requested.length - candidate.length);
  }
  return 0;
}

function buildSourceSymbolTable(
  files: readonly ParsedSourceFile[],
): SourceSymbolTable {
  const aliases = new Map<string, SourcePropsCandidate>();
  const interfaces = new Map<string, SourcePropsCandidate>();

  for (const file of files) {
    for (const statement of file.sourceFile.statements) {
      if (ts.isInterfaceDeclaration(statement) && !interfaces.has(statement.name.text)) {
        interfaces.set(statement.name.text, { declaration: statement, file });
      }
      if (ts.isTypeAliasDeclaration(statement) && !aliases.has(statement.name.text)) {
        aliases.set(statement.name.text, { declaration: statement, file });
      }
    }
  }
  return { aliases, interfaces };
}

function collectDeclarationMembers(
  declaration: SourcePropsDeclaration,
  sourceFile: ts.SourceFile,
  symbols: SourceSymbolTable,
  seen: Set<string>,
  warnings: string[],
  chain: string[] = [],
): ResolvedSourceMember[] {
  if (seen.has(declaration.name.text)) {
    return [];
  }
  seen.add(declaration.name.text);

  if (ts.isTypeAliasDeclaration(declaration)) {
    return resolveTypeMembers(declaration.type, symbols, seen, warnings, chain);
  }

  const ownMembers = declaration.members
    .filter(ts.isPropertySignature)
    .map((member) => ({ member, sourceFile }));
  const inheritedMembers = (declaration.heritageClauses ?? []).flatMap(
    ({ types }) => types.flatMap((type) => (
      resolveHeritageMembers(type, symbols, new Set(seen), warnings, chain)
    )),
  );
  return mergeMembers(ownMembers, inheritedMembers);
}

function resolveTypeMembers(
  node: ts.TypeNode,
  symbols: SourceSymbolTable,
  seen: Set<string>,
  warnings: string[],
  chain: string[] = [],
): ResolvedSourceMember[] {
  if (ts.isParenthesizedTypeNode(node)) {
    return resolveTypeMembers(node.type, symbols, seen, warnings, chain);
  }
  if (ts.isTypeLiteralNode(node)) {
    return node.members
      .filter(ts.isPropertySignature)
      .map((member) => ({ member, sourceFile: node.getSourceFile() }));
  }
  if (ts.isIntersectionTypeNode(node)) {
    return node.types.reduce<ResolvedSourceMember[]>(
      (members, type) => mergeMembers(
        members,
        resolveTypeMembers(type, symbols, new Set(seen), warnings, chain),
      ),
      [],
    );
  }
  if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) {
    return [];
  }

  const name = node.typeName.text;
  if ((name === 'Omit' || name === 'Pick') && node.typeArguments?.length) {
    const members = resolveTypeMembers(
      node.typeArguments[0],
      symbols,
      new Set(seen),
      warnings,
      chain,
    );
    const keys = new Set(extractKeyLiterals(node.typeArguments[1]));
    return members.filter(({ member }) => {
      const memberName = getPropertyName(member.name);
      return memberName !== undefined
        && (name === 'Omit' ? !keys.has(memberName) : keys.has(memberName));
    });
  }

  const candidate = symbols.interfaces.get(name) ?? symbols.aliases.get(name);
  if (candidate) {
    if (!chain.includes(name)) {
      chain.push(name);
    }
    return collectDeclarationMembers(
      candidate.declaration,
      candidate.file.sourceFile,
      symbols,
      seen,
      warnings,
      chain,
    );
  }
  return [];
}

function resolveHeritageMembers(
  node: ts.ExpressionWithTypeArguments,
  symbols: SourceSymbolTable,
  seen: Set<string>,
  warnings: string[],
  chain: string[] = [],
): ResolvedSourceMember[] {
  const name = getLastName(node.expression);
  if ((name === 'Omit' || name === 'Pick') && node.typeArguments?.length) {
    return resolveTypeMembers(
      ts.factory.createTypeReferenceNode(name, node.typeArguments),
      symbols,
      seen,
      warnings,
      chain,
    );
  }
  if (name) {
    const candidate = symbols.interfaces.get(name) ?? symbols.aliases.get(name);
    if (candidate) {
      if (!chain.includes(name)) {
        chain.push(name);
      }
      return collectDeclarationMembers(
        candidate.declaration,
        candidate.file.sourceFile,
        symbols,
        seen,
        warnings,
        chain,
      );
    }
    warnings.push(
      `Could not resolve base type ${JSON.stringify(name)}; its props were not included. Upload its source file to map them.`,
    );
  }
  return [];
}

function mergeMembers(
  first: readonly ResolvedSourceMember[],
  second: readonly ResolvedSourceMember[],
): ResolvedSourceMember[] {
  const merged = [...first];
  const names = new Set(first.map(({ member }) => getPropertyName(member.name)));
  for (const entry of second) {
    const name = getPropertyName(entry.member.name);
    if (name !== undefined && !names.has(name)) {
      names.add(name);
      merged.push(entry);
    }
  }
  return merged;
}

function extractKeyLiterals(node: ts.TypeNode | undefined): string[] {
  if (!node) {
    return [];
  }
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    return [node.literal.text];
  }
  return ts.isUnionTypeNode(node) ? node.types.flatMap(extractKeyLiterals) : [];
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}
