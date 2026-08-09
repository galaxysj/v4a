# v4a

A small CLI and TypeScript library for working with OpenAI V4A (`apply_patch`) patches.

Parse, validate, apply, reverse, and combine patches without depending on Git or a repository abstraction.

```text
*** Begin Patch
*** Update File: src/index.ts
@@
-console.log("old");
+console.log("new");
*** End Patch
```

## Install

```bash
npm install v4a-patch
```

or:

```bash
npm install @galaxysj/v4a
```

For global CLI use:

```bash
npm install -g v4a-patch
```

Both packages expose the same CLI:

```bash
v4a
```

Requires Node.js 18 or newer.

## Quick start

Apply a patch:

```bash
v4a apply change.patch
```

Or pipe one directly:

```bash
cat change.patch | v4a apply
```

Check a patch without modifying anything:

```bash
v4a apply change.patch --dry-run
```

Validate its format:

```bash
v4a validate change.patch
```

Generate an undo patch:

```bash
v4a reverse change.patch > undo.patch
```

## CLI

### `v4a apply`

Apply a V4A patch to the filesystem.

```bash
v4a apply change.patch
```

Patch input can come from a file or stdin:

```bash
cat change.patch | v4a apply
```

Applied operations are printed to stdout:

```text
update src/index.ts
add src/config.ts
delete src/legacy.ts
```

Moves are shown explicitly:

```text
update src/old.ts -> src/new.ts
```

### Dry run

Use `--dry-run` to parse and resolve the patch without writing files:

```bash
v4a apply change.patch --dry-run
```

```text
[dry-run] update src/index.ts
[dry-run] add src/config.ts
```

### Working directory

Patch paths are resolved relative to the current directory by default.

```bash
v4a apply change.patch --cwd ./project
```

Paths that escape the selected working directory are rejected.

For example, a patch cannot use a path such as:

```text
../../somewhere/file.txt
```

to modify files outside the target tree.

### Restrict operations

Supported operations are:

```text
add
update
delete
```

Allow only updates:

```bash
v4a apply change.patch --allowed-types update
```

Allow additions and updates:

```bash
v4a apply change.patch --allowed-types add,update
```

The option may also be repeated:

```bash
v4a apply change.patch \
  --allowed-types add \
  --allowed-types update
```

Use `all` to explicitly allow every operation:

```bash
v4a apply change.patch --allowed-types all
```

This can be useful when patches come from another process and only a subset of filesystem operations should be accepted.

## Validate

Validate a patch without touching the filesystem:

```bash
v4a validate change.patch
```

stdin is supported:

```bash
cat change.patch | v4a validate
```

Operation restrictions work here too:

```bash
v4a validate change.patch --allowed-types update
```

A valid patch exits successfully without output.

An invalid patch prints an error and exits with a non-zero status, which makes validation straightforward to use in scripts:

```bash
if v4a validate generated.patch; then
  v4a apply generated.patch
fi
```

## Reverse

Create a patch that undoes another patch:

```bash
v4a reverse change.patch
```

The result is written to stdout:

```bash
v4a reverse change.patch > undo.patch
```

It can also be applied immediately:

```bash
v4a reverse change.patch | v4a apply
```

For update hunks, added and removed lines are swapped.

For moves, the source and destination are reversed.

For example:

```text
*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@
-export const name = "old";
+export const name = "new";
*** End Patch
```

produces an undo operation that updates `src/new.ts` and moves it back to `src/old.ts`.

### Deleted files

A `Delete File` operation does not contain the original file contents.

When using the CLI, `v4a reverse` reads those files from the working tree before generating the reverse patch:

```bash
v4a reverse change.patch --cwd ./project
```

If a deleted file no longer exists, its contents cannot be reconstructed from the patch alone.

## Patch format

V4A patches are enclosed in:

```text
*** Begin Patch
...
*** End Patch
```

### Add file

```text
*** Begin Patch
*** Add File: hello.txt
+Hello
+World
*** End Patch
```

### Delete file

```text
*** Begin Patch
*** Delete File: old.txt
*** End Patch
```

### Update file

```text
*** Begin Patch
*** Update File: hello.txt
@@
-Hello
+Hello, world!
*** End Patch
```

### Move and update

```text
*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@
-export const name = "old";
+export const name = "new";
*** End Patch
```

A single patch may contain multiple file operations.

## API

The package also exposes the parser and patch operations as a TypeScript/JavaScript API.

```ts
import {
  applyPatch,
  merge,
  parsePatch,
  reverse,
  serializePatch,
  validate,
} from 'v4a-patch';
```

The same exports are available from:

```ts
import {
  applyPatch,
  parsePatch,
} from '@galaxysj/v4a';
```

### Apply a patch

```ts
import { applyPatch } from 'v4a-patch';

const patch = `
*** Begin Patch
*** Update File: src/index.ts
@@
-console.log("old");
+console.log("new");
*** End Patch
`;

const result = await applyPatch(patch, {
  cwd: process.cwd(),
});

console.log(result.operations);
```

Result:

```ts
{
  operations: [
    {
      type: 'update',
      path: 'src/index.ts'
    }
  ],
  dryRun: false
}
```

### Dry run

```ts
await applyPatch(patch, {
  dryRun: true,
});
```

### Restrict operation types

```ts
await applyPatch(patch, {
  allowedTypes: ['update'],
});
```

A patch containing `add` or `delete` will be rejected.

### Parse

```ts
import { parsePatch } from 'v4a-patch';

const parsed = parsePatch(patch);

console.log(parsed.operations);
```

Example:

```ts
[
  {
    type: 'update',
    path: 'src/index.ts',
    moveTo: undefined,
    diff: '@@\n-console.log("old");\n+console.log("new");'
  }
]
```

### Validate

```ts
import { validate } from 'v4a-patch';

const result = validate(patch);

if (!result.valid) {
  console.error(result.error);
}
```

The function reports validation failures as values rather than throwing:

```ts
{ valid: true }
```

or:

```ts
{
  valid: false,
  error: '...'
}
```

You can restrict operation types during validation:

```ts
validate(patch, {
  allowedTypes: ['update'],
});
```

### Reverse

```ts
import { reverse } from 'v4a-patch';

const undo = reverse(patch);
```

Reversing a `Delete File` requires its original contents:

```ts
const undo = reverse(patch, {
  deletedFileContents: {
    'src/old.ts': 'export const value = 1;\n',
  },
});
```

### Merge

Combine multiple patches into one V4A envelope:

```ts
import { merge } from 'v4a-patch';

const combined = merge(patchA, patchB, patchC);
```

Arrays are accepted as well:

```ts
const combined = merge([
  patchA,
  patchB,
  patchC,
]);
```

Operations retain their original order.

### Serialize

Create patch text from structured operations:

```ts
import { serializePatch } from 'v4a-patch';

const patch = serializePatch({
  operations: [
    {
      type: 'add',
      path: 'hello.txt',
      lines: ['Hello', 'World'],
    },
  ],
});
```

## Exports

### Functions

```text
applyDiff
applyPatch
parseAllowedTypes
parsePatch
normalizePatchLines
serializePatch
merge
reverse
validate
```

### Types

```text
AddFileOp
AppliedOperation
ApplyPatchOptions
ApplyPatchResult
DeleteFileOp
FileOp
ParsedPatch
PatchType
ReverseOptions
UpdateFileOp
ValidateOptions
ValidationResult
```

### Errors

```text
PatchError
ParseError
InvalidContextError
AllowedTypeError
```

## Behavior

`v4a` deliberately performs a few checks before touching files:

* patch paths cannot escape the configured working directory
* `Add File` refuses to overwrite an existing file
* `Update File` requires the source file to exist
* `Delete File` requires the target file to exist
* operation types can be restricted before execution
* `--dry-run` performs no filesystem writes

It is intended to be a small patch-format tool, not a source-control system.

## Development

```bash
git clone https://github.com/galaxysj/v4a.git
cd v4a

npm install
npm test
npm run build
```

The project is written in TypeScript and compiled to `dist/`.

## License

See [`LICENSE`](./LICENSE).
