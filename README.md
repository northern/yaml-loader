# YAML Loader

A comprehensive utility for loading and parsing YAML/JSON files with advanced `$ref` resolution, type safety, and performance optimizations.

## Install

Install with NPM:

    npm install @northern/yaml-loader

or Yarn:

    yarn add @northern/yaml-loader

## Table of Contents

- [Overview](#overview)
- [Install](#install)
- [Basic Usage](#basic-usage)
- [Type Safety](#type-safety)
- [Reference Resolution](#reference-resolution)
- [Configuration Options](#configuration-options)
- [Error Handling](#error-handling)
- [Performance Features](#performance-features)
- [Security Features](#security-features)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Migration Guide](#migration-guide)
- [Troubleshooting](#troubleshooting)

## Overview

The YAML loader module provides:

- **Multi-format support**: YAML and JSON file parsing
- **Advanced reference resolution**: Internal and external `$ref` resolution with circular detection
- **Type safety**: Full TypeScript generic support
- **Performance**: LRU caching and optimized algorithms
- **Security**: Configurable access controls and path validation
- **Debugging**: Comprehensive debug information and error reporting
- **Extensibility**: Custom resolver plugin system

## Basic Usage

```typescript
import loadYaml from '@northern/yaml-loader';
```

### Simple YAML Loading

```typescript
// Basic usage - returns any type. Relative paths are resolved against the working directory.
const config = loadYaml('config.yaml');
console.log(config.name); // Access properties with basic autocomplete
```

### Loading JSON Files

```typescript
// JSON files are supported automatically
const data = loadYaml('data.json');
```

### Loading Nested Structures

```typescript
// Complex nested YAML structures
const app = loadYaml('app.yaml');

// Access nested properties
const serverConfig = app.server;
const dbConfig = app.database;
```

## Type Safety

### Generic Types

```typescript
interface AppConfig {
  name: string;
  version: number;
  server: {
    host: string;
    port: number;
    ssl?: boolean;
  };
  database: {
    url: string;
    pool: {
      min: number;
      max: number;
    };
  };
  features: string[];
}

// Full type inference and compile-time checking
const config = loadYaml<AppConfig>('app.yaml');

// TypeScript will catch type errors
const host: string = config.server.host; // ✅ Valid
const port: string = config.server.port; // ❌ TypeScript error: Type 'number' is not assignable to 'string'
config.invalidProperty; // ❌ TypeScript error: Property does not exist
```

### Complex Nested Types

```typescript
interface User {
  id: number;
  name: string;
  profile: {
    email: string;
    avatar?: string;
  };
  roles: Array<{
    name: string;
    permissions: string[];
  }>;
}

interface UsersConfig {
  users: User[];
  metadata: {
    created: string; // YAML timestamps are parsed as strings
    version: string;
    tags: string[];
  };
}

const usersConfig = loadYaml<UsersConfig>('users.yaml');

// Full type safety throughout
usersConfig.users.forEach(user => {
  console.log(user.profile.email); // ✅ Type-safe access
  user.roles.forEach(role => {
    console.log(role.permissions.join(', ')); // ✅ Type-safe array operations
  });
});
```

### Union Types and Discriminated Unions

```typescript
type DatabaseConfig = 
  | { type: 'postgres'; host: string; port: number; database: string; }
  | { type: 'mongodb'; url: string; collection: string; };

interface ServiceConfig {
  name: string;
  database: DatabaseConfig;
}

const config = loadYaml<ServiceConfig>('service.yaml');

// TypeScript will help you handle different database types
if (config.database.type === 'postgres') {
  console.log(config.database.host); // ✅ TypeScript knows this is postgres config
  // config.database.url; // ❌ TypeScript error: Property 'url' does not exist
}
```

## Reference Resolution

### Internal References

```yaml
# config.yaml
definitions:
  server:
    host: localhost
    port: 3000
  database:
    url: postgresql://localhost:5432/mydb
    
services:
  api:
    # Internal reference to definitions
    $ref: "#/definitions/server"
  database:
    $ref: "#/definitions/database"
```

```typescript
const config = loadYaml('config.yaml');
// Result will have fully resolved structure
// {
//   definitions: { server: {...}, database: {...} },
//   services: {
//     api: { host: 'localhost', port: 3000 },
//     database: { url: 'postgresql://localhost:5432/mydb' }
//   }
// }
```

### External File References

```yaml
# shared/database.yaml
url: postgresql://localhost:5432/mydb
pool:
  min: 5
  max: 20

# config.yaml
database:
  $ref: "./shared/database.yaml"
  
api:
  version: v1
  port: 8080
```

### Combined External and Pointer References

```yaml
# schemas/user.yaml
definitions:
  User:
    type: object
    properties:
      id:
        type: integer
      name:
        type: string
      email:
        type: string
        format: email

# api.yaml
userSchema:
  $ref: "./schemas/user.yaml#/definitions/User"
  
endpoints:
  - path: /users
    schema:
      $ref: "./schemas/user.yaml#/definitions/User"
```

### Nested Reference Chains

```yaml
# level3.yaml
finalValue: "Deeply nested reference resolved"

# level2.yaml
data:
  $ref: "./level3.yaml"

# level1.yaml
nested:
  $ref: "./level2.yaml"

# main.yaml
result:
  $ref: "./level1.yaml"
```

### Array References

```yaml
# item.yaml
type: shared-item
properties:
  name: string
  value: number

# main.yaml
items:
  - name: inline1
    type: local
  - $ref: "./item.yaml"
  - name: inline2
    type: local
  - $ref: "./item.yaml"
```

### JSON Pointer Features

```yaml
# data.yaml
"a/b path":
  value: "path with slash"
"a~b":
  value: "path with tilde"
items:
  - first
  - second
  - third

# ref.yaml
# Reference with escaped characters
slashExample:
  $ref: "./data.yaml#/a~1b path"
tildeExample:
  $ref: "./data.yaml#/a~0b"
arrayItem:
  $ref: "./data.yaml#/items/1"
```

Pointers follow [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901): they must start with `/`, and the fragment may be percent-encoded (`#/a%20b`). A pointer to a key that doesn't exist throws an `invalid_pointer` error.

### Recursive Schemas

References are resolved by inlining, so a structure that refers to itself (for example, a tree node whose `children` refer back to the node) can't be represented and throws a `circular_ref` error.

## Configuration Options

### Basic Configuration

```typescript
import { YamlLoaderOptions } from '@northern/yaml-loader';

const options: YamlLoaderOptions = {
  maxCacheSize: 50,
  allowExternalAccess: false
};

const config = loadYaml('config.yaml', options);
```

### Cache Configuration

The cache lives for a single `loadYaml` call and holds parsed files that are referenced more than once.

```typescript
// Large cache for enterprise applications
const enterpriseOptions: YamlLoaderOptions = {
  maxCacheSize: 500 // Cache up to 500 files
};

// Small cache for simple applications
const simpleOptions: YamlLoaderOptions = {
  maxCacheSize: 10 // Cache only 10 files
};
```

### Security Configuration

```typescript
// Default: prevent directory traversal
const secureOptions: YamlLoaderOptions = {
  allowExternalAccess: false
};

// Allow external access for trusted environments
const openOptions: YamlLoaderOptions = {
  allowExternalAccess: true
};
```

### Strict Mode (deprecated)

`strictMode` and `YamlLoaderBuilder.withStrictMode()` are still accepted but have no effect. Use `validateYamlReferences()` to find problems such as properties ignored next to a `$ref`.

## Error Handling

### Basic Error Handling

```typescript
import { YamlLoaderError } from '@northern/yaml-loader';

try {
  const config = loadYaml('config.yaml');
  console.log('Loaded successfully:', config);
} catch (error) {
  if (error instanceof YamlLoaderError) {
    console.error(`YAML Error (${error.type}): ${error.message}`);
    if (error.path) {
      console.error('Path:', error.path);
    }
    if (error.refChain) {
      console.error('Reference chain:', error.refChain.join(' -> '));
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Error Types

```typescript
// Circular reference error
try {
  loadYaml('circular.yaml');
} catch (error) {
  if (error instanceof YamlLoaderError && error.type === 'circular_ref') {
    console.log('Circular reference detected');
    console.log('Chain:', error.refChain);
  }
}

// File not found error
try {
  loadYaml('missing.yaml');
} catch (error) {
  if (error instanceof YamlLoaderError && error.type === 'file_not_found') {
    console.log('File not found:', error.path);
  }
}

// Invalid JSON pointer
try {
  loadYaml('invalid-pointer.yaml');
} catch (error) {
  if (error instanceof YamlLoaderError && error.type === 'invalid_pointer') {
    console.log('Invalid pointer path:', error.path);
  }
}

// Parse error (in the root file or any referenced file)
try {
  loadYaml('invalid.yaml');
} catch (error) {
  if (error instanceof YamlLoaderError && error.type === 'parse_error') {
    console.log('Parse error:', error.message);
    console.log('Original error:', error.cause);
  }
}

// Reference to a file outside the root file's directory
try {
  loadYaml('config.yaml');
} catch (error) {
  if (error instanceof YamlLoaderError && error.type === 'access_denied') {
    console.log('Blocked reference to:', error.path);
  }
}
```

Errors thrown by a custom resolver are wrapped in a `parse_error`, with the original error in `cause`.

### Validation Mode

```typescript
import { validateYamlReferences } from '@northern/yaml-loader';

// Resolves everything but returns problems instead of throwing.
// Resolution stops at the first error, so `errors` holds at most one entry.
// `warnings` lists properties that are ignored because they sit next to a `$ref`.
const validation = validateYamlReferences('config.yaml');

if (validation.isValid) {
  console.log('All references are valid');
  const config = loadYaml('config.yaml');
} else {
  console.log('Validation failed:');
  validation.errors.forEach(error => {
    console.error(`- ${error.type}: ${error.message}`);
  });
  validation.warnings.forEach(warning => {
    console.warn(`Warning: ${warning}`);
  });
}
```

## Performance Features

### LRU Cache

```typescript
// Configure cache size based on application needs
const options: YamlLoaderOptions = {
  maxCacheSize: 100 // Default: 100 files
};

// Cache automatically handles:
// - Most recently used files stay in memory
// - Least recently used files are evicted when limit reached
// - Multiple references to same file use cached version

const config = loadYaml('main.yaml', options);
// If main.yaml references shared.yaml multiple times, it's loaded once
```

### Debug Mode

```typescript
import { loadYamlWithDebug } from '@northern/yaml-loader';

const { result, debug } = loadYamlWithDebug('complex.yaml');

console.log(`Resolution completed in ${debug.resolutionTime}ms`);
console.log(`Resolved ${debug.refChain.length} references`);
console.log(`Loaded ${debug.fileCache.size} files`);

// Every file loaded, with the kind of its top-level value ('object', 'array', ...)
for (const [file, kind] of debug.fileCache) {
  console.log(`${file}: ${kind}`);
}
```

### Performance Monitoring

```typescript
// Create a performance wrapper
function loadWithMetrics<T = any>(filename: string): T {
  const start = Date.now();
  const { result, debug } = loadYamlWithDebug(filename);
  const duration = Date.now() - start;
  
  console.log(`Load time: ${duration}ms`);
  console.log(`Files loaded: ${debug.fileCache.size}`);
  console.log(`References resolved: ${debug.refChain.length}`);
  
  return result;
}

const config = loadWithMetrics('config.yaml');
```

## Security Features

### Directory Traversal Protection

By default, every `$ref` must point inside the directory that contains the root file passed to `loadYaml`. Referenced files can use `../` as long as the target stays inside that directory. Symlinks are followed before the check, so a link can't be used to escape it.

```typescript
// Default: prevents access outside the root file's directory
const secureConfig = loadYaml('specs/api.yaml');
// Allowed in specs/paths/users.yaml: $ref: "../schemas/user.yaml"
// Fails with an 'access_denied' error:  $ref: "../../secret.yaml"
```

### Allow External Access

```typescript
// Enable external access for trusted environments
const options: YamlLoaderOptions = {
  allowExternalAccess: true
};

const config = loadYaml('config.yaml', options);
// Now allows: $ref: "../shared/config.yaml"
```

### Handling Denied Access

```typescript
try {
  loadYaml('config.yaml');
} catch (error) {
  if (error instanceof YamlLoaderError && error.type === 'access_denied') {
    console.error(`Reference outside the project: ${error.path}`);
    console.error('Via:', error.refChain?.join(' -> '));
  }
  throw error;
}
```

## Advanced Usage

### Builder Pattern

```typescript
import { YamlLoaderBuilder } from '@northern/yaml-loader';

// Simple builder
const loader = new YamlLoaderBuilder()
  .withCache(50)
  .withExternalAccess(false)
  .build();

const config = loader('config.yaml');

// Generic builder with type safety
interface AppConfig {
  name: string;
  version: number;
}

const typedLoader = new YamlLoaderBuilder()
  .withCache(25)
  .buildGeneric<AppConfig>();

const appConfig = typedLoader('app.yaml');
// Full type inference with AppConfig interface
```

### Custom Resolvers

A custom resolver handles every `$ref` that starts with its prefix, and is checked before file references. Its return value replaces the `$ref` object, and any `$ref`s inside that value are resolved too.

```typescript
import { YamlLoaderBuilder } from '@northern/yaml-loader';

// Environment variable resolver
const loader = new YamlLoaderBuilder()
  .withCustomResolver('env:', (ref) => {
    const varName = ref.replace('env:', '');
    return process.env[varName] || '';
  })
  .build();

const config = loader('config.yaml');
// config.database.url will contain the environment variable value
```

```yaml
# config.yaml
database:
  url:
    $ref: "env:DATABASE_URL"
  password:
    $ref: "env:DB_PASSWORD"
```

### Remote Resolvers

Resolvers must be synchronous: a resolver that returns a Promise puts the Promise itself into the result. To use remote schemas, fetch them first and serve them from memory:

```typescript
const urls = ['https://example.com/schemas/user.json'];
const remote = new Map<string, unknown>();
for (const url of urls) {
  remote.set(url, await (await fetch(url)).json());
}

const httpLoader = new YamlLoaderBuilder()
  .withCustomResolver('https:', (ref) => remote.get(ref))
  .build();
```

```yaml
# config.yaml
schema:
  $ref: "https://example.com/schemas/user.json"
```

### Template Resolver

```typescript
// Template-based resolver for dynamic values
const templateLoader = new YamlLoaderBuilder()
  .withCustomResolver('template:', (ref) => {
    const templateName = ref.replace('template:', '');
    const templates = {
      'user-service': {
        port: 3000,
        endpoints: ['/users', '/users/{id}']
      },
      'auth-service': {
        port: 3001,
        endpoints: ['/login', '/logout', '/refresh']
      }
    };
    return templates[templateName];
  })
  .build();
```

```yaml
# config.yaml
userService:
  $ref: "template:user-service"
authService:
  $ref: "template:auth-service"
```

### Conditional Loading

```typescript
function loadConfig(configPath: string, isProduction: boolean) {
  const options: YamlLoaderOptions = {
    maxCacheSize: isProduction ? 500 : 50,
    allowExternalAccess: !isProduction
  };
  
  return loadYaml(configPath, options);
}

const devConfig = loadConfig('config.yaml', false);
const prodConfig = loadConfig('config.yaml', true);
```

### Plugin System

```typescript
// Create a plugin loader
interface Plugin {
  name: string;
  resolver: (ref: string) => any;
}

class ExtensibleYamlLoader {
  private builder = new YamlLoaderBuilder();
  
  addPlugin(plugin: Plugin): this {
    this.builder.withCustomResolver(`${plugin.name}:`, plugin.resolver);
    return this;
  }
  
  build<T = any>() {
    return this.builder.buildGeneric<T>();
  }
}

// Usage
const loader = new ExtensibleYamlLoader()
  .addPlugin({
    name: 'env',
    resolver: (ref) => process.env[ref.replace('env:', '')] || ''
  })
  .addPlugin({
    name: 'secret',
    resolver: (ref) => {
      // Load from secret manager
      return getSecret(ref.replace('secret:', ''));
    }
  })
  .build();
```

## API Reference

### Core Functions

#### `loadYaml<T>(filename: string, options?: YamlLoaderOptions): T`

Loads and parses a YAML file with reference resolution.

**Parameters:**
- `filename: string` - Path to the YAML/JSON file (relative paths are resolved against the working directory)
- `options?: YamlLoaderOptions` - Configuration options (optional)

**Returns:**
- `T` - Parsed and resolved content with type inference

**Example:**
```typescript
const config = loadYaml<Config>('config.yaml');
```

#### `loadYamlWithDebug<T>(filename: string, options?: YamlLoaderOptions): { result: T; debug: DebugInfo }`

Loads YAML with debug information for troubleshooting.

**Returns:**
- `result: T` - The loaded configuration
- `debug: DebugInfo` - Debug information including cache stats and timing

#### `validateYamlReferences(filename: string, options?: YamlLoaderOptions): ValidationResult`

Resolves all references and reports problems instead of throwing.

**Returns:**
- `isValid: boolean` - Whether all references are valid
- `errors: YamlLoaderError[]` - The first error found (resolution stops there)
- `warnings: string[]` - Properties ignored because they sit next to a `$ref`

### Classes

#### `YamlLoaderBuilder`

Builder pattern for creating configured loaders.

**Methods:**
- `withCache(size: number): this` - Set cache size
- `withStrictMode(enabled: boolean): this` - Deprecated, has no effect
- `withExternalAccess(enabled: boolean): this` - Allow/deny external access
- `withCustomResolver(prefix: string, resolver: (ref: string) => any): this` - Add custom resolver
- `build(): (filename: string) => any` - Build configured loader
- `buildGeneric<T>(): (filename: string) => T` - Build typed loader

Each built loader keeps the options it was built with. Later builder calls don't change it.

#### `YamlLoaderError`

Enhanced error class for YAML loading issues.

**Properties:**
- `type: YamlLoaderErrorType` - Error category: `'circular_ref' | 'file_not_found' | 'invalid_pointer' | 'parse_error' | 'access_denied'`
- `path?: string` - File path or reference path
- `refChain?: string[]` - Chain of references that led to the error
- `cause?: unknown` - The underlying error, if any (for example, the YAML parser's error)

### Interfaces

#### `YamlLoaderOptions`

Configuration options for YAML loading.

```typescript
interface YamlLoaderOptions {
  maxCacheSize?: number;        // Maximum files to cache (default: 100)
  allowExternalAccess?: boolean; // Allow refs outside the root file's directory (default: false)
  customResolvers?: Map<string, (ref: string) => any>; // Synchronous custom resolvers
  strictMode?: boolean;         // Deprecated, has no effect
}
```

#### `DebugInfo`

Debug information from `loadYamlWithDebug`.

```typescript
interface DebugInfo {
  refChain: string[];                    // Every reference resolved, in order
  fileCache: Map<string, string>;        // Files loaded and the kind of their top-level value
  resolutionTime: number;                 // Time in milliseconds
}
```

## Migration Guide

### From Basic Usage

**Before:**
```typescript
const yamlLoader = require('@northern/yaml-loader').default;
const config = yamlLoader('config.yaml');
```

**After:**
```typescript
import { loadYaml } from '@northern/yaml-loader';
const config = loadYaml('config.yaml');
```

### Adding Type Safety

**Before:**
```typescript
const config = loadYaml('config.yaml');
// No type checking
const port = config.port; // Could be anything
```

**After:**
```typescript
interface Config {
  port: number;
  host: string;
}
const config = loadYaml<Config>('config.yaml');
const port = config.port; // TypeScript knows it's a number
```

### Adding Configuration

**Before:**
```typescript
const config = loadYaml('config.yaml');
```

**After:**
```typescript
const config = loadYaml('config.yaml', {
  maxCacheSize: 50,
  allowExternalAccess: true
});
```

### Using Builder Pattern

**Before:**
```typescript
const config = loadYaml('config.yaml');
```

**After:**
```typescript
const loader = new YamlLoaderBuilder()
  .withCache(50)
  .build();

const config = loader('config.yaml');
```

## Troubleshooting

### Common Issues

#### Circular References

**Error:** `Circular reference detected: A -> B -> A`

**Solution:**
- Check reference chains in YAML files
- Use `validateYamlReferences()` to detect issues early
- Consider restructuring to avoid circular dependencies (recursive schemas can't be inlined; see [Recursive Schemas](#recursive-schemas))

#### File Not Found

**Error:** `Failed to load file: /path/to/missing.yaml`

**Solutions:**
- Verify file paths are correct
- `$ref` paths are relative to the file that contains them
- Relative root paths passed to `loadYaml` are resolved against the working directory

#### Access Denied

**Error:** `Attempted to access file outside base directory: ../shared.yaml`

**Solutions:**
- Move shared files inside the root file's directory
- Set `allowExternalAccess: true` for trusted inputs

#### Type Errors

**Error:** TypeScript compilation errors

**Solutions:**
- Define proper interfaces for your YAML structure
- Use generic type parameter: `loadYaml<MyInterface>()`
- Check for optional properties with `?` in interfaces

#### Performance Issues

**Symptoms:** Slow loading times

**Solutions:**
- Increase cache size with `maxCacheSize`
- Use debug mode to identify bottlenecks
- Consider simplifying reference chains

### Debug Techniques

#### Using Debug Mode

```typescript
const { result, debug } = loadYamlWithDebug('complex.yaml');

console.log('Performance Analysis:');
console.log(`- Total time: ${debug.resolutionTime}ms`);
console.log(`- References: ${debug.refChain.length}`);
console.log(`- Cache size: ${debug.fileCache.size}`);

console.log('Reference Chain:');
debug.refChain.forEach((ref, index) => {
  console.log(`${index + 1}. ${ref}`);
});
```

#### Validation Before Loading

```typescript
const validation = validateYamlReferences('config.yaml');
if (!validation.isValid) {
  console.log('Issues found:');
  validation.errors.forEach(error => {
    console.error(`- ${error.type}: ${error.message}`);
  });
  return;
}

// Only load if validation passes
const config = loadYaml('config.yaml');
```

#### File Analysis

```typescript
// Create a file usage analyzer
function analyzeFileUsage(filename: string) {
  const { debug } = loadYamlWithDebug(filename);
  
  const fileUsage = new Map<string, number>();
  
  // Count file usage from reference chain
  debug.refChain.forEach(ref => {
    const filePath = ref.split('#')[0];
    fileUsage.set(filePath, (fileUsage.get(filePath) || 0) + 1);
  });
  
  console.log('File Usage:');
  for (const [file, count] of fileUsage) {
    console.log(`${file}: ${count} references`);
  }
}

analyzeFileUsage('config.yaml');
```

### Performance Optimization

#### Cache Tuning

```typescript
// For small applications
const smallAppOptions = { maxCacheSize: 10 };

// For medium applications
const mediumAppOptions = { maxCacheSize: 50 };

// For large applications
const largeAppOptions = { maxCacheSize: 200 };
```

#### Reference Optimization

```yaml
# Instead of many small references
api:
  user:
    $ref: "./schemas/user.yaml"
  product:
    $ref: "./schemas/product.yaml"
  order:
    $ref: "./schemas/order.yaml"

# Consider consolidating
api:
  schemas:
    $ref: "./schemas/all.yaml"
```

#### Loading a Section

`loadYaml` takes a file path, not a `$ref`, so it always loads the whole file. To work with a single section, reference it with a pointer from a small entry file:

```yaml
# user-service.yaml
$ref: "./config.yaml#/services/user"
```

```typescript
const userConfig = loadYaml('user-service.yaml');
```
