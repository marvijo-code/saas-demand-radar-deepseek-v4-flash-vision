export type SignalType =
  | "buying_intent"
  | "tool_request"
  | "workaround"
  | "price_complaint"
  | "operational_pain";

export interface PhraseRule {
  type: SignalType;
  label: string;
  regex: RegExp;
  weight: number;
}

// Ordered so more specific phrases match first. Matching is case-insensitive.
export const PHRASE_RULES: PhraseRule[] = [
  {
    type: "buying_intent",
    label: "Looking for a tool",
    regex: /(does anyone have|looking for|looking to buy|where can i (buy|find))(?!.*workout)/i,
    weight: 0.9,
  },
  {
    type: "buying_intent",
    label: "Explicit purchase interest",
    regex: /\b(want to buy|would buy|willing to pay|shut up and take my money)\b/i,
    weight: 1.0,
  },
  {
    type: "buying_intent",
    label: "Wish for a product",
    regex: /\b(i wish there (was|were))\b/i,
    weight: 0.8,
  },
  {
    type: "tool_request",
    label: "Asking for an app/tool",
    regex: /\b(looking for an app|an app where|a tool|a software|solution for|tool to)\b/i,
    weight: 0.8,
  },
  {
    type: "tool_request",
    label: "General app desire",
    regex: /\b(app|tool|software|platform|saas)\b/i,
    weight: 0.5,
  },
  {
    type: "workaround",
    label: "Manual workaround",
    regex: /\b(workaround|doing it by hand|manual(ly)?|spreadsheet|copy[ -]paste)\b/i,
    weight: 0.7,
  },
  {
    type: "price_complaint",
    label: "Pricing complaint",
    regex: /\b(too expensive|pricey|overpriced|enterprise-?priced|expensive|paying too much)\b/i,
    weight: 0.8,
  },
  {
    type: "price_complaint",
    label: "Cost concern",
    regex: /\b(cost|price|pricing|budget)\b/i,
    weight: 0.5,
  },
  {
    type: "operational_pain",
    label: "Time consuming",
    regex: /\b(takes forever|waste[sd]? time|time[- ]consuming|tedious|slow)\b/i,
    weight: 0.7,
  },
  {
    type: "operational_pain",
    label: "Frustration",
    regex: /\b(frustrat|annoying|pain( in )?|hurts|sucks|hate)\b/i,
    weight: 0.6,
  },
  {
    type: "operational_pain",
    label: "Operational difficulty",
    regex: /\b(difficult|hard to|struggle|complicate|one global level|takes forever to find)\b/i,
    weight: 0.6,
  },
];

export interface DetectedSignal {
  type: SignalType;
  label: string;
  weight: number;
}

export function detectSignals(text: string): DetectedSignal[] {
  const found: DetectedSignal[] = [];
  for (const rule of PHRASE_RULES) {
    if (rule.regex.test(text)) {
      found.push({ type: rule.type, label: rule.label, weight: rule.weight });
    }
  }
  return found;
}

// Topic keywords used to cluster records into a shared SaaS need.
export interface TopicMatch {
  label: string;
  keywords: string[];
}

export const TOPIC_KEYWORDS: TopicMatch[] = [
  {
    label: "Recipe suggestion from food photo",
    keywords: ["photo", "fridge", "recipe", "ingredients", "food"],
  },
  {
    label: "Reddit prospect finder for cold outreach",
    keywords: ["reddit", "prospect", "cold email", "find prospects", "automate", "list building"],
  },
  {
    label: "Software discovery / search tool",
    keywords: ["software", "directory", "find the right", "tool directory", "search results"],
  },
  {
    label: "AI chatbot usage tracking",
    keywords: ["chatbot", "ai chatbot", "usage tracking", "tracking", "company devices"],
  },
  {
    label: "Per-app privacy controls",
    keywords: ["privacy levels", "different apps", "one global level", "per-app"],
  },
  {
    label: "Technical newsletter digest",
    keywords: ["newsletter", "data-engineering", "updates about new", "technology"],
  },
];

export function matchTopic(text: string, _author: string): string | null {
  const hay = text.toLowerCase();
  for (const topic of TOPIC_KEYWORDS) {
    const score = topic.keywords.filter((k) => hay.includes(k)).length;
    if (score > 0) return topic.label;
  }
  return null;
}
