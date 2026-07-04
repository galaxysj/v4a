#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Command, type Command as CommandType } from 'commander';

import { applyPatch, parseAllowedTypes } from './applier.js';
import { PatchError } from './errors.js';
import { parsePatch } from './parser.js';
import { reverse, validate } from './transform.js';

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

async function resolvePatchText(file: string | undefined): Promise<string> {
  if (file) {
    return readFile(file, 'utf-8');
  }

  if (!process.stdin.isTTY) {
    return readStdin();
  }

  throw new PatchError(
    'No patch input provided. Pass a file argument or pipe patch text to stdin.',
  );
}

function resolveSafePath(cwd: string, filePath: string): string {
  const resolved = path.resolve(cwd, filePath);
  const relative = path.relative(cwd, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PatchError(`Path escapes working directory: ${filePath}`);
  }

  return resolved;
}

async function loadDeletedFileContents(
  patchText: string,
  cwd: string,
): Promise<Record<string, string>> {
  const parsed = parsePatch(patchText);
  const contents: Record<string, string> = {};

  for (const operation of parsed.operations) {
    if (operation.type !== 'delete') {
      continue;
    }

    const target = resolveSafePath(cwd, operation.path);

    try {
      contents[operation.path] = await readFile(target, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new PatchError(
          `Cannot reverse "Delete File: ${operation.path}" without its original content. ` +
            `File not found under ${cwd}.`,
        );
      }

      throw error;
    }
  }

  return contents;
}

function addPatchInput(command: CommandType): CommandType {
  return command.argument('[file]', 'patch file to read');
}

function addAllowedTypesOption(command: CommandType): CommandType {
  return command.option(
    '--allowed-types <types>',
    'comma-separated allowed operation types: add, update, delete, or all',
    (value: string, previous: string[]) => previous.concat([value]),
    [] as string[],
  );
}

function addCwdOption(command: CommandType): CommandType {
  return command.option(
    '--cwd <dir>',
    'working directory (default: current working directory)',
  );
}

function formatOperation(
  operation: Awaited<ReturnType<typeof applyPatch>>['operations'][number],
): string {
  if (operation.type === 'update' && operation.moveTo) {
    return `update ${operation.path} -> ${operation.moveTo}`;
  }

  return `${operation.type} ${operation.path}`;
}

function reportCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('v4a')
    .description('OpenAI V4A (apply_patch) format tools')
    .version('0.1.0');

  addAllowedTypesOption(
    addCwdOption(
      addPatchInput(
        program
          .command('patch')
          .description('Apply a V4A patch')
          .option('--dry-run', 'show planned operations without writing files', false),
      ),
    ),
  ).action(async (file: string | undefined, options) => {
    try {
      const patchText = await resolvePatchText(file);
      const allowedTypes = parseAllowedTypes(options.allowedTypes);
      const result = await applyPatch(patchText, {
        allowedTypes,
        cwd: options.cwd ?? process.cwd(),
        dryRun: options.dryRun,
      });

      const prefix = result.dryRun ? '[dry-run] ' : '';

      for (const operation of result.operations) {
        console.log(`${prefix}${formatOperation(operation)}`);
      }
    } catch (error) {
      reportCliError(error);
    }
  });

  addAllowedTypesOption(
    addPatchInput(program.command('validate').description('Validate a V4A patch')),
  ).action(async (file: string | undefined, options) => {
    try {
      const patchText = await resolvePatchText(file);
      const allowedTypes = parseAllowedTypes(options.allowedTypes);
      const result = validate(patchText, { allowedTypes });

      if (!result.valid) {
        console.error(`Error: ${result.error}`);
        process.exitCode = 1;
        return;
      }
    } catch (error) {
      reportCliError(error);
    }
  });

  addCwdOption(
    addPatchInput(program.command('reverse').description('Produce a patch that undoes the given patch')),
  ).action(async (file: string | undefined, options) => {
    try {
      const patchText = await resolvePatchText(file);
      const cwd = options.cwd ?? process.cwd();
      const deletedFileContents = await loadDeletedFileContents(patchText, cwd);
      const reversed = reverse(patchText, { deletedFileContents });

      process.stdout.write(reversed.endsWith('\n') ? reversed : `${reversed}\n`);
    } catch (error) {
      reportCliError(error);
    }
  });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  reportCliError(error);
  process.exit(1);
});
