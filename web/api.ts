import { Race, Driver } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:54321/functions/v1/fanta-api";

export function getApiUrl() {
  return API_URL;
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = localStorage.getItem("fantaF1AuthToken");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: any): Promise<T> {
  const token = localStorage.getItem("fantaF1AuthToken");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function health() {
  return apiGet<{ ok: boolean }>("/health");
}

export async function getRaces(): Promise<Race[]> {
  return apiGet<Race[]>("/races");
}

export async function getDrivers(): Promise<Driver[]> {
  return apiGet<Driver[]>("/drivers");
}

// --- Auth & League ---

export async function createAnonUser() {
  return apiPost<{ id: string; authToken: string }>("/auth/anon", {});
}

export async function getMe() {
  // Returns user + leagues (with teams)
  return apiGet<{
    user: { id: string };
    leagues: { 
      id: string; 
      name: string; 
      joinCode: string; 
      role: "ADMIN" | "MEMBER"; 
      isAdmin: boolean;
      team: {
        id: string;
        budget: number;
        captainId: string | null;
        reserveId: string | null;
        driverIds: string[];
      } | null;
    }[];
  }>("/me");
}

export async function createLeague(name: string) {
  return apiPost<{ id: string; name: string; joinCode: string }>("/leagues", { name });
}

export async function joinLeague(joinCode: string) {
  return apiPost<{ leagueId: string; name: string; joinCode: string }>("/leagues/join", { joinCode });
}

export async function updateMarket(leagueId: string, driverIdIn?: string, driverIdOut?: string) {
  return apiPost<{ ok: true; newBudget: number }>("/team/market", { leagueId, driverIdIn, driverIdOut });
}

export async function updateLineup(leagueId: string, captainId?: string | null, reserveId?: string | null) {
  return apiPost<{ ok: true }>("/team/lineup", { leagueId, captainId, reserveId });
}

export async function updateDriverInfo(updates: { id: string; price?: number; points?: number }[]) {
  return apiPost<{ ok: true }>("/admin/drivers", { updates });
}
