import { PatchError } from './errors.js';
import { parsePatch } from './parser.js';
import { serializePatch } from './serializer.js';
import { ALL_PATCH_TYPES, type FileOp, type PatchType } from './types.js';

export type ReverseOptions = {
  /**
   * Original content of files removed by `*** Delete File:` operations,
   * keyed by patch path. Required to reverse a delete into an add, since
   * the patch text itself does not retain the deleted file's content.
   */
  deletedFileContents?: Record<string, string>;
};

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string };

function reverseHunkLine(line: string): string {
  if (line.startsWith('@@') || line.startsWith('*** End of File')) {
    return line;
  }

  if (line.startsWith('+')) {
    return `-${line.slice(1)}`;
  }

  if (line.startsWith('-')) {
    return `+${line.slice(1)}`;
  }

  return line;
}

function reverseDiff(diff: string): string {
  if (diff.length === 0) {
    return diff;
  }

  return diff.split('\n').map(reverseHunkLine).join('\n');
}

function reverseOp(op: FileOp, deletedFileContents: Record<string, string>): FileOp {
  if (op.type === 'add') {
    return { type: 'delete', path: op.path };
  }

  if (op.type === 'delete') {
    const content = deletedFileContents[op.path];

    if (content === undefined) {
      throw new PatchError(
        `Cannot reverse "Delete File: ${op.path}" without its original content. ` +
          'Pass it via options.deletedFileContents.',
      );
    }

    return { type: 'add', path: op.path, lines: content.split(/\r?\n/) };
  }

  return {
    type: 'update',
    path: op.moveTo ?? op.path,
    moveTo: op.moveTo ? op.path : undefined,
    diff: reverseDiff(op.diff),
  };
}

/**
 * Produces a V4A patch that undoes the effect of the given patch.
 *
 * - `Add File` becomes `Delete File`.
 * - `Delete File` becomes `Add File`, using content supplied via
 *   `options.deletedFileContents` (the patch text alone cannot recover
 *   deleted content).
 * - `Update File` hunks have their `+`/`-` lines swapped, and a `Move to`
 *   is reversed back to the original path.
 *
 * The resulting operations are emitted in reverse order so that dependent
 * changes (e.g. a rename followed by further edits) undo cleanly.
 */
export function reverse(patchText: string, options: ReverseOptions = {}): string {
  const parsed = parsePatch(patchText);
  const deletedFileContents = options.deletedFileContents ?? {};
  const reversedOps = parsed.operations
    .map((op) => reverseOp(op, deletedFileContents))
    .reverse();

  return serializePatch({ operations: reversedOps });
}

/**
 * Merges multiple V4A patches into a single patch envelope, preserving the
 * order of operations across patches. Accepts either variadic arguments or
 * a single array of patch strings.
 */
export function merge(...patches: string[] | [string[]]): string {
  const patchList: string[] = Array.isArray(patches[0])
    ? (patches[0] as string[])
    : (patches as string[]);

  if (patchList.length === 0) {
    throw new PatchError('merge() requires at least one patch');
  }

  const operations = patchList.flatMap((patchText) => parsePatch(patchText).operations);
  return serializePatch({ operations });
}

export type ValidateOptions = {
  allowedTypes?: PatchType[];
};

/**
 * Validates a V4A patch's format (and optionally its operation types)
 * without touching the file system. Never throws; errors are reported in
 * the returned result.
 */
export function validate(
  patchText: string,
  options: ValidateOptions = {},
): ValidationResult {
  try {
    const parsed = parsePatch(patchText);
    const allowedTypes = options.allowedTypes ?? [...ALL_PATCH_TYPES];
    const allowed = new Set(allowedTypes);

    for (const operation of parsed.operations) {
      if (!allowed.has(operation.type)) {
        return {
          valid: false,
          error: `Operation type '${operation.type}' is not allowed. Allowed types: ${[...allowed].join(', ')}`,
        };
      }
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
