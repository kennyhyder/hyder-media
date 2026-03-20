const AUTH_KEY = "gridscout_auth";
const TOKEN_KEY = "gridscout_demo_token";

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(AUTH_KEY) === "demo";
}

export function getDemoToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function withDemoToken(url: string): string {
  const token = getDemoToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}demo_token=${encodeURIComponent(token)}`;
}
