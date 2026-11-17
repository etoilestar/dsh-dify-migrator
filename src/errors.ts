export class MigrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "MigrationError"
  }
}

