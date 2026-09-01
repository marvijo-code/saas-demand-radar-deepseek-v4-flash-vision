import type { NormalizedRecord, SourceAdapter } from "./types.js";

// Placeholder adapter for the real Reddit API. Wire live credentials
// (client_id/client_secret/user_agent) into the constructor to enable live
// ingestion of public subreddit conversations.
export class RedditAdapter implements SourceAdapter {
  readonly name = "reddit";
  constructor(
    private readonly opts: {
      clientId?: string;
      clientSecret?: string;
      userAgent?: string;
      subreddits?: string[];
    } = {}
  ) {}

  async fetch(): Promise<NormalizedRecord[]> {
    if (!this.opts.clientId) {
      throw new Error(
        "Reddit adapter requires clientId. Provide live credentials or use the snapshot adapter."
      );
    }
    // Live implementation hooks here. Not invoked during deterministic tests.
    throw new Error("Live Reddit ingestion is not configured.");
  }
}
