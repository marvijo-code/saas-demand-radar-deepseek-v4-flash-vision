import type { IngestRecordInput } from "./types.js";

export interface AdapterStubSource {
  name: string;
  fetch(): Promise<IngestRecordInput[]>;
}

export function createAdapter(
  name: string,
  records?: IngestRecordInput[]
): { name: string; fetch(): Promise<IngestRecordInput[]> } {
  switch (name) {
    case "snapshot":
      return {
        name: "snapshot",
        fetch: async () => records ?? [],
      };
    case "x":
    case "reddit":
      // Replaceable: return a stub whose fetch throws unless live credentials
      // are provided. Loading is handled by the ingest service.
      return { name, fetch: async () => [] };
    default:
      throw new Error(`Unknown adapter "${name}"`);
  }
}
