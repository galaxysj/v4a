export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

export class ParseError extends PatchError {
  readonly line?: number;

  constructor(message: string, line?: number) {
    const suffix = line !== undefined ? ` (line ${line})` : '';
    super(`${message}${suffix}`);
    this.name = 'ParseError';
    this.line = line;
  }
}

export class InvalidContextError extends PatchError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidContextError';
  }
}

export class AllowedTypeError extends PatchError {
  readonly disallowedType: string;
  readonly allowedTypes: string[];

  constructor(disallowedType: string, allowedTypes: string[]) {
    super(
      `Operation type '${disallowedType}' is not allowed. Allowed types: ${allowedTypes.join(', ')}`,
    );
    this.name = 'AllowedTypeError';
    this.disallowedType = disallowedType;
    this.allowedTypes = allowedTypes;
  }
}
