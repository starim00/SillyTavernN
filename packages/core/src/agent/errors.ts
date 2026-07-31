export type AgentErrorCode =
  | "AGENT_RUN_CANCELLED"
  | "AGENT_STEP_LIMIT_REACHED"
  | "AGENT_TOOL_CALL_LIMIT_REACHED"
  | "AGENT_WRITE_LIMIT_REACHED"
  | "TOOL_NOT_FOUND"
  | "TOOL_ARGUMENT_INVALID"
  | "TOOL_PERMISSION_DENIED"
  | "CONFIRMATION_REQUIRED";

export class AgentRuntimeError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}
