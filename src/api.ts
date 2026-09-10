let csrf = "";
let refreshPending: Promise<any> | undefined;
export function refreshSession() {
  if (!refreshPending)
    refreshPending = api("/auth/refresh", { method: "POST" }, false).finally(
      () => {
        refreshPending = undefined;
      },
    );
  return refreshPending;
}

export let accessContext: { consentId?: string; purpose?: string } = {};
export function setContext(c: typeof accessContext) {
  accessContext = c;
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers: Record<string, string> = {
    "X-CSRF-Token": csrf,
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string>),
  };
  if (accessContext.consentId) {
    headers["X-Consent-Id"] = accessContext.consentId;
    headers["X-Purpose"] = accessContext.purpose || "";
  }
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 401 && retry && !path.startsWith("/auth/")) {
    try {
      await refreshSession();
      return api(path, options, false);
    } catch {
      window.dispatchEvent(new Event("g1:session-expired"));
    }
  }
  const data = await response
    .json()
    .catch(() => ({ message: "The server returned an unreadable response" }));
  if (!response.ok)
    throw new Error(
      Array.isArray(data.message)
        ? data.message.join("; ")
        : data.message || "Request failed",
    );
  if (data.csrf) csrf = data.csrf;
  return data;
}
export const post = (path: string, body?: unknown) =>
  api(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export async function downloadSource(id: string) {
  const response = await fetch(`/api/v1/documents/${id}/source`, {
    headers: {
      "X-Consent-Id": accessContext.consentId || "",
      "X-Purpose": accessContext.purpose || "",
    },
    credentials: "same-origin",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const header = response.headers.get("Content-Disposition");
  anchor.download =
    header?.match(/filename="([^"]+)"/)?.[1] || "medical-record";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
