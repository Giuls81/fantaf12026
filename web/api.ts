const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export type Race = {
  id: string;
  name: string;
  country: string | null;
  city: string | null;
  season: number;
  round: number;
  isSprint: boolean;
  qualifyingUtc: string | null;
  sprintQualifyingUtc: string | null;
};

export function getApiUrl() {
  return API_URL;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function health() {
  return apiGet<{ ok: boolean }>("/health");
}

export async function getRaces(): Promise<Race[]> {
  return apiGet<Race[]>("/races");
}
