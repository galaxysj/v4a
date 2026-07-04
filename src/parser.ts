import { ParseError } from './errors.js';
import type { FileOp, ParsedPatch } from './types.js';

const BEGIN_PATCH = '*** Begin Patch';
const END_PATCH = '*** End Patch';
const ADD_FILE = '*** Add File: ';
const DELETE_FILE = '*** Delete File: ';
const UPDATE_FILE = '*** Update File: ';
const MOVE_TO = '*** Move to: ';

export function normalizePatchLines(patchText: string): string[] {
  return patchText
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ''))
    .filter((line, index, arr) => !(index === arr.length - 1 && line === ''));
}

export function parsePatch(patchText: string): ParsedPatch {
  const lines = normalizePatchLines(patchText);

  if (lines.length === 0) {
    throw new ParseError('Patch is empty');
  }

  if (lines[0] !== BEGIN_PATCH) {
    throw new ParseError(`Patch must start with "${BEGIN_PATCH}"`, 1);
  }

  const endIndex = lines.lastIndexOf(END_PATCH);
  if (endIndex === -1) {
    throw new ParseError(`Missing "${END_PATCH}"`);
  }

  if (endIndex === 0) {
    throw new ParseError(`Missing file operations between patch markers`);
  }

  const operations: FileOp[] = [];
  let index = 1;

  while (index < endIndex) {
    const line = lines[index];

    if (line === '') {
      index += 1;
      continue;
    }

    if (line.startsWith(ADD_FILE)) {
      const path = line.slice(ADD_FILE.length);
      if (!path) {
        throw new ParseError('Add File operation requires a path', index + 1);
      }

      index += 1;
      const addedLines: string[] = [];

      while (index < endIndex && !isFileOpHeader(lines[index])) {
        const addLine = lines[index];

        if (addLine === '') {
          index += 1;
          continue;
        }

        if (!addLine.startsWith('+')) {
          throw new ParseError(
            `Expected "+" line in Add File section, got: ${addLine}`,
            index + 1,
          );
        }
        addedLines.push(addLine.slice(1));
        index += 1;
      }

      operations.push({ type: 'add', path, lines: addedLines });
      continue;
    }

    if (line.startsWith(DELETE_FILE)) {
      const path = line.slice(DELETE_FILE.length);
      if (!path) {
        throw new ParseError('Delete File operation requires a path', index + 1);
      }

      operations.push({ type: 'delete', path });
      index += 1;
      continue;
    }

    if (line.startsWith(UPDATE_FILE)) {
      const path = line.slice(UPDATE_FILE.length);
      if (!path) {
        throw new ParseError('Update File operation requires a path', index + 1);
      }

      index += 1;
      let moveTo: string | undefined;

      if (index < endIndex && lines[index].startsWith(MOVE_TO)) {
        moveTo = lines[index].slice(MOVE_TO.length);
        if (!moveTo) {
          throw new ParseError('Move to operation requires a destination path', index + 1);
        }
        index += 1;
      }

      const diffLines: string[] = [];
      while (index < endIndex && !isFileOpHeader(lines[index])) {
        const diffLine = lines[index];

        // A blank line that merely separates hunks/sections (i.e. immediately
        // followed by another hunk header, a file-op header, or the end of
        // the patch) is not part of the hunk content and can be dropped.
        const next = lines[index + 1];
        const isSeparatorBlank =
          diffLine === '' &&
          (index + 1 >= endIndex || next === '@@' || next.startsWith('@@ ') || isFileOpHeader(next));

        if (isSeparatorBlank) {
          index += 1;
          continue;
        }

        diffLines.push(diffLine);
        index += 1;
      }

      operations.push({
        type: 'update',
        path,
        moveTo,
        diff: diffLines.join('\n'),
      });
      continue;
    }

    throw new ParseError(`Unexpected line in patch: ${line}`, index + 1);
  }

  if (operations.length === 0) {
    throw new ParseError('Patch contains no file operations');
  }

  return { operations };
}

function isFileOpHeader(line: string): boolean {
  return (
    line.startsWith(ADD_FILE) ||
    line.startsWith(DELETE_FILE) ||
    line.startsWith(UPDATE_FILE)
  );
}
