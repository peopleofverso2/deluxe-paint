// Tiny fetch wrapper for our same-origin /api/* endpoints. Always sends
// credentials so the session cookie travels along.
async function req<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = (() => { try { return JSON.parse(text); } catch { return text; } })();
    throw new ApiError(res.status, typeof detail === "string" ? detail : (detail?.error ?? `HTTP ${res.status}`), detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export type ApiUser = { id: string; email: string; displayName: string | null };

export type ProjectListItem = {
  id: string;
  name: string;
  width: number;
  height: number;
  frameCount: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProjectFull = ProjectListItem & {
  ownerId: string;
  data: unknown; // Same shape as the .dpaint file
};

export const api = {
  me: () => req<{ user: ApiUser | null }>("GET", "/me"),
  login: (email: string) => req<{ ok: true }>("POST", "/auth/login", { email }),
  logout: () => req<{ ok: true }>("POST", "/auth/logout"),

  listProjects: () => req<{ projects: ProjectListItem[] }>("GET", "/projects"),
  getProject: (id: string) => req<{ project: ProjectFull }>("GET", `/projects/${encodeURIComponent(id)}`),
  createProject: (body: { name: string; data: unknown; isPublic?: boolean }) =>
    req<{ project: ProjectListItem }>("POST", "/projects", body),
  updateProject: (id: string, body: { name?: string; data?: unknown; isPublic?: boolean }) =>
    req<{ project: ProjectListItem }>("PUT", `/projects/${encodeURIComponent(id)}`, body),
  deleteProject: (id: string) => req<{ ok: true }>("DELETE", `/projects/${encodeURIComponent(id)}`),
};
