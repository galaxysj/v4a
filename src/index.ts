export { applyDiff } from './apply-diff.js';
export { applyPatch, parseAllowedTypes } from './applier.js';
export { parsePatch, normalizePatchLines } from './parser.js';
export { serializePatch } from './serializer.js';
export {
  merge,
  reverse,
  validate,
  type ReverseOptions,
  type ValidateOptions,
  type ValidationResult,
} from './transform.js';
export {
  ALL_PATCH_TYPES,
  type AddFileOp,
  type AppliedOperation,
  type ApplyPatchOptions,
  type ApplyPatchResult,
  type DeleteFileOp,
  type FileOp,
  type ParsedPatch,
  type PatchType,
  type UpdateFileOp,
} from './types.js';
export {
  AllowedTypeError,
  InvalidContextError,
  ParseError,
  PatchError,
} from './errors.js';
