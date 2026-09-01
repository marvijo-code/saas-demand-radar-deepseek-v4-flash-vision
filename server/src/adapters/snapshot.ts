import type { IngestRecordInput, NormalizedRecord, SourceAdapter } from "./types.js";
import { normalizeRecord } from "./types.js";

export class SnapshotAdapter implements SourceAdapter {
  readonly name = "snapshot";
  private records: IngestRecordInput[];

  constructor(records: IngestRecordInput[] = []) {
    this.records = records;
  }

  async fetch(): Promise<NormalizedRecord[]> {
    return this.records.map((r) => normalizeRecord(r));
  }
}
