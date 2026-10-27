import {
  loadYaml,
  loadYamlWithDebug,
  validateYamlReferences,
  YamlLoaderBuilder,
  YamlLoaderError,
  YamlLoaderOptions,
} from '.';
import fs, { writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { join, dirname, relative } from 'path';
import { tmpdir } from 'os';

describe('yaml-loader', () => {
  let testDir: string;
  let caseDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), 'yaml-loader-test-'));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Every test gets its own directory so fixtures can't leak between tests
    caseDir = mkdtempSync(join(testDir, 'case-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const writeTestFile = (filename: string, content: string): string => {
    const filePath = join(caseDir, filename);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    return filePath;
  };

  const catchError = (fn: () => unknown): YamlLoaderError => {
    try {
      fn();
    }
    catch (error) {
      expect(error).toBeInstanceOf(YamlLoaderError);
      return error as YamlLoaderError;
    }
    throw new Error('Expected function to throw');
  };

  describe('basic YAML loading', () => {
    it('should load a simple YAML file', () => {
      const filePath = writeTestFile('simple.yaml', `
name: Test
version: 1.0
`);
      const result = loadYaml(filePath);
      expect(result).toEqual({ name: 'Test', version: 1.0 });
    });

    it('should load a YAML file with nested objects', () => {
      const filePath = writeTestFile('nested.yaml', `
server:
  host: localhost
  port: 3000
database:
  name: testdb
`);
      const result = loadYaml(filePath);
      expect(result).toEqual({
        server: { host: 'localhost', port: 3000 },
        database: { name: 'testdb' },
      });
    });

    it('should load a YAML file with arrays', () => {
      const filePath = writeTestFile('arrays.yaml', `
items:
  - name: item1
  - name: item2
`);
      const result = loadYaml(filePath);
      expect(result).toEqual({
        items: [{ name: 'item1' }, { name: 'item2' }],
      });
    });

    it('should return null for empty YAML file', () => {
      const filePath = writeTestFile('empty.yaml', '');
      expect(loadYaml(filePath)).toBeNull();
    });

    it('should return null for YAML files with only comments', () => {
      const filePath = writeTestFile('comments-only.yaml', '# This is a comment\n# Another comment');
      expect(loadYaml(filePath)).toBeNull();
    });

    it('should load JSON files', () => {
      const filePath = writeTestFile('empty.json', '{}');
      expect(loadYaml(filePath)).toEqual({});
    });

    it('should handle primitive values correctly', () => {
      const filePath = writeTestFile('primitives.yaml', `
string: hello
number: 42
float: 3.14
boolean: true
nullValue: null
`);
      expect(loadYaml(filePath)).toEqual({
        string: 'hello',
        number: 42,
        float: 3.14,
        boolean: true,
        nullValue: null,
      });
    });

    it('should accept a path relative to the working directory', () => {
      writeTestFile('relative-target.yaml', 'value: resolved');
      const filePath = writeTestFile('relative-main.yaml', `
data:
  $ref: "./relative-target.yaml"
`);
      const result = loadYaml(relative(process.cwd(), filePath));
      expect(result).toEqual({ data: { value: 'resolved' } });
    });

    it('should keep "__proto__" keys as data without changing the prototype', () => {
      const jsonPath = writeTestFile('proto.json', '{"__proto__": {"polluted": true}, "a": 1}');
      const fromJson = loadYaml(jsonPath);
      expect(Object.keys(fromJson)).toEqual(['__proto__', 'a']);
      expect(Object.getPrototypeOf(fromJson)).toBe(Object.prototype);
      expect(fromJson.polluted).toBeUndefined();

      const yamlPath = writeTestFile('proto.yaml', '__proto__:\n  polluted: true\n');
      const fromYaml = loadYaml(yamlPath);
      expect(Object.getPrototypeOf(fromYaml)).toBe(Object.prototype);
      expect(fromYaml.polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  describe('$ref resolution - internal references', () => {
    it('should resolve an internal $ref within the same file', () => {
      const filePath = writeTestFile('internal-ref.yaml', `
definitions:
  User:
    type: object
    properties:
      name:
        type: string
user:
  $ref: "#/definitions/User"
`);
      const result = loadYaml(filePath);
      expect(result).toEqual({
        definitions: {
          User: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        },
        user: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      });
    });

    it('should resolve multiple internal $refs within the same file', () => {
      const filePath = writeTestFile('multi-internal-ref.yaml', `
definitions:
  Address:
    type: object
  Person:
    type: string
homeAddress:
  $ref: "#/definitions/Address"
workAddress:
  $ref: "#/definitions/Address"
owner:
  $ref: "#/definitions/Person"
`);
      const result = loadYaml(filePath);
      expect(result.homeAddress).toEqual({ type: 'object' });
      expect(result.workAddress).toEqual({ type: 'object' });
      expect(result.owner).toEqual({ type: 'string' });
    });

    it('should resolve nested internal $refs', () => {
      const filePath = writeTestFile('nested-internal-ref.yaml', `
definitions:
  Name:
    type: string
  User:
    type: object
    properties:
      name:
        $ref: "#/definitions/Name"
user:
  $ref: "#/definitions/User"
`);
      const result = loadYaml(filePath);
      expect(result.user).toEqual({
        type: 'object',
        properties: { name: { type: 'string' } },
      });
    });

    it('should resolve internal $ref to array item', () => {
      const filePath = writeTestFile('internal-array-ref.yaml', `
items:
  - first
  - second
  - third
selected:
  $ref: "#/items/1"
`);
      expect(loadYaml(filePath)).toEqual({
        items: ['first', 'second', 'third'],
        selected: 'second',
      });
    });

    it('should throw error for circular internal references', () => {
      const filePath = writeTestFile('circular-internal-ref.yaml', `
definitions:
  A:
    $ref: "#/definitions/B"
  B:
    $ref: "#/definitions/A"
item:
  $ref: "#/definitions/A"
`);
      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('circular_ref');
      expect(error.message).toMatch(/Circular reference detected/);
    });

    it('should not report a cycle when two files use the same internal pointer', () => {
      writeTestFile('other.yaml', `
value:
  $ref: "#/defs/X"
defs:
  X:
    ok: true
`);
      const filePath = writeTestFile('main.yaml', `
item:
  $ref: "#/defs/X"
defs:
  X:
    $ref: "./other.yaml"
`);
      const result = loadYaml(filePath);
      expect(result.item.value).toEqual({ ok: true });
    });
  });

  describe('$ref resolution - external files', () => {
    it('should resolve a $ref to another YAML file', () => {
      writeTestFile('referenced.yaml', 'message: Hello from referenced file');
      const filePath = writeTestFile('main.yaml', `
data:
  $ref: "./referenced.yaml"
`);
      expect(loadYaml(filePath)).toEqual({
        data: { message: 'Hello from referenced file' },
      });
    });

    it('should resolve a $ref to a JSON file', () => {
      writeTestFile('data.json', JSON.stringify({ count: 42, active: true }));
      const filePath = writeTestFile('main-json-ref.yaml', `
config:
  $ref: "./data.json"
`);
      expect(loadYaml(filePath)).toEqual({
        config: { count: 42, active: true },
      });
    });

    it('should resolve a $ref with a JSON pointer', () => {
      writeTestFile('definitions.yaml', `
definitions:
  User:
    type: object
`);
      const filePath = writeTestFile('schema.yaml', `
user:
  $ref: "./definitions.yaml#/definitions/User"
`);
      expect(loadYaml(filePath)).toEqual({ user: { type: 'object' } });
    });

    it('should resolve a $ref to a deeply nested path', () => {
      writeTestFile('deep.yaml', `
level1:
  level2:
    level3:
      value: deep value
`);
      const filePath = writeTestFile('deep-ref.yaml', `
result:
  $ref: "./deep.yaml#/level1/level2/level3"
`);
      expect(loadYaml(filePath)).toEqual({ result: { value: 'deep value' } });
    });

    it('should resolve a $ref at the document root', () => {
      writeTestFile('root-target.yaml', 'value: default');
      const filePath = writeTestFile('root-level-ref.yaml', '$ref: "./root-target.yaml"');
      expect(loadYaml(filePath)).toEqual({ value: 'default' });
    });

    it('should resolve internal refs inside a referenced file against that file', () => {
      writeTestFile('lib.yaml', `
exported:
  $ref: "#/private"
private:
  secret: from-lib
`);
      const filePath = writeTestFile('consumer.yaml', `
private:
  secret: from-consumer
data:
  $ref: "./lib.yaml#/exported"
`);
      expect(loadYaml(filePath).data).toEqual({ secret: 'from-lib' });
    });
  });

  describe('$ref resolution - nested references', () => {
    it('should resolve nested $ref references', () => {
      writeTestFile('level2.yaml', 'finalValue: nested reference resolved');
      writeTestFile('level1.yaml', `
nested:
  $ref: "./level2.yaml"
`);
      const filePath = writeTestFile('root.yaml', `
data:
  $ref: "./level1.yaml"
`);
      expect(loadYaml(filePath)).toEqual({
        data: { nested: { finalValue: 'nested reference resolved' } },
      });
    });

    it('should resolve multiple $ref references at the same level', () => {
      writeTestFile('ref-a.yaml', 'valueA: A');
      writeTestFile('ref-b.yaml', 'valueB: B');
      const filePath = writeTestFile('multi-ref.yaml', `
partA:
  $ref: "./ref-a.yaml"
partB:
  $ref: "./ref-b.yaml"
`);
      expect(loadYaml(filePath)).toEqual({
        partA: { valueA: 'A' },
        partB: { valueB: 'B' },
      });
    });

    it('should resolve $ref in arrays', () => {
      writeTestFile('array-item.yaml', 'type: referenced');
      const filePath = writeTestFile('array-ref.yaml', `
items:
  - name: inline
  - $ref: "./array-item.yaml"
`);
      expect(loadYaml(filePath)).toEqual({
        items: [{ name: 'inline' }, { type: 'referenced' }],
      });
    });

    it('should allow sibling references to the same file', () => {
      writeTestFile('sibling-shared.yaml', 'value: shared');
      const filePath = writeTestFile('sibling-refs.yaml', `
first:
  $ref: "./sibling-shared.yaml"
second:
  $ref: "./sibling-shared.yaml"
`);
      const result = loadYaml(filePath);
      expect(result).toEqual({
        first: { value: 'shared' },
        second: { value: 'shared' },
      });
      // Each reference gets its own copy
      expect(result.first).not.toBe(result.second);
    });
  });

  describe('$ref resolution - subdirectories', () => {
    it('should resolve $ref to files in subdirectories', () => {
      writeTestFile('subdir/component.yaml', 'name: SubdirComponent');
      const filePath = writeTestFile('with-subdir.yaml', `
component:
  $ref: "./subdir/component.yaml"
`);
      expect(loadYaml(filePath)).toEqual({ component: { name: 'SubdirComponent' } });
    });

    it('should resolve relative paths from referenced files', () => {
      writeTestFile('nested/deep/final.yaml', 'final: true');
      writeTestFile('nested/middle.yaml', `
ref:
  $ref: "./deep/final.yaml"
`);
      const filePath = writeTestFile('start.yaml', `
data:
  $ref: "./nested/middle.yaml"
`);
      expect(loadYaml(filePath)).toEqual({ data: { ref: { final: true } } });
    });

    it('should allow a nested file to reference a sibling directory inside the root', () => {
      writeTestFile('schemas/user.yaml', 'type: object');
      writeTestFile('paths/users.yaml', `
schema:
  $ref: "../schemas/user.yaml"
`);
      const filePath = writeTestFile('api.yaml', `
users:
  $ref: "./paths/users.yaml"
`);
      expect(loadYaml(filePath)).toEqual({ users: { schema: { type: 'object' } } });
    });
  });

  describe('JSON pointer edge cases', () => {
    it('should handle JSON pointer with escaped characters', () => {
      writeTestFile('escaped.yaml', `
"a/b":
  value: slashed
"a~b":
  value: tilded
`);
      const slashPath = writeTestFile('escaped-slash-ref.yaml', `
result:
  $ref: "./escaped.yaml#/a~1b"
`);
      expect(loadYaml(slashPath)).toEqual({ result: { value: 'slashed' } });

      const tildePath = writeTestFile('escaped-tilde-ref.yaml', `
result:
  $ref: "./escaped.yaml#/a~0b"
`);
      expect(loadYaml(tildePath)).toEqual({ result: { value: 'tilded' } });
    });

    it('should handle "#" and percent-encoding inside a pointer', () => {
      writeTestFile('special-keys.yaml', `
"a#b": hashed
"a b": spaced
`);
      const filePath = writeTestFile('special-ref.yaml', `
hash:
  $ref: "./special-keys.yaml#/a#b"
space:
  $ref: "./special-keys.yaml#/a%20b"
`);
      expect(loadYaml(filePath)).toEqual({ hash: 'hashed', space: 'spaced' });
    });

    it('should handle $ref to root of file with empty pointer', () => {
      writeTestFile('full-file.yaml', 'key: value');
      const filePath = writeTestFile('root-ref.yaml', `
all:
  $ref: "./full-file.yaml#"
`);
      expect(loadYaml(filePath)).toEqual({ all: { key: 'value' } });
    });

    it('should handle $ref to array index', () => {
      writeTestFile('with-array.yaml', `
items:
  - first
  - second
`);
      const filePath = writeTestFile('array-index-ref.yaml', `
second:
  $ref: "./with-array.yaml#/items/1"
`);
      expect(loadYaml(filePath)).toEqual({ second: 'second' });
    });

    it.each([
      ['a missing nested path', './valid.yaml#/nonexistent/path'],
      ['a missing final key', './valid.yaml#/existing/missing'],
      ['a missing internal key', '#/nonexistent'],
      ['a primitive traversal', './valid.yaml#/list/0/invalid'],
      ['an out-of-range array index', './valid.yaml#/list/5'],
      ['an array property', './valid.yaml#/list/length'],
      ['an inherited property', '#/constructor'],
      ['a pointer without a leading slash', './valid.yaml#existing'],
    ])('should throw invalid_pointer for %s', (_name, ref) => {
      writeTestFile('valid.yaml', `
existing:
  key: value
list:
  - first
`);
      const filePath = writeTestFile('invalid-pointer.yaml', `
data:
  $ref: "${ref}"
`);
      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('invalid_pointer');
      expect(error.message).toMatch(/Cannot resolve pointer/);
    });
  });

  describe('error handling', () => {
    it('should throw error for circular references', () => {
      writeTestFile('circular-b.yaml', `
ref:
  $ref: "./circular-a.yaml"
`);
      const filePath = writeTestFile('circular-a.yaml', `
ref:
  $ref: "./circular-b.yaml"
`);
      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('circular_ref');
      expect(error.refChain?.length).toBeGreaterThan(1);
    });

    it('should throw error for multi-hop circular references (A->B->C->A)', () => {
      writeTestFile('cycle-b.yaml', 'ref:\n  $ref: "./cycle-c.yaml"');
      writeTestFile('cycle-c.yaml', 'ref:\n  $ref: "./cycle-a.yaml"');
      const filePath = writeTestFile('cycle-a.yaml', 'ref:\n  $ref: "./cycle-b.yaml"');
      expect(() => loadYaml(filePath)).toThrow(/Circular reference detected/);
    });

    it('should throw error for longer circular reference chains (A->B->C->D->B)', () => {
      writeTestFile('long-cycle-b.yaml', 'ref:\n  $ref: "./long-cycle-c.yaml"');
      writeTestFile('long-cycle-c.yaml', 'ref:\n  $ref: "./long-cycle-d.yaml"');
      writeTestFile('long-cycle-d.yaml', 'ref:\n  $ref: "./long-cycle-b.yaml"');
      const filePath = writeTestFile('long-cycle-a.yaml', 'ref:\n  $ref: "./long-cycle-b.yaml"');
      expect(() => loadYaml(filePath)).toThrow(/Circular reference detected/);
    });

    it('should report a missing referenced file as file_not_found with its ref chain', () => {
      writeTestFile('middle.yaml', 'data:\n  $ref: "./non-existent.yaml"');
      const filePath = writeTestFile('missing-ref.yaml', 'middle:\n  $ref: "./middle.yaml"');

      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('file_not_found');
      expect(error.path).toBe(join(caseDir, 'non-existent.yaml'));
      expect(error.refChain).toEqual([
        join(caseDir, 'middle.yaml') + '#',
        join(caseDir, 'non-existent.yaml') + '#',
      ]);
      expect(error.cause).toBeDefined();
    });

    it('should report a missing root file as file_not_found', () => {
      const error = catchError(() => loadYaml(join(caseDir, 'does-not-exist.yaml')));
      expect(error.type).toBe('file_not_found');
      expect(error.message).toMatch(/Failed to load file/);
    });

    it('should report malformed root YAML as parse_error', () => {
      const filePath = writeTestFile('malformed.yaml', 'invalid: [unbalanced bracket');
      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('parse_error');
      expect(error.message).toMatch(/Failed to parse YAML file/);
    });

    it('should report a malformed referenced file as parse_error, not file_not_found', () => {
      const brokenPath = writeTestFile('broken.json', '{ not json');
      const filePath = writeTestFile('refs-broken.yaml', 'data:\n  $ref: "./broken.json"');

      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('parse_error');
      expect(error.path).toBe(brokenPath);
      expect(error.message).toContain(brokenPath);
      expect(error.cause).toBeInstanceOf(SyntaxError);
    });
  });

  describe('preserving non-ref content', () => {
    it('should preserve other properties alongside resolved refs', () => {
      writeTestFile('partial.yaml', 'refValue: from file');
      const filePath = writeTestFile('mixed.yaml', `
inline: direct value
external:
  $ref: "./partial.yaml"
another: also direct
`);
      expect(loadYaml(filePath)).toEqual({
        inline: 'direct value',
        external: { refValue: 'from file' },
        another: 'also direct',
      });
    });

    it('should ignore sibling properties when $ref is present (per JSON Schema/OpenAPI spec)', () => {
      writeTestFile('ref-target.yaml', 'fromRef: true\nvalue: 42');
      const filePath = writeTestFile('ref-with-siblings.yaml', `
data:
  $ref: "./ref-target.yaml"
  ignored: this should be ignored
  alsoIgnored: this too
`);
      expect(loadYaml(filePath)).toEqual({ data: { fromRef: true, value: 42 } });
    });
  });

  describe('file caching', () => {
    const readsOf = (spy: jest.SpyInstance, filePath: string): number =>
      spy.mock.calls.filter(([path]) => path === filePath).length;

    it('should read a file once when it is referenced multiple times', () => {
      const sharedPath = writeTestFile('shared.yaml', 'sharedValue: cached content');
      const filePath = writeTestFile('multi-ref-same-file.yaml', `
first:
  $ref: "./shared.yaml"
second:
  $ref: "./shared.yaml#/sharedValue"
third:
  $ref: "./shared.yaml"
`);
      const spy = jest.spyOn(fs, 'readFileSync');
      const result = loadYaml(filePath);

      expect(result).toEqual({
        first: { sharedValue: 'cached content' },
        second: 'cached content',
        third: { sharedValue: 'cached content' },
      });
      expect(readsOf(spy, sharedPath)).toBe(1);
    });

    it('should re-read evicted files when the cache is full', () => {
      const aPath = writeTestFile('cache-a.yaml', 'value: a');
      writeTestFile('cache-b.yaml', 'value: b');
      const filePath = writeTestFile('main-cache.yaml', `
ref1:
  $ref: "./cache-a.yaml"
ref2:
  $ref: "./cache-b.yaml"
ref3:
  $ref: "./cache-a.yaml"
`);
      const spy = jest.spyOn(fs, 'readFileSync');
      const result = loadYaml(filePath, { maxCacheSize: 1 });

      expect(result).toEqual({ ref1: { value: 'a' }, ref2: { value: 'b' }, ref3: { value: 'a' } });
      expect(readsOf(spy, aPath)).toBe(2);
    });

    it('should not cache at all when maxCacheSize is 0', () => {
      const sharedPath = writeTestFile('zero-cache.yaml', 'value: test');
      const filePath = writeTestFile('main-zero.yaml', `
data1:
  $ref: "./zero-cache.yaml"
data2:
  $ref: "./zero-cache.yaml"
`);
      const spy = jest.spyOn(fs, 'readFileSync');
      const result = loadYaml(filePath, { maxCacheSize: 0 });

      expect(result).toEqual({ data1: { value: 'test' }, data2: { value: 'test' } });
      expect(readsOf(spy, sharedPath)).toBe(2);
    });
  });

  describe('generic type support', () => {
    interface TestConfig {
      name: string;
      version: number;
      server: {
        host: string;
        port: number;
      };
    }

    it('should load YAML with proper type inference', () => {
      const filePath = writeTestFile('typed.yaml', `
name: test-service
version: 1.0
server:
  host: localhost
  port: 3000
`);
      const result = loadYaml<TestConfig>(filePath);

      // This should compile without errors
      const host: string = result.server.host;
      const port: number = result.server.port;
      expect(result.name).toBe('test-service');
      expect(host).toBe('localhost');
      expect(port).toBe(3000);
    });
  });

  describe('security', () => {
    it('should prevent directory traversal by default', () => {
      writeTestFile('safe.yaml', 'data: safe');
      const filePath = writeTestFile('root/traversal.yaml', `
data:
  $ref: "../safe.yaml"
`);
      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('access_denied');
    });

    it('should not allow a directory that only shares a name prefix with the root', () => {
      writeTestFile('app-secrets/secret.yaml', 'password: hunter2');
      const filePath = writeTestFile('app/main.yaml', `
data:
  $ref: "../app-secrets/secret.yaml"
`);
      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('access_denied');
    });

    it('should not follow symlinks that point outside the root', () => {
      const outsidePath = writeTestFile('outside.yaml', 'password: hunter2');
      mkdirSync(join(caseDir, 'root'));
      symlinkSync(outsidePath, join(caseDir, 'root', 'link.yaml'));
      const filePath = writeTestFile('root/main.yaml', `
data:
  $ref: "./link.yaml"
`);
      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('access_denied');
    });

    it('should not allow absolute paths outside the root', () => {
      const outsidePath = writeTestFile('outside.yaml', 'password: hunter2');
      const filePath = writeTestFile('root/main.yaml', `
data:
  $ref: "${outsidePath}"
`);
      const error = catchError(() => loadYaml(filePath));
      expect(error.type).toBe('access_denied');
    });

    it('should allow directory traversal when enabled', () => {
      writeTestFile('outside.yaml', 'data: outside');
      const filePath = writeTestFile('root/traversal-allowed.yaml', `
data:
  $ref: "../outside.yaml"
`);
      const result = loadYaml(filePath, { allowExternalAccess: true });
      expect(result.data.data).toBe('outside');
    });
  });

  describe('debug mode', () => {
    it('should report every resolved reference and loaded file', () => {
      const nestedPath = writeTestFile('debug-nested.yaml', 'message: nested debug');
      const targetPath = writeTestFile('debug-target.yaml', `
data:
  $ref: "./debug-nested.yaml"
`);
      const filePath = writeTestFile('debug-complex.yaml', `
root:
  $ref: "./debug-target.yaml"
again:
  $ref: "./debug-target.yaml#/data"
`);

      const { result, debug } = loadYamlWithDebug(filePath);

      expect(result.root.data.message).toBe('nested debug');
      expect(debug.refChain).toEqual([
        targetPath + '#',
        nestedPath + '#',
        targetPath + '#/data',
        nestedPath + '#',
      ]);
      expect([...debug.fileCache.entries()]).toEqual([
        [filePath, 'object'],
        [targetPath, 'object'],
        [nestedPath, 'object'],
      ]);
      expect(debug.resolutionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('validation', () => {
    it('should validate correct YAML references', () => {
      writeTestFile('valid-ref.yaml', 'message: valid content');
      const filePath = writeTestFile('valid-main.yaml', `
data:
  $ref: "./valid-ref.yaml"
`);
      expect(validateYamlReferences(filePath)).toEqual({ isValid: true, errors: [], warnings: [] });
    });

    it('should detect invalid references', () => {
      const filePath = writeTestFile('invalid-main.yaml', `
data:
  $ref: "./missing.yaml"
`);
      const result = validateYamlReferences(filePath);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('file_not_found');
    });

    it('should report parse errors', () => {
      const filePath = writeTestFile('bad-parse.yaml', 'invalid: [unbalanced');
      const result = validateYamlReferences(filePath);
      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe('parse_error');
    });

    it('should warn about properties ignored next to $ref', () => {
      writeTestFile('target.yaml', 'value: 1');
      const filePath = writeTestFile('siblings.yaml', `
data:
  $ref: "./target.yaml"
  description: ignored
`);
      const result = validateYamlReferences(filePath);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('description');
    });

    it('should wrap unexpected errors from custom resolvers', () => {
      const filePath = writeTestFile('throwing-resolver.yaml', 'data:\n  $ref: "boom:now"');
      const customResolvers = new Map([['boom:', () => { throw new Error('kaboom'); }]]);

      const result = validateYamlReferences(filePath, { customResolvers });
      expect(result.isValid).toBe(false);
      expect(result.errors[0].type).toBe('parse_error');
      expect(result.errors[0].message).toBe('Unexpected error: kaboom');
    });
  });

  describe('builder pattern', () => {
    it('should create configured loader with builder', () => {
      const filePath = writeTestFile('builder-test.yaml', 'value: builder-test');

      const loader = new YamlLoaderBuilder()
        .withCache(50)
        .withStrictMode(true)
        .withExternalAccess(false)
        .build();

      expect(loader(filePath).value).toBe('builder-test');
    });

    it('should create generic builder with type inference', () => {
      interface BuilderTest {
        value: string;
        count: number;
      }

      const filePath = writeTestFile('builder-generic.yaml', 'value: generic-test\ncount: 42');
      const loader = new YamlLoaderBuilder().withCache(25).buildGeneric<BuilderTest>();
      const result = loader(filePath);

      const value: string = result.value;
      const count: number = result.count;
      expect(value).toBe('generic-test');
      expect(count).toBe(42);
    });

    it('should not let later builder calls change a loader already built', () => {
      const filePath = writeTestFile('builder-isolation.yaml', 'data:\n  $ref: "custom:value"');

      const builder = new YamlLoaderBuilder();
      const before = builder.build();
      const after = builder.withCustomResolver('custom:', () => 'resolved').build();

      expect(after(filePath)).toEqual({ data: 'resolved' });
      expect(() => before(filePath)).toThrow(YamlLoaderError);
    });
  });

  describe('custom resolvers', () => {
    it('should support custom resolvers', () => {
      const filePath = writeTestFile('test-custom.yaml', `
data:
  $ref: "custom:test-value"
`);
      const loader = new YamlLoaderBuilder()
        .withCustomResolver('custom:', (ref) => ({ custom: ref.replace('custom:', '') }))
        .build();

      expect(loader(filePath).data.custom).toBe('test-value');
    });

    it('should handle multiple custom resolver prefixes', () => {
      const filePath = writeTestFile('test-multi-custom.yaml', `
data1:
  $ref: "custom:test-value1"
data2:
  $ref: "special:test-value2"
`);
      const loader = new YamlLoaderBuilder()
        .withCustomResolver('custom:', (ref) => ({ custom: ref.replace('custom:', '') }))
        .withCustomResolver('special:', (ref) => ({ special: ref.replace('special:', '') }))
        .build();

      const result = loader(filePath);
      expect(result.data1.custom).toBe('test-value1');
      expect(result.data2.special).toBe('test-value2');
    });

    it('should take precedence over file references with the same prefix', () => {
      writeTestFile('remote/schema.yaml', 'from: file');
      const filePath = writeTestFile('precedence.yaml', 'data:\n  $ref: "./remote/schema.yaml"');
      const loader = new YamlLoaderBuilder()
        .withCustomResolver('./remote/', () => ({ from: 'resolver' }))
        .build();

      expect(loader(filePath)).toEqual({ data: { from: 'resolver' } });
    });

    it('should resolve references inside custom resolver results', () => {
      writeTestFile('resolver-target.yaml', 'value: from-file');
      const filePath = writeTestFile('resolver-nested.yaml', 'data:\n  $ref: "alias:target"');
      const loader = new YamlLoaderBuilder()
        .withCustomResolver('alias:', () => ({ nested: { $ref: './resolver-target.yaml' } }))
        .build();

      expect(loader(filePath)).toEqual({ data: { nested: { value: 'from-file' } } });
    });

    it('should detect cycles through custom resolvers', () => {
      const filePath = writeTestFile('resolver-cycle.yaml', 'data:\n  $ref: "loop:x"');
      const loader = new YamlLoaderBuilder()
        .withCustomResolver('loop:', () => ({ $ref: 'loop:x' }))
        .build();

      expect(() => loader(filePath)).toThrow(/Circular reference detected/);
    });
  });

  describe('backward compatibility', () => {
    it('should accept the deprecated strictMode option', () => {
      const filePath = writeTestFile('config-test.yaml', 'value: config-test');
      const options: YamlLoaderOptions = { maxCacheSize: 75, strictMode: true };
      expect(loadYaml(filePath, options).value).toBe('config-test');
    });

    it('should work with default export', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const yamlLoader = require('./index').default;
      const filePath = writeTestFile('default-export.yaml', 'name: default-export-test');
      expect(yamlLoader(filePath).name).toBe('default-export-test');
    });
  });
});
