/**
 * The one error shape the module understands from a host-supplied collaborator.
 *
 * A `SheetAnalyst` or `DriveProvider` that throws this gets its status and
 * message shown to the person doing the import ("Anthropic rejected the API
 * key", "that Drive file was deleted"). Anything else it throws is treated as a
 * bug and goes to the app's error handler as a 500, which is the right default:
 * an unexpected failure should be loud, not rendered as advice.
 */
export class LeadsHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LeadsHttpError";
    this.status = status;
  }
}

/** True for anything carrying a usable HTTP status — ours, or a look-alike. */
export function httpStatusOf(err: unknown): number | null {
  if (err instanceof LeadsHttpError) return err.status;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 600 ? status : null;
}
