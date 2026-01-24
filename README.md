# YAML Loader

A comprehensive utility for loading and parsing YAML/JSON files with advanced `$ref` resolution, type safety, and performance optimizations.

## Install

Install with NPM:

    npm install @northern/di

or Yarn:

    yarn add @northern/di

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
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
// Basic usage - returns any type
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
    created: Date;
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

## Configuration Options

### Basic Configuration

```typescript
import { YamlLoaderOptions } from './yaml-loader';

const options: YamlLoaderOptions = {
  maxCacheSize: 50,
  allowExternalAccess: false,
  strictMode: true
};

const config = loadYaml('config.yaml', options);
```

### Cache Configuration

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

### Strict Mode

```typescript
// Enable strict validation
const strictOptions: YamlLoaderOptions = {
  strictMode: true
};

// Disable for legacy compatibility
const lenientOptions: YamlLoaderOptions = {
  strictMode: false
};
```

## Error Handling

### Basic Error Handling

```typescript
import { YamlLoaderError } from './yaml-loader';

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

// Parse error
try {
  loadYaml('invalid.yaml');
} catch (error) {
  if (error instanceof YamlLoaderError && error.type === 'parse_error') {
    console.log('Parse error:', error.message);
  }
}
```

### Validation Mode

```typescript
import { validateYamlReferences } from './yaml-loader';

// Validate without full resolution
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
import { loadYamlWithDebug } from './yaml-loader';

const { result, debug } = loadYamlWithDebug('complex.yaml');

console.log(`Resolution completed in ${debug.resolutionTime}ms`);
console.log(`Processed ${debug.refChain.length} references`);
console.log(`Cached ${debug.fileCache.size} files`);

// Analyze cache contents
for (const [file, type] of debug.fileCache) {
  console.log(`${file}: ${type}`);
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
  console.log(`Cache hits: ${debug.fileCache.size}`);
  console.log(`References resolved: ${debug.refChain.length}`);
  
  return result;
}

const config = loadWithMetrics('config.yaml');
```

## Security Features

### Directory Traversal Protection

```typescript
// Default: prevents access outside base directory
const secureConfig = loadYaml('config.yaml');
// This will fail if config.yaml contains: $ref: "../secret.yaml"
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

### Path Validation

```typescript
// Custom path validation
function loadWithValidation(filename: string, allowedPaths: string[]) {
  try {
    return loadYaml(filename, { allowExternalAccess: true });
  } catch (error) {
    if (error instanceof YamlLoaderError && error.type === 'file_not_found') {
      // Check if path is in allowed list
      const isAllowed = allowedPaths.some(path => 
        error.path?.includes(path)
      );
      if (!isAllowed) {
        throw new Error('Access denied to external file');
      }
    }
    throw error;
  }
}
```

## Advanced Usage

### Builder Pattern

```typescript
import { YamlLoaderBuilder } from './yaml-loader';

// Simple builder
const loader = new YamlLoaderBuilder()
  .withCache(50)
  .withStrictMode(true)
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

```typescript
import { YamlLoaderBuilder } from './yaml-loader';

// Environment variable resolver
const loader = new YamlLoaderBuilder()
  .withCustomResolver('env:', (ref) => {
    const varName = ref.replace('env:', '');
    return process.env[varName] || '';
  })
  .build();

// Usage in YAML:
# config.yaml
database:
  url: env:DATABASE_URL
  password: env:DB_PASSWORD

const config = loader('config.yaml');
// config.database.url will contain the environment variable value
```

### HTTP Resolver

```typescript
import axios from 'axios';

// HTTP-based resolver for remote schemas
const httpLoader = new YamlLoaderBuilder()
  .withCustomResolver('http:', async (ref) => {
    const response = await axios.get(ref);
    return response.data;
  })
  .withCustomResolver('https:', async (ref) => {
    const response = await axios.get(ref);
    return response.data;
  })
  .build();

// Usage in YAML:
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

// Usage in YAML:
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
    allowExternalAccess: !isProduction,
    strictMode: isProduction
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
- `filename: string` - Absolute path to the YAML/JSON file
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

Validates references without full resolution.

**Returns:**
- `isValid: boolean` - Whether all references are valid
- `errors: YamlLoaderError[]` - List of validation errors
- `warnings: string[]` - List of warnings

### Classes

#### `YamlLoaderBuilder`

Builder pattern for creating configured loaders.

**Methods:**
- `withCache(size: number): this` - Set cache size
- `withStrictMode(enabled: boolean): this` - Enable/disable strict mode
- `withExternalAccess(enabled: boolean): this` - Allow/deny external access
- `withCustomResolver(prefix: string, resolver: (ref: string) => any): this` - Add custom resolver
- `build(): (filename: string) => any` - Build configured loader
- `buildGeneric<T>(): (filename: string) => T` - Build typed loader

#### `YamlLoaderError`

Enhanced error class for YAML loading issues.

**Properties:**
- `type: 'circular_ref' | 'file_not_found' | 'invalid_pointer' | 'parse_error'` - Error category
- `path?: string` - File path or reference path
- `refChain?: string[]` - Chain of references that led to the error

### Interfaces

#### `YamlLoaderOptions`

Configuration options for YAML loading.

```typescript
interface YamlLoaderOptions {
  maxCacheSize?: number;        // Maximum files to cache (default: 100)
  allowExternalAccess?: boolean; // Allow directory traversal (default: false)
  customResolvers?: Map<string, (ref: string) => any>; // Custom resolvers
  strictMode?: boolean;         // Enable strict validation (default: false)
}
```

#### `DebugInfo`

Debug information from `loadYamlWithDebug`.

```typescript
interface DebugInfo {
  refChain: string[];                    // Reference resolution chain
  fileCache: Map<string, string>;        // Cached files and their types
  resolutionTime: number;                 // Time in milliseconds
}
```

## Migration Guide

### From Basic Usage

**Before:**
```typescript
const yamlLoader = require('./yaml-loader');
const config = yamlLoader('config.yaml');
```

**After:**
```typescript
import { loadYaml } from './yaml-loader';
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
  allowExternalAccess: true,
  strictMode: false
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
  .withStrictMode(true)
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
- Consider restructuring to avoid circular dependencies

#### File Not Found

**Error:** `Failed to load file: /path/to/missing.yaml`

**Solutions:**
- Verify file paths are correct
- Check if `allowExternalAccess: true` is needed for external files
- Use absolute paths for reliable resolution

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

#### Lazy Loading

```typescript
// Load only what you need
function loadSection<T>(filename: string, pointer: string): T {
  const fullPath = `${filename}#${pointer}`;
  return loadYaml<T>(fullPath);
}

const userConfig = loadSection('config.yaml', '#/services/user');
const dbConfig = loadSection('config.yaml', '#/database');
```
