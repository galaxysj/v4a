import { InvalidContextError } from './errors.js';

type Chunk = { origIndex: number; delLines: string[]; insLines: string[] };
type ParserState = { lines: string[]; index: number; fuzz: number };

const END_PATCH = '*** End Patch';
const END_FILE = '*** End of File';
const END_SECTION_MARKERS = [
  END_PATCH,
  '*** Update File:',
  '*** Delete File:',
  '*** Add File:',
  END_FILE,
];
const SECTION_TERMINATORS = [
  END_PATCH,
  '*** Update File:',
  '*** Delete File:',
  '*** Add File:',
];

function normalizeDiffLines(diff: string): string[] {
  return diff
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ''))
    .filter((line, index, arr) => !(index === arr.length - 1 && line === ''));
}

function isDone(state: ParserState, prefixes: string[]): boolean {
  if (state.index >= state.lines.length) {
    return true;
  }

  return prefixes.some((prefix) => state.lines[state.index]?.startsWith(prefix));
}

function readStr(state: ParserState, prefix: string): string {
  const current = state.lines[state.index];
  if (typeof current === 'string' && current.startsWith(prefix)) {
    state.index += 1;
    return current.slice(prefix.length);
  }

  return '';
}

function parseCreateDiff(lines: string[]): string {
  const parser: ParserState = {
    lines: [...lines, END_PATCH],
    index: 0,
    fuzz: 0,
  };
  const output: string[] = [];

  while (!isDone(parser, SECTION_TERMINATORS)) {
    const line = parser.lines[parser.index];
    parser.index += 1;

    if (!line.startsWith('+')) {
      throw new InvalidContextError(`Invalid Add File line: ${line}`);
    }

    output.push(line.slice(1));
  }

  return output.join('\n');
}

function advanceCursorToAnchor(
  anchor: string,
  inputLines: string[],
  cursor: number,
  parser: ParserState,
): number {
  let found = false;

  if (!inputLines.slice(0, cursor).some((line) => line === anchor)) {
    for (let i = cursor; i < inputLines.length; i += 1) {
      if (inputLines[i] === anchor) {
        cursor = i + 1;
        found = true;
        break;
      }
    }
  }

  if (
    !found &&
    !inputLines.slice(0, cursor).some((line) => line.trim() === anchor.trim())
  ) {
    for (let i = cursor; i < inputLines.length; i += 1) {
      if (inputLines[i].trim() === anchor.trim()) {
        cursor = i + 1;
        parser.fuzz += 1;
        found = true;
        break;
      }
    }
  }

  return cursor;
}

function readSection(
  lines: string[],
  startIndex: number,
): {
  nextContext: string[];
  sectionChunks: Chunk[];
  endIndex: number;
  eof: boolean;
} {
  const context: string[] = [];
  let delLines: string[] = [];
  let insLines: string[] = [];
  const sectionChunks: Chunk[] = [];
  let mode: 'keep' | 'add' | 'delete' = 'keep';
  let index = startIndex;
  const origIndex = index;

  while (index < lines.length) {
    const raw = lines[index];

    if (
      raw.startsWith('@@') ||
      raw.startsWith(END_PATCH) ||
      raw.startsWith('*** Update File:') ||
      raw.startsWith('*** Delete File:') ||
      raw.startsWith('*** Add File:') ||
      raw.startsWith(END_FILE)
    ) {
      break;
    }

    if (raw === '***') {
      break;
    }

    if (raw.startsWith('***')) {
      throw new InvalidContextError(`Invalid line in update hunk: ${raw}`);
    }

    index += 1;
    const lastMode = mode;
    let line = raw;

    if (line === '') {
      line = ' ';
    }

    if (line[0] === '+') {
      mode = 'add';
    } else if (line[0] === '-') {
      mode = 'delete';
    } else if (line[0] === ' ') {
      mode = 'keep';
    } else {
      throw new InvalidContextError(`Invalid line in update hunk: ${line}`);
    }

    line = line.slice(1);
    const switchingToContext = mode === 'keep' && lastMode !== mode;

    if (switchingToContext && (insLines.length || delLines.length)) {
      sectionChunks.push({
        origIndex: context.length - delLines.length,
        delLines,
        insLines,
      });
      delLines = [];
      insLines = [];
    }

    if (mode === 'delete') {
      delLines.push(line);
      context.push(line);
    } else if (mode === 'add') {
      insLines.push(line);
    } else {
      context.push(line);
    }
  }

  if (insLines.length || delLines.length) {
    sectionChunks.push({
      origIndex: context.length - delLines.length,
      delLines,
      insLines,
    });
  }

  if (index < lines.length && lines[index] === END_FILE) {
    index += 1;
    return { nextContext: context, sectionChunks, endIndex: index, eof: true };
  }

  if (index === origIndex) {
    throw new InvalidContextError(
      `Nothing in update hunk section at line ${index + 1}`,
    );
  }

  return { nextContext: context, sectionChunks, endIndex: index, eof: false };
}

function equalsSlice(
  source: string[],
  target: string[],
  start: number,
  mapFn: (value: string) => string,
): boolean {
  if (start + target.length > source.length) {
    return false;
  }

  for (let i = 0; i < target.length; i += 1) {
    if (mapFn(source[start + i]) !== mapFn(target[i])) {
      return false;
    }
  }

  return true;
}

function findContextCore(
  lines: string[],
  context: string[],
  start: number,
): { newIndex: number; fuzz: number } {
  if (!context.length) {
    return { newIndex: start, fuzz: 0 };
  }

  for (let i = start; i < lines.length; i += 1) {
    if (equalsSlice(lines, context, i, (value) => value)) {
      return { newIndex: i, fuzz: 0 };
    }
  }

  for (let i = start; i < lines.length; i += 1) {
    if (equalsSlice(lines, context, i, (value) => value.trimEnd())) {
      return { newIndex: i, fuzz: 1 };
    }
  }

  for (let i = start; i < lines.length; i += 1) {
    if (equalsSlice(lines, context, i, (value) => value.trim())) {
      return { newIndex: i, fuzz: 100 };
    }
  }

  return { newIndex: -1, fuzz: 0 };
}

function findContext(
  lines: string[],
  context: string[],
  start: number,
  eof: boolean,
): { newIndex: number; fuzz: number } {
  if (eof) {
    const endStart = Math.max(0, lines.length - context.length);
    const endMatch = findContextCore(lines, context, endStart);

    if (endMatch.newIndex !== -1) {
      return endMatch;
    }

    const fallback = findContextCore(lines, context, start);
    return { newIndex: fallback.newIndex, fuzz: fallback.fuzz + 10000 };
  }

  return findContextCore(lines, context, start);
}

function parseUpdateDiff(
  lines: string[],
  input: string,
): { chunks: Chunk[]; fuzz: number } {
  const parser: ParserState = {
    lines: [...lines, END_PATCH],
    index: 0,
    fuzz: 0,
  };
  const inputLines = input.split('\n');
  const chunks: Chunk[] = [];
  let cursor = 0;

  while (!isDone(parser, END_SECTION_MARKERS)) {
    const anchor = readStr(parser, '@@ ');
    const hasBareAnchor = !anchor && parser.lines[parser.index] === '@@';

    if (hasBareAnchor) {
      parser.index += 1;
    }

    if (!(anchor || hasBareAnchor || cursor === 0)) {
      throw new InvalidContextError(
        `Invalid update hunk line: ${parser.lines[parser.index]}`,
      );
    }

    if (anchor.trim()) {
      cursor = advanceCursorToAnchor(anchor, inputLines, cursor, parser);
    }

    const { nextContext, sectionChunks, endIndex, eof } = readSection(
      parser.lines,
      parser.index,
    );
    const nextContextText = nextContext.join('\n');
    const { newIndex, fuzz } = findContext(inputLines, nextContext, cursor, eof);

    if (newIndex === -1) {
      if (eof) {
        throw new InvalidContextError(
          `Invalid EOF context at offset ${cursor}:\n${nextContextText}`,
        );
      }

      throw new InvalidContextError(
        `Invalid context at offset ${cursor}:\n${nextContextText}`,
      );
    }

    parser.fuzz += fuzz;

    for (const chunk of sectionChunks) {
      chunks.push({ ...chunk, origIndex: chunk.origIndex + newIndex });
    }

    cursor = newIndex + nextContext.length;
    parser.index = endIndex;
  }

  return { chunks, fuzz: parser.fuzz };
}

function applyChunks(input: string, chunks: Chunk[]): string {
  const origLines = input.split('\n');
  const destLines: string[] = [];
  let origIndex = 0;

  for (const chunk of chunks) {
    if (chunk.origIndex > origLines.length) {
      throw new InvalidContextError(
        `Chunk index ${chunk.origIndex} exceeds input length ${origLines.length}`,
      );
    }

    if (origIndex > chunk.origIndex) {
      throw new InvalidContextError(
        `Overlapping chunk at index ${chunk.origIndex} (cursor ${origIndex})`,
      );
    }

    destLines.push(...origLines.slice(origIndex, chunk.origIndex));
    origIndex = chunk.origIndex;

    if (chunk.insLines.length) {
      destLines.push(...chunk.insLines);
    }

    origIndex += chunk.delLines.length;
  }

  destLines.push(...origLines.slice(origIndex));
  return destLines.join('\n');
}

/**
 * Applies a headerless V4A diff to file content.
 */
export function applyDiff(
  input: string,
  diff: string,
  mode: 'default' | 'create' = 'default',
): string {
  const diffLines = normalizeDiffLines(diff);

  if (mode === 'create') {
    return parseCreateDiff(diffLines);
  }

  const { chunks } = parseUpdateDiff(diffLines, input);
  return applyChunks(input, chunks);
}
