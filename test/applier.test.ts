import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { applyPatch } from '../src/applier.js';
import { AllowedTypeError, PatchError } from '../src/errors.js';

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
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'v4a-test-'));
  return tempDir;
}

describe('applyPatch', () => {
  it('creates a new file from an add operation', async () => {
    const cwd = await createTempDir();
    const patch = [
      BEGIN,
      '*** Add File: nested/hello.txt',
      '+line 1',
      '+line 2',
      END,
    ].join('\n');

    const result = await applyPatch(patch, { cwd });

    expect(result.operations).toEqual([{ type: 'add', path: 'nested/hello.txt' }]);
    expect(await readFile(path.join(cwd, 'nested/hello.txt'), 'utf-8')).toBe(
      'line 1\nline 2',
    );
  });

  it('updates an existing file', async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, 'app.ts'), 'const x = 1;\nconsole.log(x);\n');

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
  });

  it('deletes an existing file', async () => {
    const cwd = await createTempDir();
    const target = path.join(cwd, 'remove-me.txt');
    await writeFile(target, 'bye');

    const patch = [BEGIN, '*** Delete File: remove-me.txt', END].join('\n');

    await applyPatch(patch, { cwd });

    await expect(readFile(target, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('moves a file while updating content', async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, 'old.ts'), 'value-old\n');

    const patch = [
      BEGIN,
      '*** Update File: old.ts',
      '*** Move to: new.ts',
      '@@',
      '-value-old',
      '+value-new',
      END,
    ].join('\n');

    await applyPatch(patch, { cwd });

    await expect(readFile(path.join(cwd, 'old.ts'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(path.join(cwd, 'new.ts'), 'utf-8')).toBe('value-new\n');
  });

  it('rejects disallowed operation types before applying anything', async () => {
    const cwd = await createTempDir();
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src/existing.ts'), 'keep\n');

    const patch = [
      BEGIN,
      '*** Add File: src/new.ts',
      '+new',
      '*** Update File: src/existing.ts',
      '@@',
      '-keep',
      '+changed',
      END,
    ].join('\n');

    await expect(
      applyPatch(patch, { cwd, allowedTypes: ['add'] }),
    ).rejects.toBeInstanceOf(AllowedTypeError);

    expect(await readFile(path.join(cwd, 'src/existing.ts'), 'utf-8')).toBe('keep\n');
    await expect(readFile(path.join(cwd, 'src/new.ts'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('supports dry-run without writing files', async () => {
    const cwd = await createTempDir();

    const patch = [
      BEGIN,
      '*** Add File: dry.txt',
      '+dry',
      END,
    ].join('\n');

    const result = await applyPatch(patch, { cwd, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.operations).toEqual([{ type: 'add', path: 'dry.txt' }]);
    await expect(readFile(path.join(cwd, 'dry.txt'), 'utf-8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects paths that escape cwd', async () => {
    const cwd = await createTempDir();
    const patch = [BEGIN, '*** Add File: ../escape.txt', '+nope', END].join('\n');

    await expect(applyPatch(patch, { cwd })).rejects.toBeInstanceOf(PatchError);
  });
});
