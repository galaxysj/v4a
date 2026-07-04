import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const CLI = path.join(process.cwd(), 'dist', 'cli.js');

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = '';
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'v4a-cli-test-'));
  return tempDir;
}

async function runCli(args: string[], input?: string): Promise<string> {
  if (input !== undefined) {
    return runCliWithStdin(args, input);
  }

  const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], {
    cwd: tempDir,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim();
}

function runCliWithStdin(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `exit code ${code}`));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

describe('cli', () => {
  it('applies a patch from a file argument', async () => {
    const cwd = await createTempDir();
    const patchPath = path.join(cwd, 'change.patch');
    const patch = [
      BEGIN,
      '*** Add File: from-file.txt',
      '+from file',
      END,
    ].join('\n');

    await writeFile(patchPath, patch, 'utf-8');

    const output = await runCli(['patch', patchPath]);

    expect(output).toBe('add from-file.txt');
    expect(await readFile(path.join(cwd, 'from-file.txt'), 'utf-8')).toBe('from file');
  });

  it('applies a patch from stdin', async () => {
    await createTempDir();
    const patch = [
      BEGIN,
      '*** Add File: stdin.txt',
      '+stdin',
      END,
    ].join('\n');

    const output = await runCli(['patch'], patch);

    expect(output).toBe('add stdin.txt');
    expect(await readFile(path.join(tempDir, 'stdin.txt'), 'utf-8')).toBe('stdin');
  });

  it('respects --allowed-types', async () => {
    await createTempDir();
    const patch = [
      BEGIN,
      '*** Delete File: blocked.txt',
      END,
    ].join('\n');

    await expect(
      runCli(['patch', '--allowed-types', 'add'], patch),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Operation type 'delete' is not allowed"),
    });
  });

  it('validate exits successfully for a valid patch', async () => {
    const cwd = await createTempDir();
    const patchPath = path.join(cwd, 'valid.patch');
    const patch = [BEGIN, '*** Add File: ok.txt', '+ok', END].join('\n');

    await writeFile(patchPath, patch, 'utf-8');

    const output = await runCli(['validate', patchPath]);

    expect(output).toBe('');
  });

  it('validate fails for an invalid patch', async () => {
    await createTempDir();
    const patchPath = path.join(tempDir, 'invalid.patch');
    await writeFile(patchPath, 'not a patch', 'utf-8');

    await expect(runCli(['validate', patchPath])).rejects.toMatchObject({
      message: expect.stringContaining('Patch must start with'),
    });
  });

  it('validate respects --allowed-types', async () => {
    await createTempDir();
    const patch = [BEGIN, '*** Delete File: blocked.txt', END].join('\n');

    await expect(
      runCli(['validate', '--allowed-types', 'add'], patch),
    ).rejects.toMatchObject({
      message: expect.stringContaining("'delete' is not allowed"),
    });
  });

  it('reverse prints an undo patch to stdout', async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, 'app.ts'), 'const x = 1;\nconsole.log(x);\n');

    const patchPath = path.join(cwd, 'change.patch');
    const patch = [
      BEGIN,
      '*** Update File: app.ts',
      '@@',
      ' const x = 1;',
      '-console.log(x);',
      '+console.log(x + 1);',
      END,
    ].join('\n');

    await writeFile(patchPath, patch, 'utf-8');

    const output = await runCli(['reverse', patchPath, '--cwd', cwd]);

    expect(output).toContain('*** Begin Patch');
    expect(output).toContain('*** Update File: app.ts');
    expect(output).toContain('-console.log(x + 1);');
    expect(output).toContain('+console.log(x);');
  });

  it('reverse reads deleted file content from --cwd', async () => {
    const cwd = await createTempDir();
    await writeFile(path.join(cwd, 'gone.txt'), 'original\n');

    const patch = [BEGIN, '*** Delete File: gone.txt', END].join('\n');

    const output = await runCli(['reverse', '--cwd', cwd], patch);

    expect(output).toContain('*** Add File: gone.txt');
    expect(output).toContain('+original');
  });
});
