import { Race, Driver } from "./types";

const PROD_API = "https://laqjyqfnjnofmvgedunl.supabase.co/functions/v1/fanta-api";
const DEV_API = "http://localhost:54321/functions/v1/fanta-api";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? PROD_API : DEV_API);

export function getApiUrl() {
  return API_URL;
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = localStorage.getItem("fantaF1AuthToken");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(id);

    // If 401 and we sent a token, it might be expired/bad. 
    // Retry once without token (handles public endpoints like /races).
    if (res.status === 401 && token) {
       console.warn("Got 401 with token. Clearing token and retrying...");
       localStorage.removeItem("fantaF1AuthToken");
       // Also clear fantaF1Data to ensure clean state
       localStorage.removeItem("fantaF1Data");
       
       // Retry without auth header
       const retryRes = await fetch(`${API_URL}${path}`, {
         method: "GET",
         headers: { "Content-Type": "application/json" },
       });
       
       if (!retryRes.ok) {
         const text = await retryRes.text().catch(() => "");
         throw new Error(`GET ${path} failed (retry): ${retryRes.status} ${text}`);
       }
       return (await retryRes.json()) as T;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GET ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  } catch (e: any) {
    clearTimeout(id);
    throw e;
  }
}

export async function apiPost<T>(path: string, body: any): Promise<T> {
  const token = localStorage.getItem("fantaF1AuthToken");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(id);

    if (res.status === 401 && token) {
       console.warn("Got 401 on POST. Clearing token.");
       localStorage.removeItem("fantaF1AuthToken");
       localStorage.removeItem("fantaF1Data");
       // Do NOT retry POST automatically as it might require auth.
       // Just let it fail, but token is gone so next time user starts fresh.
       throw new Error(`POST ${path} failed: 401 Invalid Token (Logged out)`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  } catch (e: any) {
    clearTimeout(id);
    throw e;
  }
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

export async function register(name: string, password: string) {
  return apiPost<{ id: string; authToken: string; displayName: string }>("/auth/register", { name, password });
}

export async function login(name: string, password: string) {
  return apiPost<{ id: string; authToken: string; displayName: string }>("/auth/login", { name, password });
}

export async function getMe() {
  // Returns user + leagues (with teams)
  return apiGet<{
    user: { id: string; name: string };
    leagues: { 
      id: string; 
      name: string; 
      joinCode: string; 
      role: "ADMIN" | "MEMBER"; 
      isAdmin: boolean;
      members: { userId: string; userName: string; role: "ADMIN" | "MEMBER"; teamId?: string }[]; // Added
      team: {
        id: string;
        name: string;
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

export async function updateTeamName(leagueId: string, name: string) {
  return apiPost<{ ok: true; name: string }>("/team/update", { leagueId, name });
}

export async function migrateTeamName() {
  return apiPost<{ ok: true; message: string }>("/admin/migrate-team-name", {});
}

export async function syncRaceResults(raceId: string) {
  return apiPost<{ ok: true; classification: Record<string, number>; points: Record<string, number> }>("/admin/sync-race", { raceId });
}

export async function kickMember(leagueId: string, userId: string) {
  return apiPost<{ ok: true }>("/league/kick", { leagueId, userId });
}

export async function deleteLeague(leagueId: string) {
  return apiPost<{ ok: true }>("/league/delete", { leagueId });
}

export async function addPenalty(leagueId: string, teamId: string, points: number, comment: string) {
  return apiPost<{ ok: true }>("/league/penalty", { leagueId, teamId, points, comment });
}

export async function getLeagueStandings(leagueId: string) {
  return apiGet<{ userId: string; userName: string; totalPoints: number; rank: number }[]>(`/leagues/${leagueId}/standings`);
}

export async function getRaceResults(leagueId: string, raceId: string) {
  return apiGet<{ userId: string; userName: string; points: number; captainId: string; reserveId: string; drivers: { id: string; name: string; points: number }[] }[]>(`/leagues/${leagueId}/results/${raceId}`);
}

export async function updateLeagueRules(leagueId: string, rules: any) {
  return apiPost<{ ok: true }>("/league/rules", { leagueId, rules });
}
