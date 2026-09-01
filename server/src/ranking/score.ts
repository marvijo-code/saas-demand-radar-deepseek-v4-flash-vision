export interface ModelWeights {
  frequency: number;
  recency: number;
  intent: number;
  engagement: number;
  diversity: number;
}

export const DEFAULT_MODEL_WEIGHTS: ModelWeights = {
  frequency: 1.0,
  recency: 1.0,
  intent: 1.2,
  engagement: 1.0,
  diversity: 0.7,
};

export function normalizeWeights(weights: ModelWeights): ModelWeights {
  return { ...DEFAULT_MODEL_WEIGHTS, ...weights };
}

export interface ScoreComponent {
  key: keyof ModelWeights;
  label: string;
  raw: number;
  normalized: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface ScoreBreakdown {
  total: number;
  components: ScoreComponent[];
}

export type WindowKey = "24h" | "7d" | "30d";

export const WINDOW_MS: Record<WindowKey, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function parseWindow(value: string | undefined): WindowKey {
  return value === "24h" || value === "7d" || value === "30d" ? value : "30d";
}

// Recency decays over time but stays meaningful for older evidence.
// half-life roughly 60 days.
function recencyScore(ageMs: number): number {
  const halfLifeMs = 60 * 24 * 60 * 60 * 1000;
  return Math.exp((Math.log(0.5) * ageMs) / halfLifeMs);
}

export interface EvidenceForScore {
  publishedAt: string;
  platform: string;
  likes: number;
  replies: number;
  reposts: number;
  upvotes: number;
  comments: number;
  signalWeights: number[];
  isRelevant: boolean | null;
  willingnessToPay: boolean;
  contacted: boolean;
  weight?: number;
  recordId?: number;
  author?: string;
  url?: string;
  text?: string;
  externalId?: string;
}

export function computeScore(
  evidence: EvidenceForScore[],
  weights: ModelWeights,
  now: number
): ScoreBreakdown {
  weights = normalizeWeights(weights);
  const totalRecords = evidence.length;

  // Per-evidence weight from learned phrase/source weights (default 1).
  const evidenceWeights = evidence.map((e) => e.weight ?? 1);

  // Frequency: weighted number of distinct evidence records.
  const weightedCount = evidenceWeights.reduce((acc, w) => acc + w, 0);
  const frequencyRaw = weightedCount;
  const frequencyNorm = clamp(frequencyRaw / 10, 0, 1);
  const frequencyDetail = `${totalRecords} source record${totalRecords === 1 ? "" : "s"} (weighted ${round(weightedCount, 2)}) in window`;

  // Recency: mean of per-record recency, weighted by evidence weight.
  let recencySum = 0;
  let recencyWeightSum = 0;
  for (const ev of evidence) {
    const age = Math.max(0, now - Date.parse(ev.publishedAt));
    recencySum += recencyScore(age) * (ev.weight ?? 1);
    recencyWeightSum += ev.weight ?? 1;
  }
  const recencyRaw = recencyWeightSum ? recencySum / recencyWeightSum : 0;
  const recencyNorm = clamp(recencyRaw, 0, 1);
  const recencyDetail = evidence.length
    ? `average recency ${recencyRaw.toFixed(2)} (recent evidence scores higher)`
    : "no recent evidence";

  // Intent strength: max signal weight per record, averaged.
  const intentValues = evidence.map((e) =>
    e.signalWeights.length ? Math.max(...e.signalWeights) : 0
  );
  const intentRaw = evidence.length
    ? intentValues.reduce((a, b) => a + b, 0) / evidence.length
    : 0;
  const intentNorm = clamp(intentRaw, 0, 1);
  const intentDetail = evidence.length
    ? `mean intent strength ${intentRaw.toFixed(2)}`
    : "no intent signals";

  // Engagement: log-scaled weighted sum of public engagement across evidence.
  const engagementSum = evidence.reduce((acc, e, idx) => {
    return (
      acc +
      (e.likes + e.replies + e.reposts + e.upvotes + e.comments) *
        (evidenceWeights[idx] ?? 1)
    );
  }, 0);
  const engagementNorm = engagementSum > 0
    ? clamp(Math.log10(engagementSum + 1) / Math.log10(1000), 0, 1)
    : 0;
  const engagementDetail = `${engagementSum} total engagement points`;

  // Cross-source diversity: number of distinct platforms.
  const platforms = new Set(evidence.map((e) => e.platform));
  const diversityRaw = platforms.size;
  const diversityNorm = clamp(diversityRaw / 2, 0, 1);
  const diversityDetail = `${platforms.size} platform${platforms.size === 1 ? "" : "s"} (${[...platforms].join(", ")})`;

  const components: ScoreComponent[] = [
    makeComponent("frequency", "Frequency", frequencyRaw, frequencyNorm, weights.frequency, frequencyDetail),
    makeComponent("recency", "Recency", recencyRaw, recencyNorm, weights.recency, recencyDetail),
    makeComponent("intent", "Intent strength", intentRaw, intentNorm, weights.intent, intentDetail),
    makeComponent("engagement", "Engagement", engagementSum, engagementNorm, weights.engagement, engagementDetail),
    makeComponent("diversity", "Cross-source diversity", diversityRaw, diversityNorm, weights.diversity, diversityDetail),
  ];

  const total = components.reduce((acc, c) => acc + c.contribution, 0);
  return { total: round(total), components };
}

function makeComponent(
  key: ScoreComponent["key"],
  label: string,
  raw: number,
  normalized: number,
  weight: number,
  detail: string
): ScoreComponent {
  const contribution = normalized * weight;
  return {
    key,
    label,
    raw: round(raw, 3),
    normalized: round(normalized, 3),
    weight,
    contribution: round(contribution, 3),
    detail,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}
