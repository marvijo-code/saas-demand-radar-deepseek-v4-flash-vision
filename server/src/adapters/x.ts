import type { NormalizedRecord, SourceAdapter } from "./types.js";

// Placeholder adapter for the real X (Twitter) API. Wire live credentials
// (Bearer token) into the constructor to enable live ingestion.
export class XAdapter implements SourceAdapter {
  readonly name = "x";
  constructor(
    private readonly opts: {
      bearerToken?: string;
      query?: string;
    } = {}
  ) {}

  async fetch(): Promise<NormalizedRecord[]> {
    if (!this.opts.bearerToken) {
      throw new Error(
        "X adapter requires a bearerToken. Provide live credentials or use the snapshot adapter."
      );
    }
    // Live implementation hooks here. Not invoked during deterministic tests.
    throw new Error("Live X ingestion is not configured.");
  }
}
