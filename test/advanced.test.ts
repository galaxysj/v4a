import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyPatch } from '../src/applier.js';
import { parsePatch } from '../src/parser.js';

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
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'v4a-adv-test-'));
  return tempDir;
}

describe('parsePatch - advanced structures', () => {
  it('parses multiple Update File sections with blank lines between them', () => {
    const patch = [
      BEGIN,
      '*** Update File: old.ts',
      '*** Move to: new.ts',
      '@@',
      '-old',
      '+new',
      '',
      '*** Update File: test.js',
      '@@',
      '-a',
      '+b',
      END,
    ].join('\n');

    const result = parsePatch(patch);

    expect(result.operations).toHaveLength(2);
    expect(result.operations[0]).toMatchObject({
      type: 'update',
      path: 'old.ts',
      moveTo: 'new.ts',
    });
    expect(result.operations[1]).toMatchObject({
      type: 'update',
      path: 'test.js',
    });
  });

  it('parses multiple hunks within a single Update File separated by blank lines', () => {
    const patch = [
      BEGIN,
      '*** Update File: multi.ts',
      '@@ function one()',
      '-old1',
      '+new1',
      '',
      '@@ function two()',
      '-old2',
      '+new2',
      END,
    ].join('\n');

    const result = parsePatch(patch);

    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    expect(op.type).toBe('update');
    if (op.type === 'update') {
      expect(op.diff).toContain('@@ function one()');
      expect(op.diff).toContain('@@ function two()');
    }
  });

  it('parses various @@ anchor headers', () => {
    const patch = [
      BEGIN,
      '*** Update File: anchors.ts',
      '@@ function hello()',
      '-a',
      '+b',
      '@@ class User',
      '-c',
      '+d',
      '@@ if (x > 0)',
      '-e',
      '+f',
      END,
    ].join('\n');

    expect(() => parsePatch(patch)).not.toThrow();
  });

  it('parses *** End of File marker within a hunk', () => {
    const patch = [
      BEGIN,
      '*** Update File: eof.ts',
      '@@',
      '-last',
      '+lastNew',
      '*** End of File',
      END,
    ].join('\n');

    const result = parsePatch(patch);
    const op = result.operations[0];
    expect(op.type).toBe('update');
    if (op.type === 'update') {
      expect(op.diff).toContain('*** End of File');
    }
  });

  it('parses a full patch combining Update, Add, and Delete with blank lines', () => {
    const patch = [
      BEGIN,
      '',
      '*** Update File: a.ts',
      '@@',
      '-x',
      '+y',
      '',
      '*** Add File: b.ts',
      '+created',
      '',
      '*** Delete File: c.ts',
      '',
      END,
    ].join('\n');

    const result = parsePatch(patch);

    expect(result.operations.map((op) => op.type)).toEqual(['update', 'add', 'delete']);
  });
});

describe('applyPatch - advanced structures', () => {
  it('applies multiple hunks in a single update in order', async () => {
    const cwd = await createTempDir();
    await writeFile(
      path.join(cwd, 'multi.ts'),
      ['function one() {', '  old1', '}', '', 'function two() {', '  old2', '}', ''].join(
        '\n',
      ),
    );

    const patch = [
      BEGIN,
      '*** Update File: multi.ts',
      '@@ function one() {',
      '-  old1',
      '+  new1',
      '@@ function two() {',
      '-  old2',
      '+  new2',
      END,
    ].join('\n');

    await applyPatch(patch, { cwd });

    const content = await readFile(path.join(cwd, 'multi.ts'), 'utf-8');
    expect(content).toContain('new1');
    expect(content).toContain('new2');
    expect(content).not.toContain('old1');
    expect(content).not.toContain('old2');
  });

  it('applies multiple hunks separated by blank lines', async () => {
    const cwd = await createTempDir();
    await writeFile(
      path.join(cwd, 'blank.ts'),
      ['function one() {', '  old1', '}', '', 'function two() {', '  old2', '}', ''].join(
        '\n',
      ),
    );

    const patch = [
      BEGIN,
      '*** Update File: blank.ts',
      '@@ function one() {',
      '-  old1',
      '+  new1',
      '',
      '@@ function two() {',
      '-  old2',
      '+  new2',
      END,
    ].join('\n');

    await applyPatch(patch, { cwd });

    const content = await readFile(path.join(cwd, 'blank.ts'), 'utf-8');
    expect(content).toContain('new1');
    expect(content).toContain('new2');
  });

  it('applies an *** End of File hunk correctly', async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, 'eof.ts'), 'keep\nlast\n');

    const patch = [
      BEGIN,
      '*** Update File: eof.ts',
      '@@',
      ' keep',
      '-last',
      '+lastNew',
      '*** End of File',
      END,
    ].join('\n');

    await applyPatch(patch, { cwd });

    expect(await readFile(path.join(cwd, 'eof.ts'), 'utf-8')).toBe('keep\nlastNew\n');
  });

  it('applies a full patch combining update, add, and delete operations', async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, 'a.ts'), 'x\n');
    await writeFile(path.join(cwd, 'c.ts'), 'to-delete\n');

    const patch = [
      BEGIN,
      '*** Update File: a.ts',
      '@@',
      '-x',
      '+y',
      '*** Add File: b.ts',
      '+created',
      '*** Delete File: c.ts',
      END,
    ].join('\n');

    const result = await applyPatch(patch, { cwd });

    expect(result.operations.map((op) => op.type)).toEqual(['update', 'add', 'delete']);
    expect(await readFile(path.join(cwd, 'a.ts'), 'utf-8')).toBe('y\n');
    expect(await readFile(path.join(cwd, 'b.ts'), 'utf-8')).toBe('created');
    await expect(readFile(path.join(cwd, 'c.ts'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('applies sequential update operations with rename in one patch', async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, 'old.ts'), 'old\n');
    await writeFile(path.join(cwd, 'test.js'), 'a\n');

    const patch = [
      BEGIN,
      '*** Update File: old.ts',
      '*** Move to: new.ts',
      '@@',
      '-old',
      '+new',
      '*** Update File: test.js',
      '@@',
      '-a',
      '+b',
      END,
    ].join('\n');

    await applyPatch(patch, { cwd });

    expect(await readFile(path.join(cwd, 'new.ts'), 'utf-8')).toBe('new\n');
    expect(await readFile(path.join(cwd, 'test.js'), 'utf-8')).toBe('b\n');
    await expect(readFile(path.join(cwd, 'old.ts'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
