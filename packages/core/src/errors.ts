export class OverviewError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400,
    public readonly revision?: number) {
    super(message);
    this.name = "OverviewError";
  }
}

export function requireCondition(condition: unknown, code: string, message: string, status = 400): asserts condition {
  if (!condition) throw new OverviewError(code, message, status);
}
