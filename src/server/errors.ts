/** Expected, user-facing failures of organisation-level operations. `code` is stable for programs, `message` is safe to show. */
export class OrgError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
