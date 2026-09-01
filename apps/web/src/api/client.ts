/**
 * Task 088: Typed API client with admin secret header support.
 */

const ADMIN_SECRET_KEY = "ollama_proxy_admin_secret";

export function getStoredAdminSecret(): string {
  return localStorage.getItem(ADMIN_SECRET_KEY) || "";
}

export function setStoredAdminSecret(secret: string): void {
  if (secret) {
    localStorage.setItem(ADMIN_SECRET_KEY, secret);
  } else {
    localStorage.removeItem(ADMIN_SECRET_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const secret = getStoredAdminSecret();
  const headers: Record<string, string> = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(secret ? { "X-Admin-Secret": secret, Authorization: `Bearer ${secret}` } : {}),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg =
      (data && typeof data === "object" && "error" in data && typeof data.error === "object" && data.error && "message" in data.error)
        ? String(data.error.message)
        : `Request failed with status ${response.status}`;
    throw new ApiError(errorMsg, response.status, data);
  }

  return data as T;
}
