const BASE = "/api";
const MAX_RETRIES = 1;

export class ApiError extends Error {
  status: number;
  issues?: unknown[];
  constructor(status: number, message: string, issues?: unknown[]) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

type FetchOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  abort?: AbortSignal;
};

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "include",
      signal: options.abort,
    });

    if (res.status === 401 && attempt < MAX_RETRIES) {
      // Attempt a refresh once; otherwise surface the error.
      continue;
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        (json as { error?: string }).error ?? res.statusText ?? "Request failed";
      throw new ApiError(res.status, message, (json as { issues?: unknown[] }).issues);
    }
    return json as T;
  }
  throw new ApiError(401, "Session expired");
}

export const api = {
  me: () => apiRequest<{ user: User }>("/auth/me"),
  login: (email: string, password: string) =>
    apiRequest<{ user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
    }),
  logout: () => apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  health: () => apiRequest<{ status: string }>("/health"),
};

export interface User {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  workspaceId: number;
  workspaceName: string;
}
