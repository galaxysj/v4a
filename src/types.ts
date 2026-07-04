export type PatchType = 'add' | 'update' | 'delete';

export const ALL_PATCH_TYPES: readonly PatchType[] = ['add', 'update', 'delete'];

export type AddFileOp = {
  type: 'add';
  path: string;
  lines: string[];
};

export type DeleteFileOp = {
  type: 'delete';
  path: string;
};

export type UpdateFileOp = {
  type: 'update';
  path: string;
  moveTo?: string;
  diff: string;
};

export type FileOp = AddFileOp | DeleteFileOp | UpdateFileOp;

export type ParsedPatch = {
  operations: FileOp[];
};

export type ApplyPatchOptions = {
  allowedTypes?: PatchType[];
  cwd?: string;
  dryRun?: boolean;
};

export type ApplyPatchResult = {
  operations: AppliedOperation[];
  dryRun: boolean;
};

export type AppliedOperation =
  | { type: 'add'; path: string }
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; moveTo?: string };
