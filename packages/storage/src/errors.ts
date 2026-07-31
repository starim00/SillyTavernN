export class StorageError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    details: unknown = undefined,
  ) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NotFoundError extends StorageError {
  constructor(resource: string, id: string) {
    super("not_found", `${resource} '${id}' was not found.`, 404, {
      resource,
      id,
    });
  }
}

export class ConflictError extends StorageError {
  constructor(message: string, details: unknown = undefined) {
    super("revision_conflict", message, 409, details);
  }
}

export class PermissionError extends StorageError {
  constructor(message: string, details: unknown = undefined) {
    super("permission_denied", message, 403, details);
  }
}

export class ConfirmationRequiredError extends StorageError {
  constructor(toolName: string) {
    super(
      "confirmation_required",
      `Tool '${toolName}' requires explicit human confirmation.`,
      409,
      {
        toolName,
      },
    );
  }
}

export class RunCancelledError extends StorageError {
  constructor(runId: string) {
    super("run_cancelled", `Agent run '${runId}' has been cancelled.`, 409, {
      runId,
    });
  }
}
