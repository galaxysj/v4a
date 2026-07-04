import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { applyDiff } from './apply-diff.js';
import { AllowedTypeError, PatchError } from './errors.js';
import { parsePatch } from './parser.js';
import {
  ALL_PATCH_TYPES,
  type AppliedOperation,
  type ApplyPatchOptions,
  type ApplyPatchResult,
  type FileOp,
  type PatchType,
} from './types.js';

function resolveSafePath(cwd: string, filePath: string): string {
  const resolved = path.resolve(cwd, filePath);
  const relative = path.relative(cwd, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PatchError(`Path escapes working directory: ${filePath}`);
  }

  return resolved;
}

function validateAllowedTypes(
  operations: FileOp[],
  allowedTypes: PatchType[],
): void {
  const allowed = new Set(allowedTypes);

  for (const operation of operations) {
    if (!allowed.has(operation.type)) {
      throw new AllowedTypeError(operation.type, [...allowed]);
    }
  }
}

async function ensureParentDir(filePath: string, dryRun: boolean): Promise<void> {
  const parent = path.dirname(filePath);

  if (!dryRun) {
    await mkdir(parent, { recursive: true });
  }
}

async function applyAdd(
  operation: Extract<FileOp, { type: 'add' }>,
  cwd: string,
  dryRun: boolean,
): Promise<AppliedOperation> {
  const target = resolveSafePath(cwd, operation.path);
  const content = operation.lines.join('\n');

  if (!dryRun) {
    await ensureParentDir(target, dryRun);

    try {
      await readFile(target, 'utf-8');
      throw new PatchError(`File already exists: ${operation.path}`);
    } catch (error) {
      if (
        error instanceof PatchError ||
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    await writeFile(target, content, 'utf-8');
  }

  return { type: 'add', path: operation.path };
}

async function applyDelete(
  operation: Extract<FileOp, { type: 'delete' }>,
  cwd: string,
  dryRun: boolean,
): Promise<AppliedOperation> {
  const target = resolveSafePath(cwd, operation.path);

  if (!dryRun) {
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PatchError(`File not found: ${operation.path}`);
      }

      throw error;
    }
  }

  return { type: 'delete', path: operation.path };
}

async function applyUpdate(
  operation: Extract<FileOp, { type: 'update' }>,
  cwd: string,
  dryRun: boolean,
): Promise<AppliedOperation> {
  const source = resolveSafePath(cwd, operation.path);
  let original: string;

  try {
    original = await readFile(source, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PatchError(`File not found: ${operation.path}`);
    }

    throw error;
  }

  const updated = applyDiff(original, operation.diff, 'default');
  const destination = operation.moveTo
    ? resolveSafePath(cwd, operation.moveTo)
    : source;

  if (!dryRun) {
    await ensureParentDir(destination, dryRun);
    await writeFile(destination, updated, 'utf-8');

    if (operation.moveTo && destination !== source) {
      await unlink(source);
    }
  }

  return {
    type: 'update',
    path: operation.path,
    moveTo: operation.moveTo,
  };
}

export async function applyPatch(
  patchText: string,
  options: ApplyPatchOptions = {},
): Promise<ApplyPatchResult> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const allowedTypes = options.allowedTypes ?? [...ALL_PATCH_TYPES];

  const parsed = parsePatch(patchText);
  validateAllowedTypes(parsed.operations, allowedTypes);

  const applied: AppliedOperation[] = [];

  for (const operation of parsed.operations) {
    switch (operation.type) {
      case 'add':
        applied.push(await applyAdd(operation, cwd, dryRun));
        break;
      case 'delete':
        applied.push(await applyDelete(operation, cwd, dryRun));
        break;
      case 'update':
        applied.push(await applyUpdate(operation, cwd, dryRun));
        break;
      default: {
        const exhaustive: never = operation;
        throw new PatchError(`Unsupported operation: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return { operations: applied, dryRun };
}

export function parseAllowedTypes(input: string[]): PatchType[] {
  const values = input
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (values.length === 0) {
    return [...ALL_PATCH_TYPES];
  }

  const allowed = new Set<PatchType>();

  for (const value of values) {
    if (value === 'all') {
      return [...ALL_PATCH_TYPES];
    }

    if (value !== 'add' && value !== 'update' && value !== 'delete') {
      throw new PatchError(
        `Invalid allowed type '${value}'. Expected add, update, delete, or all.`,
      );
    }

    allowed.add(value);
  }

  return [...allowed];
}
