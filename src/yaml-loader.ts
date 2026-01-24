import { readFileSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { parse } from 'yaml';

// Type definitions
export interface YamlNode {
  $ref?: string;
  [key: string]: YamlNode | YamlNode[] | string | number | boolean | null | undefined;
}

export interface RefResolution {
  filePath: string;
  pointer: string;
  resolved: any;
}

export interface YamlLoaderOptions {
  maxCacheSize?: number;
  allowExternalAccess?: boolean;
  customResolvers?: Map<string, (ref: string) => any>;
  strictMode?: boolean;
}

export interface DebugInfo {
  refChain: string[];
  fileCache: Map<string, string>;
  resolutionTime: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: YamlLoaderError[];
  warnings: string[];
}

// Error types
export class YamlLoaderError extends Error {
  constructor(
    message: string,
    public readonly type: 'circular_ref' | 'file_not_found' | 'invalid_pointer' | 'parse_error',
    public readonly path?: string,
    public readonly refChain?: string[],
  ) {
    super(message);
    this.name = 'YamlLoaderError';
  }
}

// LRU File Cache implementation
class LRUFileCache {
  private cache = new Map<string, any>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

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
    if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getCache(): Map<string, any> {
    return this.cache;
  }
}

// Resolution context for tracking state
interface ResolutionContext {
  pathChain: string[];
  pathSet: Set<string>;
  fileCache: LRUFileCache;
  options: YamlLoaderOptions;
  startTime: number;
}

/**
 * Loads and parses a YAML or JSON file.
 * @param filename The absolute path to the file.
 * @returns The parsed content.
 */
const loadFile = (filename: string): any => {
  const content = readFileSync(filename, 'utf-8');
  const ext = extname(filename).toLowerCase();

  if (ext === '.json') {
    return JSON.parse(content);
  }
  return parse(content);
};

/**
 * Resolves a JSON pointer path within an object.
 * @param obj The object to navigate.
 * @param pointer The JSON pointer path (e.g., "/definitions/User").
 * @returns The value at the specified path.
 */
const resolvePointer = (obj: any, pointer: string): any => {
  if (!pointer || pointer === '' || pointer === '/') {
    return obj;
  }

  const parts = pointer.split('/').filter(Boolean);
  let current = obj;

  for (const part of parts) {
    // Make sure current is a valid object that can be indexed
    if (current === null || current === undefined || typeof current !== 'object') {
      throw new YamlLoaderError(
        `Cannot resolve pointer "${pointer}": path not found`,
        'invalid_pointer',
        pointer,
      );
    }

    // Decode JSON pointer escape sequences
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');

    current = current[decoded];
  }

  return current;
};

/**
 * Resolves a path safely, preventing directory traversal attacks.
 * @param baseDir The base directory.
 * @param filePath The file path to resolve.
 * @returns The resolved absolute path.
 */
const resolvePath = (baseDir: string, filePath: string, options: YamlLoaderOptions): string => {
  const resolved = resolve(baseDir, filePath);

  if (!options.allowExternalAccess && !resolved.startsWith(baseDir)) {
    throw new YamlLoaderError(
      `Attempted to access file outside base directory: ${filePath}`,
      'invalid_pointer',
      resolved,
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
  const [filePath, pointer = ''] = ref.split('#');
  return { filePath, pointer };
};

/**
 * Recursively resolves all $ref references in an object with generics support.
 * @param obj The object to process.
 * @param baseDir The base directory for resolving relative paths.
 * @param context The resolution context for tracking state.
 * @param rootDoc The root document for resolving internal references.
 * @returns The object with all references resolved.
 */
const resolveRefs = <T = any>(
  obj: any,
  baseDir: string,
  context: ResolutionContext,
  rootDoc?: any,
): T => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => resolveRefs(item, baseDir, context, rootDoc)) as T;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  // Check for custom resolvers first
  if (obj.$ref && typeof obj.$ref === 'string' && context.options.customResolvers) {
    for (const [prefix, resolver] of context.options.customResolvers) {
      if (obj.$ref.startsWith(prefix)) {
        return resolver(obj.$ref);
      }
    }
  }

  // Check if this object is a $ref reference
  // Note: When $ref is present, the entire object is replaced with the referenced content,
  // and any sibling properties are ignored. This follows the JSON Schema and OpenAPI
  // specifications where $ref takes precedence over all other properties.
  if (obj.$ref && typeof obj.$ref === 'string') {
    const { filePath, pointer } = parseRef(obj.$ref);

    if (filePath) {
      // External reference to another file
      const resolvedPath = resolvePath(baseDir, filePath, context.options);
      const refKey = resolvedPath + '#' + pointer;

      // Check if this reference is already in the current resolution path (O(1) lookup)
      if (context.pathSet.has(refKey)) {
        throw new YamlLoaderError(
          `Circular reference detected: ${context.pathChain.join(' -> ')} -> ${refKey}`,
          'circular_ref',
          refKey,
          [...context.pathChain, refKey],
        );
      }

      // Add current reference to both the path chain and set
      context.pathChain.push(refKey);
      context.pathSet.add(refKey);

      try {
        // Check if the file is already in the cache
        let refContent;
        if (context.fileCache.has(resolvedPath)) {
          refContent = context.fileCache.get(resolvedPath);
        }
        else {
          try {
            refContent = loadFile(resolvedPath);
            context.fileCache.set(resolvedPath, refContent);
          }
          catch (error) {
            throw new YamlLoaderError(
              `Failed to load file: ${resolvedPath}`,
              'file_not_found',
              resolvedPath,
              context.pathChain,
            );
          }
        }

        const refBaseDir = dirname(resolvedPath);
        const resolved = resolvePointer(refContent, pointer);

        // Recursively resolve any refs in the referenced content
        // Use the loaded file content as rootDoc for resolving any internal references within the referenced file
        return resolveRefs(resolved, refBaseDir, context, refContent);
      }
      finally {
        // Clean up: remove from both path chain and set
        context.pathChain.pop();
        context.pathSet.delete(refKey);
      }
    }
    else {
      // Internal reference within the same file (pointer only, e.g., "#/definitions/User")
      if (!rootDoc) {
        // Root document must be available for internal reference resolution
        throw new YamlLoaderError(
          `Cannot resolve internal reference "${obj.$ref}": root document not available`,
          'invalid_pointer',
          obj.$ref,
          context.pathChain,
        );
      }

      const refKey = '#' + pointer;

      // Check for circular references
      if (context.pathSet.has(refKey)) {
        throw new YamlLoaderError(
          `Circular reference detected: ${context.pathChain.join(' -> ')} -> ${refKey}`,
          'circular_ref',
          refKey,
          [...context.pathChain, refKey],
        );
      }

      // Add current reference to both the path chain and set
      context.pathChain.push(refKey);
      context.pathSet.add(refKey);

      try {
        const resolved = resolvePointer(rootDoc, pointer);
        // Recursively resolve any refs in the resolved content
        return resolveRefs(resolved, baseDir, context, rootDoc);
      }
      finally {
        // Clean up: remove from both path chain and set
        context.pathChain.pop();
        context.pathSet.delete(refKey);
      }
    }
  }

  // Recursively process all properties
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveRefs(value, baseDir, context, rootDoc);
  }

  return result;
};

/**
 * Creates a resolution context with default options.
 * @param options The loader options.
 * @returns The resolution context.
 */
const createResolutionContext = (options: YamlLoaderOptions = {}): ResolutionContext => {
  return {
    pathChain: [],
    pathSet: new Set(),
    fileCache: new LRUFileCache(options.maxCacheSize || 100),
    options: {
      maxCacheSize: 100,
      allowExternalAccess: false,
      strictMode: false,
      customResolvers: new Map(),
      ...options,
    },
    startTime: Date.now(),
  };
};

/**
 * Loads and parses a YAML file with generic type support, resolving all $ref references.
 * @param filename The absolute path to the yaml file.
 * @param options The loader options.
 * @returns The parsed and resolved content.
 */
export function loadYaml<T = any>(filename: string, options?: YamlLoaderOptions): T {
  const context = createResolutionContext(options);

  try {
    const content = loadFile(filename);
    const baseDir = dirname(filename);
    // Pass the content as rootDoc so internal references can be resolved
    return resolveRefs<T>(content, baseDir, context, content);
  }
  catch (error) {
    if (error instanceof YamlLoaderError) {
      throw error;
    }
    throw new YamlLoaderError(
      `Failed to parse YAML file: ${error instanceof Error ? error.message : String(error)}`,
      'parse_error',
      filename,
    );
  }
}

/**
 * Loads and parses a YAML file with debug information.
 * @param filename The absolute path to the yaml file.
 * @param options The loader options.
 * @returns Object containing result and debug information.
 */
export function loadYamlWithDebug<T = any>(filename: string, options?: YamlLoaderOptions): { result: T; debug: DebugInfo } {
  const context = createResolutionContext(options);

  try {
    const content = loadFile(filename);
    const baseDir = dirname(filename);
    const result = resolveRefs<T>(content, baseDir, context, content);

    return {
      result,
      debug: {
        refChain: [...context.pathChain],
        fileCache: new Map(Array.from(context.fileCache.getCache().entries()).map(([k, v]) => [k, typeof v] as [string, string])),
        resolutionTime: Date.now() - context.startTime,
      },
    };
  }
  catch (error) {
    if (error instanceof YamlLoaderError) {
      throw error;
    }
    throw new YamlLoaderError(
      `Failed to parse YAML file: ${error instanceof Error ? error.message : String(error)}`,
      'parse_error',
      filename,
    );
  }
}

/**
 * Validates YAML references without fully resolving them.
 * @param filename The absolute path to the yaml file.
 * @param options The loader options.
 * @returns Validation result with errors and warnings.
 */
export function validateYamlReferences(filename: string, options?: YamlLoaderOptions): ValidationResult {
  const errors: YamlLoaderError[] = [];
  const warnings: string[] = [];

  try {
    const context = createResolutionContext(options);
    const content = loadFile(filename);
    const baseDir = dirname(filename);

    // Perform a dry run of reference resolution
    resolveRefs(content, baseDir, context, content);

    return { isValid: true, errors, warnings };
  }
  catch (error) {
    if (error instanceof YamlLoaderError) {
      errors.push(error);
    }
    else {
      errors.push(new YamlLoaderError(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        'parse_error',
        filename,
      ));
    }

    return { isValid: false, errors, warnings };
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
    return (filename: string) => loadYaml(filename, this.options);
  }

  buildGeneric<T = any>(): (filename: string) => T {
    return (filename: string) => loadYaml<T>(filename, this.options);
  }
}

/**
 * Testing utility to access internal LRUFileCache for coverage purposes.
 * This is only for testing and should not be used in production.
 */
export function getTestCacheInterface(filename: string, options?: YamlLoaderOptions) {
  const context = createResolutionContext(options);

  // Load the file to initialize the cache
  loadFile(filename);

  // Return the cache interface for testing
  return {
    clear: () => context.fileCache.clear(),
    size: () => context.fileCache.size(),
    has: (key: string) => context.fileCache.has(key),
    getCache: () => context.fileCache.getCache(),
  };
}

// Default export for backward compatibility
export default loadYaml;
