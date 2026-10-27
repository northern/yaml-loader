import { readFileSync, realpathSync } from 'fs';
import { resolve, dirname, extname, relative, isAbsolute, sep } from 'path';
import { parse } from 'yaml';

// Type definitions
export interface YamlLoaderOptions {
  /** Maximum number of parsed files kept in memory during a single load (default: 100). */
  maxCacheSize?: number;
  /** Allow `$ref`s to files outside the directory of the root file (default: false). */
  allowExternalAccess?: boolean;
  /** Synchronous resolvers keyed by `$ref` prefix, e.g. `env:`. */
  customResolvers?: Map<string, (ref: string) => any>;
  /** @deprecated Has no effect. Kept for backward compatibility. */
  strictMode?: boolean;
}

export interface DebugInfo {
  /** Every reference resolved during the load, in resolution order. */
  refChain: string[];
  /** Files that were loaded, mapped to the kind of their top-level value. */
  fileCache: Map<string, string>;
  /** Total time in milliseconds. */
  resolutionTime: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: YamlLoaderError[];
  warnings: string[];
}

export type YamlLoaderErrorType =
  | 'circular_ref'
  | 'file_not_found'
  | 'invalid_pointer'
  | 'parse_error'
  | 'access_denied';

// Error types
export class YamlLoaderError extends Error {
  constructor(
    message: string,
    public readonly type: YamlLoaderErrorType,
    public readonly path?: string,
    public readonly refChain?: string[],
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'YamlLoaderError';
  }
}

// LRU File Cache implementation
class LRUFileCache {
  private cache = new Map<string, any>();

  constructor(private readonly maxSize: number) {}

  get(key: string): any | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: any): void {
    if (this.maxSize <= 0) {
      return;
    }
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

// Resolution context for tracking state
interface ResolutionContext {
  rootDir: string;
  realRootDir: string;
  pathChain: string[];
  pathSet: Set<string>;
  visited: string[];
  loadedFiles: Map<string, string>;
  warnings: string[];
  fileCache: LRUFileCache;
  options: YamlLoaderOptions;
  startTime: number;
}

const describeValue = (value: any): string => {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'array' : typeof value;
};

/**
 * Loads and parses a YAML or JSON file.
 * @param filename The absolute path to the file.
 * @param refChain The reference chain that led to this file, for error reporting.
 * @returns The parsed content.
 */
const loadFile = (filename: string, refChain: string[]): any => {
  let content: string;
  try {
    content = readFileSync(filename, 'utf-8');
  }
  catch (error) {
    throw new YamlLoaderError(
      `Failed to load file: ${filename}`,
      'file_not_found',
      filename,
      refChain,
      error,
    );
  }

  const isJson = extname(filename).toLowerCase() === '.json';
  try {
    return isJson ? JSON.parse(content) : parse(content);
  }
  catch (error) {
    throw new YamlLoaderError(
      `Failed to parse ${isJson ? 'JSON' : 'YAML'} file ${filename}: ${error instanceof Error ? error.message : String(error)}`,
      'parse_error',
      filename,
      refChain,
      error,
    );
  }
};

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

/**
 * Resolves a JSON pointer (RFC 6901) within an object.
 * @param obj The object to navigate.
 * @param pointer The JSON pointer path (e.g., "/definitions/User").
 * @param refChain The reference chain, for error reporting.
 * @returns The value at the specified path.
 */
const resolvePointer = (obj: any, pointer: string, refChain: string[]): any => {
  // "/" is treated as the document root for backward compatibility
  if (pointer === '' || pointer === '/') {
    return obj;
  }

  const fail = (reason: string): never => {
    throw new YamlLoaderError(
      `Cannot resolve pointer "${pointer}": ${reason}`,
      'invalid_pointer',
      pointer,
      refChain,
    );
  };

  if (!pointer.startsWith('/')) {
    fail('pointer must start with "/"');
  }

  let current = obj;
  for (const part of pointer.slice(1).split('/')) {
    // Decode JSON pointer escape sequences
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');

    const found = Array.isArray(current)
      ? ARRAY_INDEX.test(key) && Number(key) < current.length
      : current !== null && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, key);

    if (!found) {
      fail('path not found');
    }
    current = current[key];
  }

  return current;
};

const isWithin = (dir: string, target: string): boolean => {
  const rel = relative(dir, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};

/**
 * Resolves a path safely, preventing access outside the root file's directory.
 * @param fromDir The directory of the file containing the reference.
 * @param filePath The file path to resolve.
 * @param context The resolution context.
 * @returns The resolved absolute path.
 */
const resolvePath = (fromDir: string, filePath: string, context: ResolutionContext): string => {
  const resolved = resolve(fromDir, filePath);

  if (context.options.allowExternalAccess) {
    return resolved;
  }

  let real: string | undefined;
  try {
    real = realpathSync(resolved);
  }
  catch {
    // A missing file is reported when it is loaded
  }

  if (!isWithin(context.rootDir, resolved) || (real !== undefined && !isWithin(context.realRootDir, real))) {
    throw new YamlLoaderError(
      `Attempted to access file outside base directory: ${filePath}`,
      'access_denied',
      resolved,
      [...context.pathChain],
    );
  }

  return resolved;
};

/**
 * Parses a $ref value into file path and JSON pointer.
 * @param ref The $ref value (e.g., "./other.yaml#/definitions/User").
 * @returns An object with filePath and pointer.
 */
const parseRef = (ref: string): { filePath: string; pointer: string } => {
  const hashIndex = ref.indexOf('#');
  if (hashIndex === -1) {
    return { filePath: ref, pointer: '' };
  }

  const fragment = ref.slice(hashIndex + 1);
  let pointer = fragment;
  try {
    pointer = decodeURIComponent(fragment);
  }
  catch {
    // Not valid percent-encoding, use the fragment as is
  }

  return { filePath: ref.slice(0, hashIndex), pointer };
};

/**
 * Runs `fn` with `refKey` on the current resolution path, detecting cycles.
 */
const withRef = <T>(refKey: string, context: ResolutionContext, fn: () => T): T => {
  // Check if this reference is already in the current resolution path (O(1) lookup)
  if (context.pathSet.has(refKey)) {
    throw new YamlLoaderError(
      `Circular reference detected: ${context.pathChain.join(' -> ')} -> ${refKey}`,
      'circular_ref',
      refKey,
      [...context.pathChain, refKey],
    );
  }

  context.visited.push(refKey);
  context.pathChain.push(refKey);
  context.pathSet.add(refKey);

  try {
    return fn();
  }
  finally {
    context.pathChain.pop();
    context.pathSet.delete(refKey);
  }
};

/**
 * Recursively resolves all $ref references in an object with generics support.
 * @param obj The object to process.
 * @param currentFile The absolute path of the file `obj` came from.
 * @param context The resolution context for tracking state.
 * @param rootDoc The parsed content of `currentFile`, for resolving internal references.
 * @returns The object with all references resolved.
 */
const resolveRefs = <T = any>(
  obj: any,
  currentFile: string,
  context: ResolutionContext,
  rootDoc: any,
): T => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => resolveRefs(item, currentFile, context, rootDoc)) as T;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  // Note: When $ref is present, the entire object is replaced with the referenced content,
  // and any sibling properties are ignored. This follows the JSON Schema and OpenAPI
  // specifications where $ref takes precedence over all other properties.
  if (typeof obj.$ref === 'string' && obj.$ref) {
    const ref: string = obj.$ref;

    const siblings = Object.keys(obj).filter(key => key !== '$ref');
    if (siblings.length > 0) {
      context.warnings.push(`Properties next to $ref "${ref}" in ${currentFile} are ignored: ${siblings.join(', ')}`);
    }

    // Check for custom resolvers first
    for (const [prefix, resolver] of context.options.customResolvers ?? []) {
      if (ref.startsWith(prefix)) {
        return withRef(ref, context, () => resolveRefs(resolver(ref), currentFile, context, rootDoc));
      }
    }

    const { filePath, pointer } = parseRef(ref);

    if (filePath) {
      // External reference to another file
      const resolvedPath = resolvePath(dirname(currentFile), filePath, context);

      return withRef(resolvedPath + '#' + pointer, context, () => {
        let refContent = context.fileCache.get(resolvedPath);
        if (refContent === undefined) {
          refContent = loadFile(resolvedPath, [...context.pathChain]);
          context.fileCache.set(resolvedPath, refContent);
          context.loadedFiles.set(resolvedPath, describeValue(refContent));
        }

        const resolved = resolvePointer(refContent, pointer, [...context.pathChain]);

        // Use the loaded file content as rootDoc for resolving any internal references within the referenced file
        return resolveRefs(resolved, resolvedPath, context, refContent);
      });
    }

    // Internal reference within the same file (pointer only, e.g., "#/definitions/User")
    return withRef(currentFile + '#' + pointer, context, () => {
      const resolved = resolvePointer(rootDoc, pointer, [...context.pathChain]);
      return resolveRefs(resolved, currentFile, context, rootDoc);
    });
  }

  // Recursively process all properties. defineProperty keeps "__proto__" keys as plain data.
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    Object.defineProperty(result, key, {
      value: resolveRefs(value, currentFile, context, rootDoc),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return result;
};

/**
 * Creates a resolution context with default options.
 * @param filename The absolute path of the root file.
 * @param options The loader options.
 * @returns The resolution context.
 */
const createResolutionContext = (filename: string, options: YamlLoaderOptions = {}): ResolutionContext => {
  const rootDir = dirname(filename);
  let realRootDir = rootDir;
  try {
    realRootDir = realpathSync(rootDir);
  }
  catch {
    // The root file's load reports the problem
  }

  const maxCacheSize = options.maxCacheSize ?? 100;

  return {
    rootDir,
    realRootDir,
    pathChain: [],
    pathSet: new Set(),
    visited: [],
    loadedFiles: new Map(),
    warnings: [],
    fileCache: new LRUFileCache(maxCacheSize),
    options: {
      allowExternalAccess: false,
      strictMode: false,
      ...options,
      maxCacheSize,
      customResolvers: options.customResolvers ?? new Map(),
    },
    startTime: Date.now(),
  };
};

/**
 * Loads the root file and resolves all of its references.
 */
const loadAndResolve = <T>(filename: string, options?: YamlLoaderOptions): { result: T; context: ResolutionContext } => {
  const absolutePath = resolve(filename);
  const context = createResolutionContext(absolutePath, options);
  const content = loadFile(absolutePath, []);
  context.loadedFiles.set(absolutePath, describeValue(content));
  context.fileCache.set(absolutePath, content);

  // Pass the content as rootDoc so internal references can be resolved
  const result = resolveRefs<T>(content, absolutePath, context, content);
  return { result, context };
};

/**
 * Wraps errors that are not YamlLoaderErrors, such as one thrown by a custom resolver.
 */
const toLoaderError = (error: unknown, filename: string, prefix: string): YamlLoaderError => {
  if (error instanceof YamlLoaderError) {
    return error;
  }
  return new YamlLoaderError(
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
    'parse_error',
    filename,
    undefined,
    error,
  );
};

/**
 * Loads and parses a YAML file with generic type support, resolving all $ref references.
 * @param filename The path to the yaml file. Relative paths are resolved against the working directory.
 * @param options The loader options.
 * @returns The parsed and resolved content.
 */
export function loadYaml<T = any>(filename: string, options?: YamlLoaderOptions): T {
  try {
    return loadAndResolve<T>(filename, options).result;
  }
  catch (error) {
    throw toLoaderError(error, filename, 'Failed to parse YAML file');
  }
}

/**
 * Loads and parses a YAML file with debug information.
 * @param filename The path to the yaml file.
 * @param options The loader options.
 * @returns Object containing result and debug information.
 */
export function loadYamlWithDebug<T = any>(filename: string, options?: YamlLoaderOptions): { result: T; debug: DebugInfo } {
  try {
    const { result, context } = loadAndResolve<T>(filename, options);

    return {
      result,
      debug: {
        refChain: [...context.visited],
        fileCache: new Map(context.loadedFiles),
        resolutionTime: Date.now() - context.startTime,
      },
    };
  }
  catch (error) {
    throw toLoaderError(error, filename, 'Failed to parse YAML file');
  }
}

/**
 * Validates YAML references by resolving them, without throwing.
 * Resolution stops at the first error, so `errors` holds at most one entry.
 * `warnings` lists properties that are ignored because they sit next to a `$ref`.
 * @param filename The path to the yaml file.
 * @param options The loader options.
 * @returns Validation result with errors and warnings.
 */
export function validateYamlReferences(filename: string, options?: YamlLoaderOptions): ValidationResult {
  try {
    const { context } = loadAndResolve(filename, options);
    return { isValid: true, errors: [], warnings: context.warnings };
  }
  catch (error) {
    return { isValid: false, errors: [toLoaderError(error, filename, 'Unexpected error')], warnings: [] };
  }
}

/**
 * Builder class for creating configured YAML loaders.
 */
export class YamlLoaderBuilder {
  private options: YamlLoaderOptions = {};

  withCache(size: number): this {
    this.options.maxCacheSize = size;
    return this;
  }

  /** @deprecated Has no effect. Kept for backward compatibility. */
  withStrictMode(enabled: boolean): this {
    this.options.strictMode = enabled;
    return this;
  }

  withExternalAccess(enabled: boolean): this {
    this.options.allowExternalAccess = enabled;
    return this;
  }

  withCustomResolver(prefix: string, resolver: (ref: string) => any): this {
    if (!this.options.customResolvers) {
      this.options.customResolvers = new Map();
    }
    this.options.customResolvers.set(prefix, resolver);
    return this;
  }

  build(): (filename: string) => any {
    return this.buildGeneric();
  }

  buildGeneric<T = any>(): (filename: string) => T {
    // Snapshot the options so later builder calls don't change loaders already built
    const options: YamlLoaderOptions = {
      ...this.options,
      customResolvers: this.options.customResolvers && new Map(this.options.customResolvers),
    };
    return (filename: string) => loadYaml<T>(filename, options);
  }
}

// Default export for backward compatibility
export default loadYaml;
