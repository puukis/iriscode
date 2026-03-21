export class IrisCodeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'IrisCodeError';
  }
}

export class PermissionDeniedError extends IrisCodeError {
  constructor(public readonly toolName: string) {
    super(`Permission denied for tool: ${toolName}`);
    this.name = 'PermissionDeniedError';
  }
}

export class ProviderError extends IrisCodeError {
  constructor(message: string, public readonly provider: string, cause?: unknown) {
    super(`[${provider}] ${message}`, cause);
    this.name = 'ProviderError';
  }
}

export class ToolError extends IrisCodeError {
  constructor(message: string, public readonly toolName: string, cause?: unknown) {
    super(`[${toolName}] ${message}`, cause);
    this.name = 'ToolError';
  }
}
