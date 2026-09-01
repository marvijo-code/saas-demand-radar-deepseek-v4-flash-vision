export interface EngagementCounts {
  likes?: number;
  replies?: number;
  reposts?: number;
  upvotes?: number;
  comments?: number;
}

export interface NormalizedRecord {
  platform: string;
  externalId: string;
  url: string;
  author: string;
  publishedAt: string;
  text: string;
  engagement: Required<EngagementCounts>;
}

export interface IngestRecordInput {
  platform: string;
  externalId?: string;
  url?: string;
  author?: string;
  publishedAt?: string;
  text: string;
  engagement?: EngagementCounts;
}

export interface SourceAdapter {
  readonly name: string;
  fetch(): Promise<NormalizedRecord[]>;
}

export function normalizeRecord(input: IngestRecordInput): NormalizedRecord {
  const e = input.engagement ?? {};
  return {
    platform: input.platform.toLowerCase(),
    externalId: input.externalId ?? "",
    url: input.url ?? "",
    author: input.author ?? "anonymous",
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    text: input.text,
    engagement: {
      likes: e.likes ?? 0,
      replies: e.replies ?? 0,
      reposts: e.reposts ?? 0,
      upvotes: e.upvotes ?? 0,
      comments: e.comments ?? 0,
    },
  };
}
