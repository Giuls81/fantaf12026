export enum Tab {
  HOME = 'HOME',
  TEAM = 'TEAM',
  LINEUP = 'LINEUP',
  MARKET = 'MARKET',
  STANDINGS = 'STANDINGS',
  ADMIN = 'ADMIN',
}

export interface Constructor {
  id: string;
  name: string;
  color: string;
  multiplier: number; // Coefficiente scuderia
}

export interface Driver {
  id: string;
  name: string;
  constructorId: string;
  price: number;
  points: number;
}

export interface Race {
  id: string;
  name: string;
  date: string; // ISO String from API
  isSprint: boolean;
  isCompleted: boolean;
  
  // API Fields
  country?: string | null;
  city?: string | null;
  season?: number;
  round?: number;

  // Session Times (UTC ISO Strings)
  qualifyingUtc: string | null;
  sprintQualifyingUtc: string | null;
  
  // Legacy/Optional (API doesn't return these yet)
  fp1Utc?: string | null;
  fp2Utc?: string | null;
  fp3Utc?: string | null;
  sprintUtc?: string | null;
  raceUtc?: string | null;
}

export interface ScoringRules {
  // Race
  racePositionPoints: number[]; // 1st to 22nd
  raceFastestLap: number; // Keep for compatibility, default 0 or 1
  raceLastPlaceMalus: number; // -3
  
  // Quali Bonuses
  qualiQ1Eliminated: number; // -3 (17th-22nd)
  qualiQ2Reached: number; // +1 (11th-16th)
  qualiQ3Reached: number; // +3 (1st-10th)
  qualiPole: number; // +3
  qualiGridPenalty: number; // -3

  // Race Bonus/Malus
  raceDNF: number; // -5 (Squalificato / non partito / ritirato)
  racePenalty: number; // -5 (In gara o post-gara)

  // Teammate (Race)
  teammateBeat: number; // +2
  teammateLost: number; // -2
  teammateBeatDNF: number; // +1

  // Grid Position
  positionGained: number; // Defaults (Legacy/Combined?)
  positionGainedPos1_10: number; // +1
  positionGainedPos11_Plus: number; // +0.5
  positionLost: number; // Defaults
  positionLostPos1_10: number; // -1
  positionLostPos11_Plus: number; // -0.5

  // Sprint
  sprintPositionPoints: number[]; // 1st to 8th
  sprintPole: number; // +1 (Qualifica Sprint)

  // Constructors
  constructors?: Constructor[]; // Optional for backward compatibility, but should be populated
}

export interface UserTeam {
  name: string;
  driverIds: string[];
  reserveDriverId: string | null;
  captainId: string | null;
  budget: number; // Remaining budget
  totalValue: number; // Drivers value + budget
}

export interface User {
  id: string;
  name: string;
  isAdmin: boolean;
  leagueId: string;
  leagueName?: string;
  leagueCode: string;
}

export interface AppData {
  schemaVersion: number;
  user: User | null;
  team: UserTeam;
  currentRaceIndex: number;
  rules: ScoringRules;
}