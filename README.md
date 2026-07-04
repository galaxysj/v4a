# v4a

CLI and library for applying OpenAI V4A (`apply_patch`) format patches to the file system.

## Installation

```bash
npm install v4a
```

Or run without installing:

```bash
npx v4a patch <file>
```

## CLI Usage

### Apply a patch file

```bash
npx v4a patch change.patch
```

### Pipe from stdin

Write the patch to a file and apply it, or pipe it via stdin:

```bash
npx v4a patch change.patch
cat change.patch | npx v4a patch
```

### Restrict allowed types (`allowed_types`)

By default, `add`, `update`, and `delete` are all allowed.

```bash
npx v4a patch change.patch --allowed-types add,update
npx v4a patch change.patch --allowed-types add --allowed-types update
npx v4a patch change.patch --allowed-types all
```

If the patch contains a disallowed operation type, the entire patch fails with no partial application.

### Other options

```bash
npx v4a patch change.patch --cwd ./project
npx v4a patch change.patch --dry-run
```

### Validate a patch (`validate`)

Checks patch format and `allowedTypes` without touching the file system. Exits with code 0 on success, or 1 with an error message on stderr.

```bash
npx v4a validate change.patch
cat change.patch | npx v4a validate
npx v4a validate change.patch --allowed-types add,update
```

### Reverse a patch (`reverse`)

Prints an undo patch to stdout. To reverse a `Delete File` operation, the original file must exist under `--cwd`.

```bash
npx v4a reverse change.patch
npx v4a reverse change.patch --cwd ./project
cat change.patch | npx v4a reverse > undo.patch
```

## Using as a module

`v4a` can be imported as a library, not just used from the CLI.

### Apply a patch to the file system (`applyPatch`)

```ts
import { applyPatch } from 'v4a';

const result = await applyPatch(patchText, {
  allowedTypes: ['add', 'update'], // omit to allow all types
  cwd: process.cwd(),
  dryRun: false,
});

console.log(result.operations);
// [{ type: 'update', path: 'src/app.ts' }, { type: 'add', path: 'src/new.ts' }, ...]
```

If the patch contains any operation not in `allowedTypes`, an `AllowedTypeError` is thrown and no files are changed (all-or-nothing).

### Parse patch text only (`parsePatch`)

Use when you want the patch structure (AST) without applying it to the file system.

```ts
import { parsePatch } from 'v4a';

const { operations } = parsePatch(patchText);

for (const op of operations) {
  if (op.type === 'add') {
    console.log('add', op.path, op.lines);
  } else if (op.type === 'update') {
    console.log('update', op.path, op.moveTo, op.diff);
  } else if (op.type === 'delete') {
    console.log('delete', op.path);
  }
}
```

### Apply hunks directly (`applyDiff`)

Use when you want to apply V4A hunks to an in-memory string without file I/O.

```ts
import { applyDiff } from 'v4a';

const updated = applyDiff(
  'const x = 1;\nconsole.log(x);\n',
  '@@\n const x = 1;\n-console.log(x);\n+console.log(x + 1);\n',
);
```

### Validate a patch (`validate`)

Checks patch format and `allowedTypes` violations without touching the file system. Returns a result instead of throwing.

```ts
import { validate } from 'v4a';

const result = validate(patchText, { allowedTypes: ['add', 'update'] });

if (!result.valid) {
  console.error(result.error);
}
```

### Merge multiple patches (`merge`)

Combines multiple V4A patches into a single `*** Begin Patch` / `*** End Patch` envelope. Supports variadic arguments and an array argument.

```ts
import { merge } from 'v4a';

const combined = merge(patchA, patchB, patchC);
// or
const combined2 = merge([patchA, patchB, patchC]);

await applyPatch(combined);
```

### Reverse a patch (`reverse`)

Produces an undo patch for a given patch.

- `Add File` → `Delete File`
- `Delete File` → `Add File` (original content is not in the patch text, so provide it via `deletedFileContents`)
- `Update File` → swap `+`/`-` lines in hunks, and flip `Move to` paths

```ts
import { applyPatch, reverse } from 'v4a';

await applyPatch(patchText, { cwd });

const undoPatch = reverse(patchText, {
  deletedFileContents: { 'removed.ts': originalRemovedContent },
});
await applyPatch(undoPatch, { cwd });
```

### Error types

```ts
import {
  applyPatch,
  PatchError,
  ParseError,
  InvalidContextError,
  AllowedTypeError,
} from 'v4a';

try {
  await applyPatch(patchText, { allowedTypes: ['add'] });
} catch (error) {
  if (error instanceof AllowedTypeError) {
    console.error('Disallowed operation:', error.disallowedType);
  } else if (error instanceof InvalidContextError) {
    console.error('Context does not match file content:', error.message);
  } else if (error instanceof ParseError) {
    console.error('Patch format error:', error.message);
  } else if (error instanceof PatchError) {
    console.error('Patch application failed:', error.message);
  }
}
```

## V4A format

### Basic example

```diff
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.ts
@@ function main()
 function main() {
-print("hi")
+print("hello")
 }
*** Delete File: obsolete.txt
*** End Patch
```

### Supported operations

| Type | Header | Description |
| --- | --- | --- |
| `add` | `*** Add File: <path>` | Create a new file (`+` lines are the content) |
| `update` | `*** Update File: <path>` | Modify an existing file (`@@` hunks) |
| `delete` | `*** Delete File: <path>` | Delete a file |
| move | `*** Update File: <path>` followed by `*** Move to: <path>` | Move/rename a file while editing its content |

### Multiple operations / files in one patch

```diff
*** Begin Patch

*** Update File: a.ts
@@
-old
+new

*** Add File: b.ts
+created

*** Delete File: c.ts

*** End Patch
```

### Multiple hunks in one file

Each hunk starts with `@@`. Blank lines between hunks are optional.

```diff
*** Update File: old.ts
*** Move to: new.ts

@@
-old1
+new1

@@
-old2
+new2
```

Context text after `@@` (functions, classes, conditionals, etc.) anchors the hunk to that location in the file.

```diff
@@ function hello()
 ...
@@ class User
 ...
@@ if (x > 0)
 ...
```

### Editing the end of a file (`*** End of File`)

When a hunk extends to the last line of a file, you can mark it with `*** End of File`.

```diff
*** Update File: tail.ts
@@
 keep
-last
+lastNew
*** End of File
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
