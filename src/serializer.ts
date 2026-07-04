import type { FileOp, ParsedPatch } from './types.js';

function serializeOp(op: FileOp): string[] {
  if (op.type === 'add') {
    return [`*** Add File: ${op.path}`, ...op.lines.map((line) => `+${line}`)];
  }

  if (op.type === 'delete') {
    return [`*** Delete File: ${op.path}`];
  }

  const header = [`*** Update File: ${op.path}`];

  if (op.moveTo) {
    header.push(`*** Move to: ${op.moveTo}`);
  }

  const diffLines = op.diff.length > 0 ? op.diff.split('\n') : [];
  return [...header, ...diffLines];
}

export function serializePatch(parsed: ParsedPatch): string {
  const body = parsed.operations.flatMap(serializeOp);
  return ['*** Begin Patch', ...body, '*** End Patch'].join('\n');
}
