import * as ts from 'typescript';
import type { SourceFileInput } from './source-schema';

export type CheckerResolvedMember = {
  member: ts.PropertySignature;
  required: boolean;
  sourceFile: ts.SourceFile;
  typeName: string;
  typeNode: ts.TypeNode;
};

export type CheckerPropsResolution = {
  members: CheckerResolvedMember[];
  warnings: string[];
  /**
   * Best-effort base-type names for the inheritance-chain display (roadmap M7).
   * Only populated from locally resolvable interface heritage; empty for type
   * aliases, intersections, or any base whose declaration is not in the upload.
   * Empty is the safe fallback — never a wrong chain.
   */
  baseTypeNames: string[];
};

type ProgramBundle = {
  program: ts.Program;
  virtualPathByInputName: ReadonlyMap<string, string>;
};

const PROGRAM_CACHE_LIMIT = 8;
const programCache = new Map<string, ProgramBundle>();
const GLOBAL_TYPES_PATH = '/__tashil_source_globals.d.ts';
const GLOBAL_TYPES = `
interface Object {}
interface Function {}
interface String {}
interface Boolean {}
interface Number {}
interface RegExp {}
interface Array<T> {
  readonly length: number;
  [index: number]: T;
}
interface ReadonlyArray<T> {
  readonly length: number;
  [index: number]: T;
}
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type NonNullable<T> = T extends null | undefined ? never : T;
type Parameters<T extends (...args: any) => any> =
  T extends (...args: infer P) => any ? P : never;
type ReturnType<T extends (...args: any) => any> =
  T extends (...args: any) => infer R ? R : any;
`;

export function resolveSourcePropsWithTypeChecker(
  files: readonly SourceFileInput[],
  selectedFileName: string,
  propsTypeName: string,
): CheckerPropsResolution {
  const bundle = getProgramBundle(files);
  const virtualPath = bundle.virtualPathByInputName.get(selectedFileName);
  const sourceFile = virtualPath
    ? bundle.program.getSourceFile(virtualPath)
    : undefined;
  if (!sourceFile) {
    return { members: [], warnings: [], baseTypeNames: [] };
  }

  const declaration = sourceFile.statements.find((statement) => (
    (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
    && statement.name.text === propsTypeName
  ));
  if (
    !declaration
    || (!ts.isInterfaceDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration))
  ) {
    return { members: [], warnings: [], baseTypeNames: [] };
  }

  const checker = bundle.program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol) {
    return { members: [], warnings: [], baseTypeNames: [] };
  }

  const propsType = checker.getDeclaredTypeOfSymbol(symbol);
  const members = checker.getPropertiesOfType(propsType).flatMap(
    (property): CheckerResolvedMember[] => {
      const member = property.declarations?.find(ts.isPropertySignature);
      if (!member) {
        return [];
      }
      const propertyType = checker.getTypeOfSymbolAtLocation(property, member);
      const typeName = checker.typeToString(
        propertyType,
        member,
        ts.TypeFormatFlags.NoTruncation,
      );
      const declaredTypeName = member.type?.getText(member.getSourceFile());
      const preserveDeclaredType = declaredTypeName !== undefined && (
        (typeName === 'any' && declaredTypeName !== 'any')
        || normalizeTypeText(typeName) === normalizeTypeText(declaredTypeName)
      );
      const resolvedTypeName = preserveDeclaredType ? declaredTypeName : typeName;
      const resolvedTypeNode = preserveDeclaredType
        ? member.type
        : parseTypeNode(resolvedTypeName);
      if (!resolvedTypeNode) {
        return [];
      }
      return [{
        member,
        required: (property.flags & ts.SymbolFlags.Optional) === 0,
        sourceFile: member.getSourceFile(),
        typeName: resolvedTypeName,
        typeNode: resolvedTypeNode,
      }];
    },
  );

  return {
    members,
    warnings: collectRelevantMissingDependencyWarnings(
      bundle.program,
      sourceFile,
      declaration,
    ),
    baseTypeNames: collectLocalBaseTypeNames(checker, propsType),
  };
}

/**
 * Best-effort inheritance chain for the M7 "resolved props source" display.
 * Walks `getBaseTypes`, but keeps only bases whose declaration is in a bundled
 * source file (local). External bases (React DOM attrs, MUI) would need their
 * `@types` uploaded to name reliably, so they are omitted rather than guessed.
 * Caps depth to keep deeply-recursive framework hierarchies bounded.
 */
function collectLocalBaseTypeNames(checker: ts.TypeChecker, propsType: ts.Type): string[] {
  // getBaseTypes requires an InterfaceType. Require the resolved symbol to be a
  // declared interface; bail on aliases, unions, or anonymous object types.
  // ponytail: intentionally returns [] for non-interface props types rather than
  // chasing alias targets — keeps the chain local and never wrong.
  const symbol = propsType.getSymbol();
  if (!symbol || (symbol.flags & ts.SymbolFlags.Interface) === 0) {
    return [];
  }
  const baseTypes = checker.getBaseTypes(propsType as ts.InterfaceType);
  if (baseTypes.length === 0) {
    return [];
  }
  const names: string[] = [];
  for (const base of baseTypes) {
    if (names.length >= 8) {
      break;
    }
    const symbol = base.getSymbol();
    // Only keep named, locally-declared interfaces — skip intrinsic/object/any.
    if (!symbol || !(symbol.flags & ts.SymbolFlags.Interface)) {
      continue;
    }
    const declaration = symbol.declarations?.[0];
    if (!declaration) {
      continue;
    }
    const fileName = declaration.getSourceFile().fileName;
    // ponytail: keep only bundled uploads; GLOBAL_TYPES_PATH holds the
    // synthetic intrinsics. Anything else (lib.d.ts, @types) is out of scope.
    if (fileName === GLOBAL_TYPES_PATH || fileName.startsWith('/lib.') || fileName.includes('/node_modules/')) {
      continue;
    }
    const name = checker.typeToString(
      base,
      declaration,
      ts.TypeFormatFlags.NoTruncation,
    );
    if (name && name !== 'object' && name !== '{}' && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function getProgramBundle(files: readonly SourceFileInput[]): ProgramBundle {
  const cacheKey = createProgramCacheKey(files);
  const cached = programCache.get(cacheKey);
  if (cached) {
    programCache.delete(cacheKey);
    programCache.set(cacheKey, cached);
    return cached;
  }

  const bundle = createProgramBundle(files);
  programCache.set(cacheKey, bundle);
  if (programCache.size > PROGRAM_CACHE_LIMIT) {
    const oldestKey = programCache.keys().next().value;
    if (oldestKey !== undefined) {
      programCache.delete(oldestKey);
    }
  }
  return bundle;
}

function createProgramBundle(files: readonly SourceFileInput[]): ProgramBundle {
  const fileContents = new Map<string, string>([[GLOBAL_TYPES_PATH, GLOBAL_TYPES]]);
  const virtualPathByInputName = new Map<string, string>();
  for (const file of files) {
    const virtualPath = toVirtualPath(file.fileName);
    virtualPathByInputName.set(file.fileName, virtualPath);
    fileContents.set(virtualPath, file.contents);
  }

  const options: ts.CompilerOptions = {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    noLib: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ES2020,
  };
  const host: ts.CompilerHost = {
    fileExists: (fileName) => fileContents.has(normalizeVirtualPath(fileName)),
    getCanonicalFileName: (fileName) => normalizeVirtualPath(fileName),
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => GLOBAL_TYPES_PATH,
    getNewLine: () => '\n',
    getSourceFile: (fileName, languageVersion) => {
      const normalized = normalizeVirtualPath(fileName);
      const contents = fileContents.get(normalized);
      if (contents === undefined) {
        return undefined;
      }
      return ts.createSourceFile(
        normalized,
        contents,
        languageVersion,
        true,
        normalized.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    },
    readFile: (fileName) => fileContents.get(normalizeVirtualPath(fileName)),
    resolveModuleNames: (moduleNames, containingFile) => moduleNames.map(
      (moduleName) => resolveVirtualModule(
        moduleName,
        containingFile,
        fileContents,
      ),
    ),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => undefined,
  };

  return {
    program: ts.createProgram({
      host,
      options,
      rootNames: [...fileContents.keys()],
    }),
    virtualPathByInputName,
  };
}

function resolveVirtualModule(
  moduleName: string,
  containingFile: string,
  fileContents: ReadonlyMap<string, string>,
): ts.ResolvedModule | undefined {
  const basePaths = moduleName.startsWith('.')
    ? [normalizeVirtualPath(`${getDirectoryName(containingFile)}/${moduleName}`)]
    : findPackageBasePaths(moduleName, fileContents);
  const candidates = basePaths.flatMap((basePath) => [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.d.ts`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.d.ts`,
  ]);
  const resolvedFileName = candidates.find((candidate) => fileContents.has(candidate));
  if (!resolvedFileName) {
    return undefined;
  }
  return {
    isExternalLibraryImport: !moduleName.startsWith('.'),
    resolvedFileName,
  };
}

function findPackageBasePaths(
  moduleName: string,
  fileContents: ReadonlyMap<string, string>,
): string[] {
  const packagePaths = new Set<string>([
    normalizeVirtualPath(`/node_modules/${moduleName}`),
  ]);
  const atTypesName = toAtTypesPackageName(moduleName);
  if (atTypesName) {
    packagePaths.add(normalizeVirtualPath(`/node_modules/@types/${atTypesName}`));
  }

  for (const fileName of fileContents.keys()) {
    const normalized = normalizeVirtualPath(fileName);
    const marker = `/node_modules/${moduleName}/`;
    const packageIndex = normalized.indexOf(marker);
    if (packageIndex >= 0) {
      packagePaths.add(normalized.slice(0, packageIndex + marker.length - 1));
    }
    if (atTypesName) {
      const typesMarker = `/node_modules/@types/${atTypesName}/`;
      const typesIndex = normalized.indexOf(typesMarker);
      if (typesIndex >= 0) {
        packagePaths.add(
          normalized.slice(0, typesIndex + typesMarker.length - 1),
        );
      }
    }
  }
  return [...packagePaths];
}

function toAtTypesPackageName(moduleName: string): string | undefined {
  const [first, second] = moduleName.split('/');
  if (!first) {
    return undefined;
  }
  if (!first.startsWith('@')) {
    return first;
  }
  return second ? `${first.slice(1)}__${second}` : undefined;
}

function collectRelevantMissingDependencyWarnings(
  program: ts.Program,
  sourceFile: ts.SourceFile,
  declaration: ts.InterfaceDeclaration | ts.TypeAliasDeclaration,
): string[] {
  const usedNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      usedNames.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration);

  const warnings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.importClause === undefined
    ) {
      continue;
    }
    const importedNames = getImportedLocalNames(statement.importClause);
    if (!importedNames.some((name) => usedNames.has(name))) {
      continue;
    }
    const resolved = resolveVirtualModule(
      statement.moduleSpecifier.text,
      sourceFile.fileName,
      new Map(
        program.getSourceFiles().map((file) => [file.fileName, file.text]),
      ),
    );
    if (!resolved) {
      warnings.add(
        `Could not resolve dependency ${JSON.stringify(statement.moduleSpecifier.text)} `
        + `used by ${JSON.stringify(declaration.name.text)}; local props were preserved.`,
      );
    }
  }
  return [...warnings];
}

function getImportedLocalNames(importClause: ts.ImportClause): string[] {
  const names: string[] = [];
  if (importClause.name) {
    names.push(importClause.name.text);
  }
  const bindings = importClause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    names.push(bindings.name.text);
  }
  if (bindings && ts.isNamedImports(bindings)) {
    names.push(...bindings.elements.map(({ name }) => name.text));
  }
  return names;
}

function parseTypeNode(typeName: string): ts.TypeNode | undefined {
  const sourceFile = ts.createSourceFile(
    '__resolved_type.ts',
    `type __Resolved = ${typeName};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = sourceFile.statements.find(ts.isTypeAliasDeclaration);
  return declaration?.type;
}

function normalizeTypeText(typeName: string): string {
  return typeName
    .replace(/"/g, "'")
    .replace(/;\s*}/g, '}')
    .replace(/\s+/g, '');
}

function createProgramCacheKey(files: readonly SourceFileInput[]): string {
  const normalized = [...files]
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
    .map(({ contents, fileName }) => `${fileName}\0${contents}`)
    .join('\0');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function toVirtualPath(fileName: string): string {
  return normalizeVirtualPath(`/${fileName}`);
}

function normalizeVirtualPath(fileName: string): string {
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
  return `/${segments.join('/')}`;
}

function getDirectoryName(fileName: string): string {
  const normalized = normalizeVirtualPath(fileName);
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex <= 0 ? '/' : normalized.slice(0, separatorIndex);
}
