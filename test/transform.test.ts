import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyPatch } from '../src/applier.js';
import { PatchError } from '../src/errors.js';
import { parsePatch } from '../src/parser.js';
import { merge, reverse, validate } from '../src/transform.js';

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = '';
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'v4a-transform-test-'));
  return tempDir;
}

describe('validate', () => {
  it('reports valid for a well-formed patch', () => {
    const patch = [BEGIN, '*** Add File: a.txt', '+hi', END].join('\n');

    expect(validate(patch)).toEqual({ valid: true });
  });

  it('reports the parse error for a malformed patch', () => {
    const result = validate('not a patch');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Patch must start with');
    }
  });

  it('reports a disallowed operation type without throwing', () => {
    const patch = [BEGIN, '*** Delete File: a.txt', END].join('\n');

    const result = validate(patch, { allowedTypes: ['add'] });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("'delete' is not allowed");
    }
  });
});

describe('merge', () => {
  it('merges multiple patches into a single envelope (variadic)', () => {
    const patchA = [BEGIN, '*** Add File: a.txt', '+a', END].join('\n');
    const patchB = [BEGIN, '*** Delete File: b.txt', END].join('\n');

    const merged = merge(patchA, patchB);
    const parsed = parsePatch(merged);

    expect(parsed.operations).toEqual([
      { type: 'add', path: 'a.txt', lines: ['a'] },
      { type: 'delete', path: 'b.txt' },
    ]);
  });

  it('merges multiple patches passed as an array', () => {
    const patchA = [BEGIN, '*** Add File: a.txt', '+a', END].join('\n');
    const patchB = [BEGIN, '*** Add File: b.txt', '+b', END].join('\n');

    const merged = merge([patchA, patchB]);
    const parsed = parsePatch(merged);

    expect(parsed.operations).toHaveLength(2);
  });

  it('merged patch applies cleanly to the file system', async () => {
    const cwd = await createTempDir();
    const patchA = [BEGIN, '*** Add File: a.txt', '+a', END].join('\n');
    const patchB = [BEGIN, '*** Add File: b.txt', '+b', END].join('\n');

    const merged = merge(patchA, patchB);
    await applyPatch(merged, { cwd });

    expect(await readFile(path.join(cwd, 'a.txt'), 'utf-8')).toBe('a');
    expect(await readFile(path.join(cwd, 'b.txt'), 'utf-8')).toBe('b');
  });

  it('throws when called with no patches', () => {
    expect(() => merge()).toThrow(PatchError);
  });
});

describe('reverse', () => {
  it('reverses an add into a delete', () => {
    const patch = [BEGIN, '*** Add File: new.txt', '+content', END].join('\n');

    const reversed = reverse(patch);

    expect(parsePatch(reversed).operations).toEqual([
      { type: 'delete', path: 'new.txt' },
    ]);
  });

  it('reverses a delete into an add using supplied content', () => {
    const patch = [BEGIN, '*** Delete File: gone.txt', END].join('\n');

    const reversed = reverse(patch, {
      deletedFileContents: { 'gone.txt': 'line1\nline2' },
    });

    expect(parsePatch(reversed).operations).toEqual([
      { type: 'add', path: 'gone.txt', lines: ['line1', 'line2'] },
    ]);
  });

  it('throws when reversing a delete without content', () => {
    const patch = [BEGIN, '*** Delete File: gone.txt', END].join('\n');

    expect(() => reverse(patch)).toThrow(PatchError);
  });

  it('reverses update hunks by swapping +/- lines', () => {
    const patch = [
      BEGIN,
      '*** Update File: app.ts',
      '@@',
      ' keep',
      '-old',
      '+new',
      END,
    ].join('\n');

    const reversed = reverse(patch);
    const op = parsePatch(reversed).operations[0];

    expect(op).toMatchObject({ type: 'update', path: 'app.ts' });
    if (op.type === 'update') {
      expect(op.diff).toBe(['@@', ' keep', '+old', '-new'].join('\n'));
    }
  });

  it('reverses a move by swapping path and moveTo', () => {
    const patch = [
      BEGIN,
      '*** Update File: old.ts',
      '*** Move to: new.ts',
      '@@',
      '-a',
      '+b',
      END,
    ].join('\n');

    const reversed = reverse(patch);
    const op = parsePatch(reversed).operations[0];

    expect(op).toMatchObject({ type: 'update', path: 'new.ts', moveTo: 'old.ts' });
  });

  it('applying a patch then its reverse restores the original file content', async () => {
    const cwd = await createTempDir();
    const original = 'const x = 1;\nconsole.log(x);\n';
    await writeFile(path.join(cwd, 'app.ts'), original);

    const patch = [
      BEGIN,
      '*** Update File: app.ts',
      '@@',
      ' const x = 1;',
      '-console.log(x);',
      '+console.log(x + 1);',
      END,
    ].join('\n');

    await applyPatch(patch, { cwd });
    expect(await readFile(path.join(cwd, 'app.ts'), 'utf-8')).toBe(
      'const x = 1;\nconsole.log(x + 1);\n',
    );

    const reversed = reverse(patch);
    await applyPatch(reversed, { cwd });

    expect(await readFile(path.join(cwd, 'app.ts'), 'utf-8')).toBe(original);
  });

  it('reverses multiple operations and restores original order semantics', () => {
    const patch = [
      BEGIN,
      '*** Add File: a.txt',
      '+a',
      '*** Delete File: b.txt',
      END,
    ].join('\n');

    const reversed = reverse(patch, { deletedFileContents: { 'b.txt': 'b' } });
    const ops = parsePatch(reversed).operations;

    expect(ops).toEqual([
      { type: 'add', path: 'b.txt', lines: ['b'] },
      { type: 'delete', path: 'a.txt' },
    ]);
  });
});
