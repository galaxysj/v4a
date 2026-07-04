import { describe, expect, it } from 'vitest';

import { parsePatch } from '../src/parser.js';

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';

describe('parsePatch', () => {
  it('parses add file operations', () => {
    const patch = [
      BEGIN,
      '*** Add File: hello.txt',
      '+Hello',
      '+World',
      END,
    ].join('\n');

    const result = parsePatch(patch);

    expect(result.operations).toEqual([
      {
        type: 'add',
        path: 'hello.txt',
        lines: ['Hello', 'World'],
      },
    ]);
  });

  it('parses delete file operations', () => {
    const patch = [BEGIN, '*** Delete File: obsolete.txt', END].join('\n');

    expect(parsePatch(patch).operations).toEqual([
      { type: 'delete', path: 'obsolete.txt' },
    ]);
  });

  it('parses update file operations with hunks', () => {
    const patch = [
      BEGIN,
      '*** Update File: src/app.ts',
      '@@ function main()',
      ' function main() {',
      '-  console.log("hi");',
      '+  console.log("hello");',
      ' }',
      END,
    ].join('\n');

    const result = parsePatch(patch);

    expect(result.operations).toEqual([
      {
        type: 'update',
        path: 'src/app.ts',
        diff: [
          '@@ function main()',
          ' function main() {',
          '-  console.log("hi");',
          '+  console.log("hello");',
          ' }',
        ].join('\n'),
      },
    ]);
  });

  it('parses update file operations with move', () => {
    const patch = [
      BEGIN,
      '*** Update File: old.ts',
      '*** Move to: new.ts',
      '@@',
      '-old',
      '+new',
      END,
    ].join('\n');

    const result = parsePatch(patch);

    expect(result.operations[0]).toMatchObject({
      type: 'update',
      path: 'old.ts',
      moveTo: 'new.ts',
    });
  });

  it('parses multiple operations', () => {
    const patch = [
      BEGIN,
      '*** Add File: a.txt',
      '+a',
      '*** Delete File: b.txt',
      '*** Update File: c.txt',
      '@@',
      '-c',
      '+C',
      END,
    ].join('\n');

    expect(parsePatch(patch).operations).toHaveLength(3);
  });

  it('throws when envelope is missing', () => {
    expect(() => parsePatch('*** Add File: a.txt\n+a')).toThrow(
      'Patch must start with',
    );
  });

  it('throws when add section has invalid lines', () => {
    const patch = [BEGIN, '*** Add File: a.txt', 'not-plus', END].join('\n');

    expect(() => parsePatch(patch)).toThrow('Expected "+" line');
  });
});
