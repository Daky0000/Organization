import { leadsUi } from "./config";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Called when the server rejects a session mid-use, so the host can show its login screen. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  // HOST PATCH: the module shipped expecting a session cookie. ContentFlow
  // authenticates with a JWT that App.tsx keeps in localStorage, so send that
  // instead — the module's README calls this out as the supported alternative.
  // `credentials` stays included so nothing breaks if a cookie is added later.
  const token = localStorage.getItem("auth_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${leadsUi().apiBase}${path}`, { ...options, headers, credentials: "include" });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/**
 * HOST PATCH: downloads a file endpoint and saves it.
 *
 * The module exported via plain `<a href>` links, which is the better design
 * when a session cookie authenticates the request — the browser streams
 * straight to disk and a 5,000-row workbook never exists in memory. This host
 * authenticates with a bearer token instead, and a link navigation cannot
 * carry a header, so the response has to be fetched and handed to the browser
 * as a blob.
 */
export async function download(path: string, fallbackName: string): Promise<void> {
  const headers = new Headers();
  const token = localStorage.getItem("auth_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${leadsUi().apiBase}${path}`, { headers, credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  // The server names the file in Content-Disposition; fall back if a proxy
  // stripped it.
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const named = /filename="?([^";]+)"?/i.exec(disposition);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = named?.[1] ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** `/leads/...` against wherever the leads router is mounted. */
export function leads(path = ""): string {
  return `${leadsUi().leadsPath}${path}`;
}

/** `/imports/...` against wherever the imports router is mounted. */
export function imports(path = ""): string {
  return `${leadsUi().importsPath}${path}`;
}
