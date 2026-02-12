import React, { useState, useEffect } from 'react';
import ErrorBoundary from './ErrorBoundary';
import Layout from './components/Layout';
import { initializeAdMob, showAppOpen, prepareRewardVideo, showRewardVideo } from './services/admob';
import { AdBanner } from './components/AdBanner';
import { AppData, Tab, UserTeam, Driver, Race, User, ScoringRules } from './types';
import { DEFAULT_SCORING_RULES, DRIVERS, CONSTRUCTORS } from './constants';
import { health, getRaces, getDrivers, register, login, createLeague, joinLeague, getMe, updateMarket, updateLineup, updateDriverInfo, updateTeamName, getApiUrl, syncRaceResults, getLeagueStandings, getRaceResults, kickMember, deleteLeague, addPenalty, updateLeagueRules } from "./api";
// RACES_2026 removed

const INITIAL_TEAM: UserTeam = {
  name: 'My F1 Team',
  driverIds: [],
  reserveDriverId: null,
  captainId: null,
  budget: 100.0,
  totalValue: 100.0,
};

const INITIAL_DATA: AppData = {
  schemaVersion: 1,
  user: null,
  team: INITIAL_TEAM,
  currentRaceIndex: 0,
  rules: DEFAULT_SCORING_RULES,
};

type LockStatus = 'unconfigured' | 'open' | 'closing_soon' | 'locked';

interface LockState {
  status: LockStatus;
  targetSessionUtc: string | null;
  lockTimeUtc: string | null;
  msToLock: number | null;
}

// Helper to enforce Captain/Reserve invariants
const sanitizeTeamRoles = (team: UserTeam): UserTeam => {
  let { driverIds, captainId, reserveDriverId } = team;

  // 1. Ensure Captain is in the team
  if (captainId && !driverIds.includes(captainId)) {
    captainId = null;
  }

  // 2. Ensure Reserve is in the team
  if (reserveDriverId && !driverIds.includes(reserveDriverId)) {
    reserveDriverId = null;
  }

  // 3. Auto-assign Captain if missing and we have drivers (Handles first assignment)
  if (!captainId && driverIds.length > 0) {
    captainId = driverIds[0];
  }

  // 4. Force Reserve null if fewer than 2 drivers
  if (driverIds.length < 2) {
    reserveDriverId = null;
  }

  // 5. When team reaches 5 drivers, auto-assign Reserve if missing
  if (driverIds.length === 5 && !reserveDriverId) {
    // Last driver in the list (but not the captain)
    const candidate = [...driverIds].reverse().find(id => id !== captainId);
    if (candidate) reserveDriverId = candidate;
  }

  // 6. Conflict: Captain cannot be Reserve (Keep Captain, clear Reserve)
  if (captainId && reserveDriverId && captainId === reserveDriverId) {
    reserveDriverId = null;
    // Try to re-assign reserve if full team
    if (driverIds.length === 5) {
      const candidate = [...driverIds].reverse().find(id => id !== captainId);
      if (candidate) reserveDriverId = candidate;
    }
  }

  return {
    ...team,
    captainId,
    reserveDriverId
  };
};

// Helper to find next race index
const getNextRaceIndex = (races: Race[]) => {
  if (races.length === 0) return 0; // Never return -1
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const idx = races.findIndex(r => new Date(r.date) >= today);
  return idx === -1 ? races.length - 1 : idx;
};

type LangCode = 'en' | 'it' | 'fr' | 'de' | 'es' | 'ru' | 'zh' | 'ar' | 'ja';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.HOME);
  const [isPremium, setIsPremium] = useState(false); // Premium State
  const [data, setData] = useState<AppData | null>(null);
  const [swapCandidate, setSwapCandidate] = useState<Driver | null>(null);
  const [now, setNow] = useState(Date.now());
  const [races, setRaces] = useState<Race[]>([]);
  const [fetchedDrivers, setFetchedDrivers] = useState<Driver[]>([]);
  const [leagueMembers, setLeagueMembers] = useState<any[]>([]); // Added for Admin
  const [adminUpdates, setAdminUpdates] = useState<Record<string, { price: number; points: number }>>({});

  // Initial AdMob & Premium Check
  useEffect(() => {
    (async () => {
      try {
        await initializeAdMob();
        await prepareRewardVideo(); // Pre-load reward video
        const savedPremium = localStorage.getItem('fantaF1Premium');
        if (savedPremium === 'true') {
           // Check expiry if we store it? For now 'true' is permanent from debug, need new key for temp
           const expiry = localStorage.getItem('fantaF1PremiumExpiry');
           if (expiry && Date.now() > Number(expiry)) {
              setIsPremium(false);
              localStorage.removeItem('fantaF1Premium');
              localStorage.removeItem('fantaF1PremiumExpiry');
           } else {
              setIsPremium(true);
           }
        } else {
           setTimeout(() => showAppOpen(), 2000);
        }
      } catch (e) { console.error(e); }
    })();
  }, []);

  // Save Premium State
  useEffect(() => {
    localStorage.setItem('fantaF1Premium', String(isPremium));
  }, [isPremium]);

  // 1. Initial Load (races + drivers)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingStatus("Fetching API (Races/Drivers)...");
        // Timeout wrapper for Promise.all
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("API Timeout")), 15000)
        );

        const racePromise = Promise.all([getRaces(), getDrivers()]);
        
        // Race the API against 15s timeout
        const [apiRaces, apiDrivers] = await Promise.race([racePromise, timeoutPromise]) as [Race[], Driver[]];
        
        if (apiRaces.length === 0) {
          setStartupError("API returned 0 races. Database empty?");
          setLoadingStatus("Error: No Races");
        } else {
          setLoadingStatus("API Data Loaded");
          if (alive) {
            setRaces(apiRaces);
            setFetchedDrivers(apiDrivers);
          }
        }
      } catch (e: any) {
        console.error("API load failed", e);
        setStartupError(`API Fail: ${e.message}`);
        setLoadingStatus("Error: API Failed");
      }
    })();
    return () => { alive = false; };
  }, []);

  const [language, setLanguage] = useState<LangCode>('en');
  const [showLangMenu, setShowLangMenu] = useState(false);

  // Admin Draft States
  const [qualifyingUtcDraft, setQualifyingUtcDraft] = useState('');
  const [sprintQualifyingUtcDraft, setSprintQualifyingUtcDraft] = useState('');

  // Admin Points Anti-NaN States
  const [pointsError, setPointsError] = useState<{ [key: string]: string }>({});
  const [syncing, setSyncing] = useState(false);

  const [showDebug, setShowDebug] = useState(false);
  
  // Standings & History States
  const [standings, setStandings] = useState<any[]>([]);
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);
  const [raceResults, setRaceResults] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [viewingResult, setViewingResult] = useState<any | null>(null);

  // Fetch Standings
  useEffect(() => {
    if (activeTab === Tab.STANDINGS && data?.user?.leagueId) {
      setLoadingStandings(true);
      getLeagueStandings(data.user.leagueId)
        .then(setStandings)
        .catch(e => console.error("Failed to load standings", e))
        .finally(() => setLoadingStandings(false));
    }
  }, [activeTab, data?.user?.leagueId]);

  // Fetch Race Results
  useEffect(() => {
    if (selectedRaceId && data?.user?.leagueId) {
       setLoadingResults(true);
       getRaceResults(data.user.leagueId, selectedRaceId)
        .then(setRaceResults)
        .catch(e => console.error("Failed to load results", e))
        .finally(() => setLoadingResults(false));
    }
  }, [selectedRaceId, data?.user?.leagueId]);

  // Login Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(true); // Toggle between Register and Login
  const [loginMode, setLoginMode] = useState<'create' | 'join'>('create');
  const [leagueName, setLeagueName] = useState('');
  const [leagueCodeInput, setLeagueCodeInput] = useState('');

  // UI State
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isEditingTeamName, setIsEditingTeamName] = useState(false);
  const [teamNameEdit, setTeamNameEdit] = useState("");
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [startupError, setStartupError] = useState("");
  
  // Timer for countdown
  useEffect(() => {
    (window as any)._mountTime = Date.now();
    const interval = setInterval(() => {
       const n = Date.now();
       setNow(n);
       // Log every 5s to check thread aliveness (visible in xCode logs or Safari inspector)
       if (n % 5000 < 1000) console.log("Tick", n);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load language
  useEffect(() => {
    const storedLang = localStorage.getItem('fantaF1Lang');
    if (storedLang && ['en', 'it', 'fr', 'de', 'es', 'ru', 'zh', 'ar', 'ja'].includes(storedLang)) {
      setLanguage(storedLang as LangCode);
    }
  }, []);

  // Save language and set Direction
  useEffect(() => {
    localStorage.setItem('fantaF1Lang', language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  // Session Restoration (Auto-Login)
  useEffect(() => {
    const token = localStorage.getItem('fantaF1AuthToken');
    if (!token) {
       // Clear deprecated data if no token
       return; 
    }
    
    // CRITICAL FIX: Do not attempt restore until races are loaded
    // Otherwise we calculate index based on empty array -> -1 -> Crash
    if (races.length === 0) {
      setLoadingStatus("Waiting for Races...");
      return; 
    }

    (async () => {
      try {
        setLoadingStatus("Restoring Session...");
        const { user, leagues } = await getMe();
          const firstLeague = leagues[0];
          
          if (firstLeague && firstLeague.members) {
             setLeagueMembers(firstLeague.members);
          }

          // If no league (e.g. user created but league creation failed), user needs to create/join one.
          // For simplicity, we assume if they have a token they are good, but we might need a "No League" UI state.
          // If leagues empty, we reset? Or show create league UI?
          if (!firstLeague) {
             console.warn("User has no leagues. Resetting to force login/league creation.");
             throw new Error("no_leagues"); 
          }

          const fullUser: User = {
            id: user.id,
            name: user.name || 'Player', 
            isAdmin: firstLeague.isAdmin,
            leagueId: firstLeague.id,
            leagueName: firstLeague.name,
            leagueCode: firstLeague.joinCode
          };

          // Re-sync team data from backend if available
          const serverTeam: UserTeam = firstLeague.team ? {
             name: 'My F1 Team',
             driverIds: firstLeague.team.driverIds,
             budget: firstLeague.team.budget,
             captainId: firstLeague.team.captainId,
             reserveDriverId: firstLeague.team.reserveId,
             totalValue: calculateTotalValue(firstLeague.team.budget, firstLeague.team.driverIds)
          } : INITIAL_TEAM;
          
          setData(prev => {
             const base = prev || { ...INITIAL_DATA, currentRaceIndex: getNextRaceIndex(races) };
             return { ...base, user: fullUser, team: serverTeam };
          });
      } catch (e) {
        console.error("Session restore failed", e);
        // Invalid token? Log out
        localStorage.removeItem('fantaF1AuthToken');
        // Ensure data is set to initial so login screen appears
        const freshData = { ...INITIAL_DATA, currentRaceIndex: 0 };
        setData(freshData);
      }
    })();
  }, [races]); // Depend on races to ensure index calc is correct if needed

  // 3. Standings & Results Fetching
  useEffect(() => {
    if (activeTab === Tab.STANDINGS && data?.user?.leagueId) {
       fetchStandings();
    }
  }, [activeTab]);

  const fetchStandings = async () => {
    if (!data?.user?.leagueId) return;
    try {
      setLoadingStandings(true);
      const res = await fetch(`${getApiUrl()}/leagues/${data.user.leagueId}/standings`, {
         headers: { 'Authorization': `Bearer ${localStorage.getItem('fantaF1AuthToken')}` }
      });
      const list = await res.json();
      setStandings(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStandings(false);
    }
  };

  const fetchRaceResults = async (raceId: string) => {
    if (!data?.user?.leagueId) return;
    try {
      setLoadingResults(true);
      const res = await fetch(`${getApiUrl()}/leagues/${data.user.leagueId}/results/${raceId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('fantaF1AuthToken')}` }
      });
      const list = await res.json();
      setRaceResults(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingResults(false);
    }
  };

  useEffect(() => {
    if (selectedRaceId) {
      fetchRaceResults(selectedRaceId);
    } else {
      setRaceResults([]);
    }
  }, [selectedRaceId]);

  // Translation Helper
  const t = (dict: { [key: string]: string }) => {
    return dict[language] || dict['en'] || '';
  };

  // NOTE: The separate useEffect for loading races from localStorage has been removed
  // to avoid overwriting the API call in the main useEffect above.

  // Load data from localStorage on mount (Wait for races to be loaded!)
  useEffect(() => {
    // If races failed to load, we still might want to show login or use empty races
    // if (races.length === 0) return; // Wait for API -> This blocks everything if API fails!
    
    if (data) return; // Already loaded

    const storedData = localStorage.getItem('fantaF1Data');
    if (storedData) {
      try {
        const parsed = JSON.parse(storedData);
        // Robustness checks
        if (typeof parsed.currentRaceIndex !== 'number' || parsed.currentRaceIndex < 0) {
          parsed.currentRaceIndex = getNextRaceIndex(races);
        } else {
          // Re-validate against current races length
          if (races.length > 0 && parsed.currentRaceIndex >= races.length) {
            parsed.currentRaceIndex = races.length - 1;
          }
        }
        // Migration for constructors if missing in rules
        if (!parsed.rules.constructors) {
          parsed.rules.constructors = CONSTRUCTORS;
        }
        // Migration for schemaVersion
        if (!parsed.schemaVersion || typeof parsed.schemaVersion !== 'number') {
          parsed.schemaVersion = 1;
        }
        setData(parsed);
      } catch (e) {
        console.error("Failed to parse local storage data", e);
        // Recalculate index based on real races
        const freshData = { ...INITIAL_DATA, currentRaceIndex: getNextRaceIndex(races) };
        setData(freshData);
      }
    } else {
       // Recalculate index based on real races
       const freshData = { ...INITIAL_DATA, currentRaceIndex: getNextRaceIndex(races) };
       setData(freshData);
    }
  }, [races]);

  // Sync Drafts... (omitted for brevity, assume unchanged logic here)
  useEffect(() => {
    if (data && races.length > 0) {
      const race = races[data.currentRaceIndex] || races[0];
      if (race) {
        setQualifyingUtcDraft(race.qualifyingUtc || '');
        setSprintQualifyingUtcDraft(race.sprintQualifyingUtc || '');
      }
    }
  }, [data?.currentRaceIndex, races, activeTab]);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    if (data && data.user) {
      localStorage.setItem('fantaF1Data', JSON.stringify(data));
    }
  }, [data]);

  const handleAuth = async () => {
    if (!username.trim()) return alert(t({ en: "Please enter a username.", it: "Inserisci un nome utente." }));
    if (!password.trim()) return alert(t({ en: "Please enter a password.", it: "Inserisci una password." }));

    try {
      let authToken = '';

      if (isRegistering) {
         // 1. Register
         const res = await import("./api").then(m => m.register(username.trim(), password));
         authToken = res.authToken;
         localStorage.setItem('fantaF1AuthToken', authToken);

         // 2. Create or Join League
         if (loginMode === 'create') {
            if (!leagueName.trim()) return alert(t({ en: "Please enter a league name.", it: "Inserisci il nome della lega." }));
            await createLeague(leagueName.trim());
         } else {
            if (!leagueCodeInput.trim() || leagueCodeInput.length < 6) return alert(t({ en: "Please enter a valid 6-character league code.", it: "Inserisci un codice lega valido di 6 caratteri." }));
            await joinLeague(leagueCodeInput.trim().toUpperCase());
         }

      } else {
         // 1. Login
         const res = await import("./api").then(m => m.login(username.trim(), password));
         authToken = res.authToken;
         localStorage.setItem('fantaF1AuthToken', authToken);
         // No need to create/join league, user should already have one. 
         // But what if they don't? Logic below handles "Refresh Me".
      }

      // 3. Refresh Me (to get User object with League info)
      const { user, leagues } = await getMe();
      const myLeague = leagues[0];

      if (myLeague && myLeague.members) {
         setLeagueMembers(myLeague.members);
      }
      
      if (!myLeague) {
          // Edge case: User logged in but has no league? 
          // We might need to handle this by keeping them on a "Join/Create League" screen.
          // For now, assume data integrity.
          alert(t({ en: "No league found for this user. Please register again.", it: "Nessuna lega trovata per questo utente. Registrati di nuovo." }));
          localStorage.removeItem('fantaF1AuthToken');
          return;
      }

      const newUser: User = {
        id: user.id,
        name: username.trim(), 
        isAdmin: myLeague.isAdmin,
        leagueId: myLeague.id,
        leagueName: myLeague.name,
        leagueCode: myLeague.joinCode
      };

      const serverTeam: UserTeam = myLeague.team ? {
        name: myLeague.team.name || 'My F1 Team',
        driverIds: myLeague.team.driverIds,
        budget: myLeague.team.budget,
        captainId: myLeague.team.captainId,
        reserveDriverId: myLeague.team.reserveId,
        totalValue: calculateTotalValue(myLeague.team.budget, myLeague.team.driverIds)
      } : INITIAL_TEAM;

      // Auto-select next race
      const nextRaceIndex = getNextRaceIndex(races);

      setData({
        ...INITIAL_DATA,
        user: newUser,
        team: serverTeam,
        currentRaceIndex: nextRaceIndex
      });
      setActiveTab(Tab.HOME);

    } catch (e: any) {
      console.error(e);
      let msg = t({ en: "Authentication failed.", it: "Autenticazione fallita." });
      
      if (e.message && e.message.includes("name_taken")) {
        msg = t({ en: "Name already taken. Log in instead?", it: "Nome già in uso. Prova il Login." });
      } else if (e.message && e.message.includes("invalid_credentials")) {
         msg = t({ en: "Invalid username or password.", it: "Nome utente o password errati." });
      } else if (e.message && e.message.includes("league_not_found")) {
        msg = t({ en: "League not found. Check the code.", it: "Lega non trovata. Controlla il codice." });
      } else if (e.message && e.message.includes("weak_password")) {
         msg = t({ en: "Password too short (min 3 chars).", it: "Password troppo corta (min 3 caratteri)." });
      } 
      
      alert(msg);
      // Clean up token if partial failure
      if (localStorage.getItem('fantaF1AuthToken')) {
          // localStorage.removeItem('fantaF1AuthToken'); // Maybe don't clear immediate, user might want to retry league code
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('fantaF1Data');
    localStorage.removeItem('fantaF1Races');
    localStorage.removeItem('fantaF1AuthToken'); // Clear token
    setData({ ...INITIAL_DATA, currentRaceIndex: getNextRaceIndex(races) });
    setRaces(races); // Keep API races
    setActiveTab(Tab.HOME);
    // Reset form state
    setUsername('');
    setPassword('');
    setLeagueName('');
    setLeagueCodeInput('');
    setLoginMode('create');
    setIsRegistering(true);
    setShowResetConfirm(false);
    setShowDebug(false);
  };

  const calculateTotalValue = (budget: number, driverIds: string[]) => {
    const driversValue = driverIds.reduce((sum, id) => {
      const d = DRIVERS.find(drv => drv.id === id);
      return sum + (d?.price || 0);
    }, 0);
    return budget + driversValue;
  };

  const handleBuyDriver = async (driver: Driver) => {
    if (!data?.user) return;
    try {
      await updateMarket(data.user.leagueId, driver.id, undefined);
      const updatedData = await getMe();
      const league = updatedData.leagues.find(l => l.id === data.user?.leagueId);
      if (league?.team) {
         setData({
            ...data,
            team: {
               ...data.team,
               budget: league.team.budget,
               driverIds: league.team.driverIds,
               captainId: league.team.captainId,
               reserveDriverId: league.team.reserveId,
               totalValue: calculateTotalValue(league.team.budget, league.team.driverIds)
            }
         });
      }
    } catch (e) {
      console.error(e);
      alert(t({ en: 'Failed to buy driver.', it: 'Acquisto pilota fallito.' }));
    }
  };

  const handleSwapDriver = async (oldD: Driver, newD: Driver) => {
    if (!data?.user) return;
    try {
      await updateMarket(data.user.leagueId, newD.id, oldD.id);
      const updatedData = await getMe();
      const league = updatedData.leagues.find(l => l.id === data.user?.leagueId);
      if (league?.team) {
         setData({
            ...data,
            team: {
               ...data.team,
               budget: league.team.budget,
               driverIds: league.team.driverIds,
               captainId: league.team.captainId,
               reserveDriverId: league.team.reserveId,
               totalValue: calculateTotalValue(league.team.budget, league.team.driverIds)
            }
         });
      }
      setSwapCandidate(null);
    } catch (e) {
      console.error(e);
      alert(t({ en: 'Failed to swap driver.', it: 'Scambio pilota fallito.' }));
    }
  };

  const isValidUtc = (val: string) => {
    if (!val) return false;
    const d = new Date(val);
    return !isNaN(d.getTime()) && val.endsWith('Z');
  };

  const handleSaveQuali = async () => {
    if (!data) return;
    if (!isValidUtc(qualifyingUtcDraft)) return;
    const newRaces = [...races];
    newRaces[data.currentRaceIndex] = {
      ...newRaces[data.currentRaceIndex],
      qualifyingUtc: qualifyingUtcDraft.trim()
    };
    setRaces(newRaces);
  };

  const handleSaveSprint = async () => {
    if (!data) return;
    if (!isValidUtc(sprintQualifyingUtcDraft)) return;
    const newRaces = [...races];
    newRaces[data.currentRaceIndex] = {
      ...newRaces[data.currentRaceIndex],
      sprintQualifyingUtc: sprintQualifyingUtcDraft.trim()
    };
    setRaces(newRaces);
  };

  const handleTestTime = (offsetMinutes: number, isSprintField: boolean) => {
    if (!data) return;
    const target = new Date(Date.now() + offsetMinutes * 60 * 1000).toISOString();
    const newRaces = [...races];
    if (isSprintField) {
      newRaces[data.currentRaceIndex] = { ...newRaces[data.currentRaceIndex], sprintQualifyingUtc: target };
      setSprintQualifyingUtcDraft(target);
    } else {
      newRaces[data.currentRaceIndex] = { ...newRaces[data.currentRaceIndex], qualifyingUtc: target };
      setQualifyingUtcDraft(target);
    }
    setRaces(newRaces);
  };

  const handleRuleChange = (key: keyof ScoringRules, val: any) => {
    if (!data) return;
    setData({
      ...data,
      rules: { ...data.rules, [key]: val }
    });
  };

  const handleRacePointChange = (index: number, val: number) => {
    if (!data) return;
    if (!Number.isFinite(val)) return;
    const newPoints = [...(data.rules.racePositionPoints || Array(22).fill(0))];
    newPoints[index] = val;
    handleRuleChange('racePositionPoints', newPoints);
  };

  const handleSprintSinglePointChange = (index: number, val: number) => {
    if (!data) return;
    if (!Number.isFinite(val)) return;
    const newPoints = [...(data.rules.sprintPositionPoints || Array(8).fill(0))];
    newPoints[index] = val;
    handleRuleChange('sprintPositionPoints', newPoints);
  };

  const handleConstructorMultiplierChange = (id: string, multiplier: number) => {
    if (!data) return;
    const currentConstructors = data.rules.constructors || CONSTRUCTORS;
    const newConstructors = currentConstructors.map(c =>
      c.id === id ? { ...c, multiplier } : c
    );
    handleRuleChange('constructors', newConstructors);
  };

  const getLockStatus = (race: Race, currentTime: number): LockState => {
    const targetStr = race.isSprint ? race.sprintQualifyingUtc : race.qualifyingUtc;
    if (!targetStr || targetStr === 'TODO_UTC') {
      return { status: 'unconfigured', targetSessionUtc: null, lockTimeUtc: null, msToLock: null };
    }
    const targetDate = new Date(targetStr);
    if (isNaN(targetDate.getTime())) {
      return { status: 'unconfigured', targetSessionUtc: targetStr, lockTimeUtc: null, msToLock: null };
    }
    const lockDate = new Date(targetDate.getTime() - 5 * 60 * 1000); // 5 mins before
    const msToLock = lockDate.getTime() - currentTime;
    let status: LockStatus = 'open';
    if (msToLock <= 0) {
      status = 'locked';
    } else if (msToLock <= 30 * 60 * 1000) {
      status = 'closing_soon';
    }
    return {
      status,
      targetSessionUtc: targetDate.toISOString(),
      lockTimeUtc: lockDate.toISOString(),
      msToLock
    };
  };

  const handleSyncOpenF1 = async () => {
    if (!data) return;
    const currentRace = races[data.currentRaceIndex];
    if (!currentRace) return;
    
    try {
      setSyncing(true);
      const result = await syncRaceResults(currentRace.id);
      if (result.ok) {
        alert(t({ en: 'Race synced successfully!', it: 'Gara sincronizzata con successo!' }));
        window.location.reload();
      } else {
        alert(t({ en: `Sync failed`, it: `Sincronizzazione fallita` }));
      }
    } catch (e) {
      console.error(e);
      alert(t({ en: 'Network error during sync', it: 'Errore di rete durante la sincronizzazione' }));
    } finally {
      setSyncing(false);
    }
  };

  const renderStandings = () => {
    const completedRaces = races.filter(r => r.isCompleted).sort((a,b) => b.round - a.round);
    
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
           <span className="text-3xl">🏆</span> {t({ en: 'Standings', it: 'Classifica' })}
        </h1>

        {/* Global Standings Card */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
           <div className="bg-slate-700/50 p-3 border-b border-slate-700 font-bold text-xs uppercase tracking-widest text-slate-300">
              {t({ en: 'Global Rankings', it: 'Classifica Globale' })}
           </div>
           {loadingStandings ? (
             <div className="p-8 text-center text-slate-500 animate-pulse">{t({ en: 'Loading standings...', it: 'Caricamento classifica...' })}</div>
           ) : (
             <div className="divide-y divide-slate-700">
                {standings.map((s, idx) => (
                   <div key={s.userId} className={`p-4 flex justify-between items-center ${s.userId === data?.user?.id ? 'bg-blue-900/10' : ''}`}>
                      <div className="flex items-center gap-4">
                         <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${idx === 0 ? 'bg-yellow-500 text-black' : idx === 1 ? 'bg-slate-300 text-black' : idx === 2 ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                            {s.rank}
                         </div>
                         <div>
                            <div className="text-white font-bold">{s.userName} {s.userId === data?.user?.id && <span className="text-[10px] bg-blue-500 text-white px-1 rounded ml-1">TU</span>}</div>
                            <div className="text-[10px] text-slate-500 uppercase font-bold">{t({ en: 'Total Points', it: 'Punti Totali' })}</div>
                         </div>
                      </div>
                      <div className="text-right">
                         <div className="text-xl font-mono font-bold text-blue-400">{s.totalPoints}</div>
                      </div>
                   </div>
                ))}
                {standings.length === 0 && <div className="p-8 text-center text-slate-500 italic">{t({ en: 'No users found in this league.', it: 'Nessun utente trovato in questa lega.' })}</div>}
             </div>
           )}
        </div>

        {/* Race Results / History Section */}
        <div className="space-y-4">
           <h2 className="text-lg font-bold text-slate-400 uppercase tracking-wider px-1">{t({ en: 'Historical Results', it: 'Risultati Storici' })}</h2>
           
           {/* Race Filter */}
           <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
              <button 
                onClick={() => setSelectedRaceId(null)}
                className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all border ${!selectedRaceId ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
              >
                {t({ en: 'Overall', it: 'Generale' })}
              </button>
              {completedRaces.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRaceId(r.id)}
                  className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all border ${selectedRaceId === r.id ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                >
                  {r.name.replace(' Grand Prix', '')}
                </button>
              ))}
           </div>

           {/* Selected Race Results List */}
           {selectedRaceId && (
              <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-2">
                 <div className="bg-slate-700/50 p-3 border-b border-slate-700 flex justify-between items-center">
                    <span className="font-bold text-xs uppercase tracking-widest text-slate-300">
                       {races.find(r => r.id === selectedRaceId)?.name}
                    </span>
                    {loadingResults && <div className="w-3 h-3 border-2 border-slate-400 border-t-white rounded-full animate-spin"></div>}
                 </div>
                 <div className="divide-y divide-slate-700">
                    {raceResults.map((r) => (
                      <div key={r.userId} className="p-4 flex justify-between items-center group">
                         <div className="flex items-center gap-4">
                            <div>
                               <div className="text-white font-bold">{r.userName}</div>
                               <div className="text-[10px] text-slate-500 uppercase font-bold">{t({ en: 'Race Score', it: 'Punti Gara' })}</div>
                            </div>
                         </div>
                         <div className="flex items-center gap-4">
                            <div className="text-right">
                               <div className="text-lg font-mono font-bold text-green-400">+{r.points}</div>
                            </div>
                            <button 
                              onClick={() => setViewingResult(r)}
                              className="bg-slate-700 hover:bg-slate-600 text-slate-100 p-2 rounded-lg transition-colors border border-slate-600"
                            >
                               🔍
                            </button>
                         </div>
                      </div>
                    ))}
                    {raceResults.length === 0 && !loadingResults && <div className="p-8 text-center text-slate-500 italic">{t({ en: 'No results stored for this race yet.', it: 'Nessun risultato salvato per questa gara.' })}</div>}
                 </div>
              </div>
           )}
        </div>

        {/* Modal: Result/Lineup Details */}
        {viewingResult && (
           <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setViewingResult(null)}>
              <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl p-6 overflow-y-auto max-h-[80vh]" onClick={e => e.stopPropagation()}>
                 <div className="flex justify-between items-center mb-6">
                    <div>
                       <h3 className="text-xl font-bold text-white">{viewingResult.userName}</h3>
                       <p className="text-slate-400 text-sm">{selectedRaceId ? races.find(r => r.id === selectedRaceId)?.name : ''}</p>
                    </div>
                    <button onClick={() => setViewingResult(null)} className="text-slate-500 hover:text-white text-2xl">&times;</button>
                 </div>

                 <div className="space-y-3">
                    {viewingResult.drivers.length > 0 ? (
                      viewingResult.drivers.map((d: any) => {
                         const isCaptain = viewingResult.captainId === d.id;
                         const isReserve = viewingResult.reserveId === d.id;
                         return (
                           <div key={d.id} className={`bg-slate-800 p-3 rounded-xl border ${isCaptain ? 'border-yellow-500' : isReserve ? 'border-green-500' : 'border-slate-700'} flex justify-between items-center`}>
                              <div className="flex items-center gap-3">
                                 <div className="text-lg">🏎️</div>
                                 <div className="flex-1">
                                    <div className="text-white font-bold text-sm">
                                       {d.name} 
                                       {isCaptain && <span className="text-[8px] bg-yellow-500 text-black px-1 rounded ml-1">CPT</span>}
                                       {isReserve && <span className="text-[8px] bg-green-500 text-black px-1 rounded ml-1">RES</span>}
                                    </div>
                                 </div>
                              </div>
                              <div className="text-right">
                                 <div className="text-blue-400 font-mono font-bold text-sm">+{d.points}</div>
                              </div>
                           </div>
                         );
                      })
                    ) : (
                      <div className="p-8 text-center text-slate-500 italic bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                         {t({ 
                           en: 'Lineup hidden. Results can be viewed once the race is completed.', 
                           it: 'Formazione nascosta. Potrai vederla quando la gara sarà completata.' 
                         })}
                      </div>
                    )}
                    
                    <div className="bg-blue-600/10 border border-blue-600/30 p-4 rounded-xl mt-4 flex justify-between items-center">
                       <span className="text-slate-300 font-bold text-sm capitalize">{t({ en: 'Total Score', it: 'Punteggio Totale' })}</span>
                       <span className="text-2xl font-mono font-bold text-white">{viewingResult.points}</span>
                    </div>
                 </div>

                 <button 
                   onClick={() => setViewingResult(null)}
                   className="w-full mt-6 bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl border border-slate-700 transition-colors"
                 >
                    Close
                 </button>
              </div>
           </div>
        )}
      </div>
    );
  };

  const formatCountdown = (ms: number) => {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSetCaptain = async (driverId: string) => {
    if (!data?.user) return;
    const currentRace = races[data.currentRaceIndex];
    const lockState = getLockStatus(currentRace, now);
    if (lockState.status === 'locked') return;

    let newCaptainId = driverId;
    let newReserveId = data.team.reserveDriverId;
    const oldCaptainId = data.team.captainId;

    if (newReserveId === driverId) {
      newReserveId = oldCaptainId;
    }

    try {
      // Optimistic Update or wait for API? Let's do Wait + Sync for safety with lock
      await updateLineup(data.user.leagueId, newCaptainId, newReserveId);
      
      setData({
        ...data,
        team: {
          ...data.team,
          captainId: newCaptainId,
          reserveDriverId: newReserveId
        }
      });
    } catch (e) {
       console.error(e);
       alert(t({ en: "Failed to update lineup.", it: "Aggiornamento formazione fallito." }));
    }
  };

  const handleSetReserve = async (driverId: string) => {
    if (!data?.user) return;
    const currentRace = races[data.currentRaceIndex];
    const lockState = getLockStatus(currentRace, now);
    if (lockState.status === 'locked') return;

    let newReserveId = driverId;
    let newCaptainId = data.team.captainId;
    const oldReserveId = data.team.reserveDriverId;

    if (newCaptainId === driverId) {
      if (oldReserveId) {
        newCaptainId = oldReserveId;
      } else {
        const other = data.team.driverIds.find(d => d !== driverId);
        newCaptainId = other || null;
      }
    }

    try {
      await updateLineup(data.user.leagueId, newCaptainId, newReserveId);
      setData({
        ...data,
        team: {
          ...data.team,
          captainId: newCaptainId,
          reserveDriverId: newReserveId
        }
      });
    } catch (e) {
       console.error(e);
       alert(t({ en: "Failed to update lineup.", it: "Aggiornamento formazione fallito." }));
    }
  };

  const handleSellDriver = async (driver: Driver) => {
    if (!data?.user) return;
    if (!confirm(t({ en: `Sell ${driver.name} for $${driver.price}M?`, it: `Vendere ${driver.name} per ${driver.price}M?` }))) return;

    try {
      await updateMarket(data.user.leagueId, undefined, driver.id);
      const updatedData = await getMe();
      const league = updatedData.leagues.find(l => l.id === data.user?.leagueId);
      if (league?.team) {
         setData({
            ...data,
            team: {
               ...data.team,
               budget: league.team.budget,
               driverIds: league.team.driverIds,
               captainId: league.team.captainId,
               reserveDriverId: league.team.reserveId,
               totalValue: calculateTotalValue(league.team.budget, league.team.driverIds)
            }
         });
      }
    } catch (e) {
      console.error(e);
      alert(t({ en: 'Failed to sell driver.', it: 'Vendita pilota fallita.' }));
    }
  };

  // --------------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------------

  // ... (omitted LangMenu) ...

  // Inside Market Tab Render loop (approx line 1534 in original)
  /* 
     This replacement implementation assumes I can target the insertion point for handleSellDriver
     and the UI button replacement in one go or separate.
     Since I can't easily jump, I will insert the function first.
  */


  const LangMenu = (
    <div className="fixed top-0 right-4 z-50 flex flex-col items-end pt-[env(safe-area-inset-top,1rem)]">
      <button
        onClick={() => setShowLangMenu(!showLangMenu)}
        className="bg-slate-700/80 backdrop-blur text-white px-3 py-1 rounded-full text-xs font-bold border border-slate-600 hover:bg-slate-600 shadow-lg"
      >
        {language.toUpperCase()}
      </button>
      {showLangMenu && (
        <div className="mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden flex flex-col max-h-64 overflow-y-auto">
          {['en', 'it', 'fr', 'de', 'es', 'ru', 'zh', 'ar', 'ja'].map((lang) => (
            <button
              key={lang}
              onClick={() => {
                setLanguage(lang as LangCode);
                setShowLangMenu(false);
              }}
              className={`px-4 py-2 text-xs font-bold uppercase text-left hover:bg-slate-700 flex items-center justify-between min-w-[80px] ${language === lang ? 'text-blue-400 bg-slate-700/50' : 'text-slate-300'}`}
            >
              {lang}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Allow render if data exists (even if races empty, though UI might break elsewhere)
  if (!data || races.length === 0) return (
    <div className="flex flex-col h-screen items-center justify-center bg-slate-900 text-slate-400 p-6 text-center">
      <div className="text-xl font-bold text-white mb-2">{t({ en: 'Loading Paddock...', it: 'Caricamento Paddock...', fr: 'Chargement du Paddock...', de: 'Lade Paddock...', es: 'Cargando Paddock...', ru: 'Загрузка паддока...', zh: '正在加载围场...', ar: 'تحميل بادوك...', ja: 'パドック読み込み中...' })}</div>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-6"></div>
      
      <div className="text-xs font-mono text-slate-600 bg-slate-950 p-2 rounded border border-slate-800 break-all max-w-xs mb-8">
        API: {getApiUrl()}<br/>
        Build: 57 (Final UI + OpenF1 Sync)<br/>
        Status: {loadingStatus}<br/>
        Time: {((now - ((window as any)._mountTime || now)) / 1000).toFixed(1)}s
      </div>

      <div className="flex flex-col items-center opacity-30">
        <span className="text-[8px] uppercase tracking-[0.2em] text-slate-500 mb-1 font-bold">{t({ en: 'Powered BY', it: 'Sviluppato DA', fr: 'Propulsé PAR', de: 'Bereitgestellt VON', es: 'Desarrollado POR', ru: 'Разработано', zh: '由...提供', ar: 'مشغل بواسطة', ja: '提供' })}</span>
        <img src="/ryzextrade_logo.png" alt="RyzexTrade" className="h-3 w-auto" />
      </div>
      
      {startupError && (
        <div className="text-red-400 font-bold mb-4 px-4 text-sm bg-red-900/20 p-2 rounded">
          {startupError}
        </div>
      )}

      <div className="flex gap-4">
        <button 
          onClick={() => location.reload()}
          className="text-xs text-blue-400 hover:text-blue-300 underline"
        >
          {t({ en: 'Retry Connection', it: 'Riprova Connessione', fr: 'Réessayer Connexion', de: 'Verbindung wiederholen', es: 'Reintentar Conexión', ru: 'Повторить соединение', zh: '重试连接', ar: 'إعادة الاتصال', ja: '接続を再試行' })}
        </button>

        <button 
          onClick={() => {
             // Force manual fetch if stuck
             setLoadingStatus("Manual Fetching...");
             getRaces().then(r => {
               if (r.length > 0) {
                 setRaces(r);
                 setLoadingStatus("Manual Load OK");
               } else {
                 setStartupError("Manual Fetch: 0 Races");
               }
             }).catch(e => setStartupError("Manual Fail: " + e.message));
          }}
          className="text-xs text-green-400 hover:text-green-300 underline"
        >
          {t({ en: 'Force Fetch Races', it: 'Forza Aggiornamento Gare', fr: 'Forcer Récup. Courses', de: 'Rennen laden erzwingen', es: 'Forzar Obtención Carreras', ru: 'Обновить гонки', zh: '强制获取比赛', ar: 'فرض جلب السباقات', ja: 'レース強制取得' })}
        </button>

        {(now - ((window as any)._mountTime || now)) > 5000 && (
          <button 
            onClick={() => {
              if (confirm("Reset App Data & Logout?")) {
                localStorage.clear();
                location.reload();
              }
            }}
            className="text-xs text-red-400 hover:text-red-300 underline"
          >
            {t({ en: 'Force Reset App', it: 'Forza Reset App', fr: 'Forcer Réinit. App', de: 'App-Reset erzwingen', es: 'Forzar Reinicio App', ru: 'Сброс приложения', zh: '强制重置应用', ar: 'فرض إعادة تعيين التطبيق', ja: 'アプリ強制リセット' })}
          </button>
        )}
      </div>
    </div>
  );

  // Login / Auth Screen
  if (!data.user) {
    return (
      <div className="flex flex-col h-screen bg-slate-900 text-white items-center justify-center p-6">
        {LangMenu}
        <h1 className="text-4xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-red-500">
          FantaF1
        </h1>
        <p className="text-slate-400 mb-8">{t({ en: '2026 Season Manager', it: 'Manager Stagione 2026', fr: 'Manager Saison 2026', de: 'Saisonmanager 2026', es: 'Gestor Temporada 2026', ru: 'Менеджер сезона 2026', zh: '2026赛季经理', ar: 'مدير موسم 2026', ja: '2026シーズンマネージャー' })}</p>

        <div className="w-full max-w-sm bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-2xl">

          {/* Auth Mode Toggle */}
          <div className="flex bg-slate-900 rounded-lg p-1 mb-6">
            <button
              onClick={() => setIsRegistering(true)}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${isRegistering ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {t({ en: 'Register', it: 'Registrati', fr: 'S\'inscrire', de: 'Registrieren', es: 'Registrarse', ru: 'Регистрация', zh: '注册', ar: 'تسجيل', ja: '登録' })}
            </button>
            <button
              onClick={() => setIsRegistering(false)}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${!isRegistering ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {t({ en: 'Login', it: 'Accedi', fr: 'Connexion', de: 'Login', es: 'Entrar', ru: 'Вход', zh: '登录', ar: 'دخول', ja: 'ログイン' })}
            </button>
          </div>

          {/* Common Inputs */}
          <div className="space-y-4 mb-6">
            <div>
                <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'Username', it: 'Nome Utente', fr: "Nom d'utilisateur", de: 'Benutzername', es: 'Usuario', ru: 'Имя пользователя', zh: '用户名', ar: 'اسم المستخدم', ja: 'ユーザー名' })}</label>
                <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t({ en: 'Enter your name', it: 'Inserisci nome', fr: 'Entrez votre nom', de: 'Name eingeben', es: 'Ingresa tu nombre', ru: 'Введите имя', zh: '输入名字', ar: 'أدخل اسمك', ja: '名前を入力' })}
                className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
                />
            </div>
            <div>
                <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'Password', it: 'Password' })}</label>
                <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t({ en: 'Min 3 chars', it: 'Min 3 caratteri' })}
                className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
                />
            </div>
          </div>

          {/* Registration Only: League Options */}
          {isRegistering && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                <div className="flex bg-slate-900 rounded-lg p-1 mb-4">
                    <button
                    onClick={() => setLoginMode('create')}
                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-colors ${loginMode === 'create' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                    {t({ en: 'Create League', it: 'Crea Lega', fr: 'Créer ligue', de: 'Liga erstellen', es: 'Crear liga', ru: 'Создать лигу', zh: '创建联盟', ar: 'إنشاء دوري', ja: 'リーグ作成' })}
                    </button>
                    <button
                    onClick={() => setLoginMode('join')}
                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-colors ${loginMode === 'join' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                    {t({ en: 'Join League', it: 'Unisciti', fr: 'Rejoindre', de: 'Beitreten', es: 'Unirse', ru: 'Войти', zh: '加入联盟', ar: 'انضمام', ja: '参加' })}
                    </button>
                </div>

                {loginMode === 'create' && (
                    <div className="mb-6">
                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'League Name', it: 'Nome Lega', fr: 'Nom de la ligue', de: 'Liganame', es: 'Nombre Liga', ru: 'Название лиги', zh: '联盟名称', ar: 'اسم الدوري', ja: 'リーグ名' })}</label>
                    <input
                        type="text"
                        value={leagueName}
                        onChange={(e) => setLeagueName(e.target.value)}
                        placeholder={t({ en: 'e.g. Sunday Racing Club', it: 'es. Racing Club', fr: 'ex. Racing Club', de: 'z.B. Racing Club', es: 'ej. Racing Club', ru: 'напр. Клуб', zh: '例如：周日赛车', ar: 'مثال: نادي السباق', ja: '例: レーシングクラブ' })}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
                    />
                    </div>
                )}

                {loginMode === 'join' && (
                    <div className="mb-6">
                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'League Code', it: 'Codice Lega', fr: 'Code Ligue', de: 'Liga-Code', es: 'Código Liga', ru: 'Код лиги', zh: '联盟代码', ar: 'رمز الدوري', ja: 'リーグコード' })}</label>
                    <input
                        type="text"
                        value={leagueCodeInput}
                        onChange={(e) => setLeagueCodeInput(e.target.value.toUpperCase())}
                        placeholder={t({ en: '6-Digit Code', it: 'Codice 6 cifre', fr: 'Code 6 chiffres', de: '6-stelliger Code', es: 'Código 6 dígitos', ru: '6 цифр', zh: '6位代码', ar: 'رمز من 6 أرقام', ja: '6桁コード' })}
                        maxLength={6}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest uppercase"
                    />
                    </div>
                )}
            </div>
          )}

          <button
            onClick={handleAuth}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-3 px-4 rounded transition-all shadow-lg transform hover:scale-[1.02]"
          >
            {isRegistering 
                ? (loginMode === 'create' ? t({ en: 'Register & Start', it: 'Registrati e Inizia' }) : t({ en: 'Register & Join', it: 'Registrati e Unisciti' }))
                : t({ en: 'Login', it: 'Accedi' })
            }
          </button>
          
          <div className="mt-4 pt-4 border-t border-slate-700 flex flex-col items-center opacity-30">
            <span className="text-[10px] text-slate-600">Build: 64</span>
            <span className="text-[8px] uppercase tracking-[0.2em] text-slate-500 mb-1 font-bold">{t({ en: 'Powered BY', it: 'Sviluppato DA', fr: 'Propulsé PAR', de: 'Bereitgestellt VON', es: 'Desarrollado POR', ru: 'Разработано', zh: '由...提供', ar: 'مشغل بواسطة', ja: '提供' })}</span>
            <img src="/ryzextrade_logo.png" alt="RyzexTrade" className="h-3 w-auto" />
          </div>
        </div>
      </div>
    );
  }

  // Main App Content (Only rendered if logged in)
  const currentRace = races[data.currentRaceIndex] || races[0]; // Fallback to avoid crash
  if (!currentRace) return <div>Error: No Race Data</div>; // Should never happen due to check above
  
  const lockState = getLockStatus(currentRace, now);
  // Use constructors from rules (editable) fallback to constant if needed
  const activeConstructors = data.rules?.constructors || CONSTRUCTORS;

  const getStatusColor = (s: LockStatus) => {
    switch (s) {
      case 'locked': return 'text-red-400';
      case 'closing_soon': return 'text-yellow-400';
      case 'open': return 'text-green-400';
      default: return 'text-yellow-400';
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case Tab.HOME:
        return (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-white">{t({ en: 'Welcome', it: 'Benvenuto', fr: 'Bienvenue', de: 'Willkommen', es: 'Bienvenido', ru: 'Добро пожаловать', zh: '欢迎', ar: 'مرحباً', ja: 'ようこそ' })}, {data.user?.name}</h1>
              <p className="text-slate-400">
                {data.user?.isAdmin ? `${t({ en: 'Admin of', it: 'Admin di', fr: 'Admin de', de: 'Admin von', es: 'Admin de', ru: 'Админ', zh: '管理员', ar: 'مسؤول عن', ja: '管理者' })} ${data.user.leagueName}` : t({ en: 'Member', it: 'Membro', fr: 'Membre', de: 'Mitglied', es: 'Miembro', ru: 'Участник', zh: '成员', ar: 'عضو', ja: 'メンバー' })}
              </p>
              <div className="mt-2 inline-block bg-blue-900/50 border border-blue-500/30 rounded px-3 py-1">
                <span className="text-slate-400 text-xs mr-2">{t({ en: 'LEAGUE CODE', it: 'CODICE LEGA', fr: 'CODE LIGUE', de: 'LIGA-CODE', es: 'CÓDIGO LIGA', ru: 'КОД ЛИГИ', zh: '联盟代码', ar: 'رمز الدوري', ja: 'リーグコード' })}:</span>
                <span className="font-mono font-bold text-blue-300">{data.user.leagueCode}</span>
              </div>
            </header>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h2 className="text-lg font-semibold text-blue-400 mb-2">{t({ en: 'Selected Race', it: 'Gara Selezionata', fr: 'Course sélectionnée', de: 'Ausgewähltes Rennen', es: 'Carrera seleccionada', ru: 'Выбранная гонка', zh: '已选赛事', ar: 'السباق المحدد', ja: '選択されたレース' })}</h2>
              <div className="text-3xl font-bold text-white">{currentRace.name}</div>
              <div className="text-slate-400 mt-1">{currentRace.date}</div>
              {lockState.status !== 'unconfigured' && (
                <div className="mt-3 bg-slate-900/50 p-2 rounded text-center border border-slate-600">
                  <span className="text-xs text-slate-400 uppercase mr-2">{t({ en: 'Lineup Locks In', it: 'Chiude tra', fr: 'Verrouillage dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Закрытие через', zh: '阵容锁定于', ar: 'يغلق التشكيل في', ja: 'ラインナップ固定まで' })}</span>
                  <span className={`font-mono font-bold ${lockState.status === 'locked' ? 'text-red-400' : 'text-green-400'}`}>
                    {lockState.status === 'locked' ? t({ en: 'LOCKED', it: 'BLOCCATO', fr: 'VERROUILLÉ', de: 'GESPERRT', es: 'BLOQUEADO', ru: 'ЗАБЛОКИРОВАНО', zh: '已锁定', ar: 'مغلق', ja: 'ロック済' }) : formatCountdown(lockState.msToLock || 0)}
                  </span>
                </div>
              )}
            </div>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h2 className="text-lg font-semibold text-green-400 mb-2">{t({ en: 'Team Status', it: 'Stato Team', fr: 'Statut équipe', de: 'Teamstatus', es: 'Estado Equipo', ru: 'Статус команды', zh: '车队状态', ar: 'حالة الفريق', ja: 'チーム状況' })}</h2>
              <div className="flex justify-between items-center mb-2">
                <span className="text-slate-300">{t({ en: 'Budget', it: 'Budget', fr: 'Budget', de: 'Budget', es: 'Presupuesto', ru: 'Бюджет', zh: '预算', ar: 'الميزانية', ja: '予算' })}</span>
                <span className="font-mono text-white text-lg">${data.team.budget.toFixed(1)}M</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-300">{t({ en: 'Drivers Signed', it: 'Piloti', fr: 'Pilotes', de: 'Fahrer', es: 'Pilotos', ru: 'Пилоты', zh: '车手', ar: 'السائقين', ja: '契約ドライバー' })}</span>
                <span className="font-mono text-white text-lg">{data.team.driverIds.length}/5</span>
              </div>
            </div>

            {/* Profile & Logout Card (Added to Home) */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-2">{t({ en: 'User Profile', it: 'Profilo Utente', fr: 'Profil utilisateur', de: 'Benutzerprofil', es: 'Perfil usuario', ru: 'Профиль', zh: '用户资料', ar: 'ملف المستخدم', ja: 'プロフィール' })}</h3>
              <div className="mb-4 text-sm text-slate-300">
                <p><span className="text-slate-500">{t({ en: 'Name', it: 'Nome', fr: 'Nom', de: 'Name', es: 'Nombre', ru: 'Имя', zh: '名字', ar: 'الاسم', ja: '名前' })}:</span> {data.user?.name}</p>
                <p><span className="text-slate-500">{t({ en: 'Role', it: 'Ruolo', fr: 'Rôle', de: 'Rolle', es: 'Rol', ru: 'Роль', zh: '角色', ar: 'الدور', ja: '役割' })}:</span> {data.user?.isAdmin ? 'Admin' : 'Member'}</p>
                <p><span className="text-slate-500">{t({ en: 'League Code', it: 'Codice Lega', fr: 'Code Ligue', de: 'Liga-Code', es: 'Código Liga', ru: 'Код лиги', zh: '联盟代码', ar: 'رمز الدوري', ja: 'リーグコード' })}:</span> <span className="font-mono text-blue-400">{data.user?.leagueCode}</span></p>
              </div>

              <div className="flex flex-col gap-3 mt-4">
                {/* Premium / Remove Ads */}
                <div className="border border-slate-700/50 bg-slate-900/50 rounded-lg p-3 mb-2">
                  <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">{t({ en: 'Premium', it: 'Premium' })}</h4>
                  {isPremium ? (
                    <div className="flex items-center gap-3 text-yellow-400">
                       <span className="text-xl">👑</span>
                       <div>
                         <div className="font-bold text-sm">{t({ en: 'Premium Active', it: 'Premium Attivo' })}</div>
                         <div className="text-[10px] opacity-80">{t({ en: 'No Ads enabled', it: 'Pubblicità rimosse' })}</div>
                       </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                        <div className="bg-yellow-900/30 p-2 rounded text-xs text-yellow-200 mb-2">
                            {t({ en: 'Watch a short video to get 24 hours of Premium for free!', it: 'Guarda un breve video per avere 24 ore di Premium gratis!' })}
                        </div>
                        <button
                          onClick={handleWatchAdForPremium}
                          className="w-full bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white font-bold py-2 px-3 rounded-lg shadow-lg border border-yellow-500/50 transition-all flex items-center justify-center gap-2 text-sm"
                        >
                          <span>🎬</span>
                          {t({ en: 'Watch Video (24h Free Premium)', it: 'Guarda Video (24h Premium Gratis)' })}
                        </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                  {t({ en: 'Logout', it: 'Esci', fr: 'Déconnexion', de: 'Abmelden', es: 'Salir', ru: 'Выйти', zh: '登出', ar: 'خروج', ja: 'ログアウト' })}
                </button>
                {showResetConfirm ? (
                  <div className="bg-red-950/50 border border-red-500 p-4 rounded-lg animate-pulse">
                    <p className="text-red-200 text-center mb-3 font-bold">{t({ en: 'Delete all local data?', it: 'Eliminare i dati locali?', fr: 'Supprimer données locales?', de: 'Lokale Daten löschen?', es: '¿Borrar datos locales?', ru: 'Удалить данные?', zh: '删除本地数据？', ar: 'حذف البيانات المحلية؟', ja: '全データを削除しますか？' })}</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="flex-1 bg-slate-600 text-white py-2 rounded hover:bg-slate-500"
                      >
                        {t({ en: 'Cancel', it: 'Annulla', fr: 'Annuler', de: 'Abbrechen', es: 'Cancelar', ru: 'Отмена', zh: '取消', ar: 'إلغاء', ja: 'キャンセル' })}
                      </button>
                      <button
                        onClick={handleLogout}
                        className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-500"
                      >
                        {t({ en: 'Confirm', it: 'Conferma', fr: 'Confirmer', de: 'Bestätigen', es: 'Confirmar', ru: 'Подтвердить', zh: '确认', ar: 'تأكيد', ja: '確認' })}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full bg-red-900/50 hover:bg-red-800/50 text-red-200 font-bold py-2 px-4 rounded transition-colors border border-red-900"
                  >
                    {t({ en: 'Reset All Data (Logout)', it: 'Resetta Dati (Logout)', fr: 'Réinitialiser (Déconnexion)', de: 'Reset (Abmelden)', es: 'Reiniciar (Salir)', ru: 'Сброс (Выход)', zh: '重置所有数据', ar: 'إعادة تعيين (خروج)', ja: 'リセット (ログアウト)' })}
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      case Tab.TEAM:
        return (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-white mb-4">{t({ en: 'My Team', it: 'Il Mio Team', fr: 'Mon Équipe', de: 'Mein Team', es: 'Mi Equipo', ru: 'Моя Команда', zh: '我的车队', ar: 'فريقي', ja: 'マイチーム' })}</h1>
            <div className="p-4 bg-slate-800 rounded-lg text-center border border-slate-700 relative">
               <p className="text-slate-400 mb-2">{t({ en: 'Team Name', it: 'Nome Team', fr: "Nom de l'équipe", de: 'Teamname', es: 'Nombre del Equipo', ru: 'Название команды', zh: '车队名称', ar: 'اسم الفريق', ja: 'チーム名' })}</p>
               {isEditingTeamName ? (
                 <div className="flex items-center justify-center gap-2">
                   <input 
                     type="text" 
                     value={teamNameEdit}
                     onChange={(e) => setTeamNameEdit(e.target.value)}
                     className="bg-slate-900 border border-slate-600 rounded p-1 text-white text-center font-bold"
                   />
                   <button 
                     onClick={async () => {
                        if (!teamNameEdit.trim()) return;
                        try {
                           await updateTeamName(data.user!.leagueId, teamNameEdit.trim());
                           setData({
                              ...data,
                              team: { ...data.team, name: teamNameEdit.trim() }
                           });
                           setIsEditingTeamName(false);
                        } catch(e) { console.error(e); alert("Failed"); }
                     }}
                     className="text-green-400 font-bold"
                   >✓</button>
                   <button onClick={() => setIsEditingTeamName(false)} className="text-red-400 font-bold">✕</button>
                 </div>
               ) : (
                 <div className="flex items-center justify-center gap-2">
                   <h2 className="text-xl font-bold text-white">{data.team.name}</h2>
                   <button onClick={() => { setTeamNameEdit(data.team.name); setIsEditingTeamName(true); }} className="text-slate-500 hover:text-white text-xs">✏️</button>
                 </div>
               )}
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-200">{t({ en: 'Roster', it: 'Rosa', fr: 'Effectif', de: 'Kader', es: 'Plantilla', ru: 'Состав', zh: '阵容', ar: 'القائمة', ja: 'ロースター' })}</h3>
              {data.team.driverIds.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg text-center text-slate-500">
                  {t({ en: 'No drivers selected yet. Go to Market.', it: 'Nessun pilota selezionato. Vai al Mercato.', fr: 'Aucun pilote sélectionné. Allez au Marché.', de: 'Noch keine Fahrer ausgewählt. Zum Markt gehen.', es: 'Sin pilotos seleccionados. Ir al Mercado.', ru: 'Пилоты не выбраны. Перейдите на рынок.', zh: '尚未选择车手。前往市场。', ar: 'لم يتم اختيار سائقين بعد. اذهب إلى السوق.', ja: 'ドライバー未選択。マーケットへ。' })}
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.team.driverIds.map(id => {
                    const d = fetchedDrivers.find(drv => drv.id === id);
                    const c = activeConstructors.find(con => con.id === d?.constructorId);
                    return (
                      <li key={id} className="bg-slate-800 p-3 rounded flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-8 rounded-full" style={{ backgroundColor: c?.color || '#555' }}></div>
                          <div>
                            <div className="text-white font-medium">{d?.name}</div>
                            <div className="text-xs text-slate-400">{c?.name}</div>
                          </div>
                        </div>
                        <div className="font-mono text-slate-300">${d?.price}M</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        );

      case Tab.LINEUP:
        return (
          <div className="flex flex-col h-full space-y-4">
            {/* Lock Status Banner */}
            {lockState.status === 'unconfigured' && (
              <div className="bg-yellow-900/50 border border-yellow-600 p-3 rounded text-center">
                <div className="text-yellow-400 font-bold">{t({ en: 'Config Missing', it: 'Config Mancante', fr: 'Config manquante', de: 'Konfig fehlt', es: 'Falta config', ru: 'Нет конфига', zh: '缺少配置', ar: 'التكوين مفقود', ja: '設定不足' })}</div>
                <div className="text-xs text-yellow-200">{t({ en: 'Admin: Set UTC times.', it: 'Admin: Imposta orari UTC.', fr: 'Admin: Définir heures UTC.', de: 'Admin: UTC-Zeiten setzen.', es: 'Admin: Fijar horas UTC.', ru: 'Админ: Уст. UTC.', zh: '管理员：设置UTC时间。', ar: 'المسؤول: تعيين توقيت UTC.', ja: '管理者: UTC設定' })}</div>
              </div>
            )}
            {lockState.status === 'open' && (
              <div className="bg-green-900/50 border border-green-600 p-3 rounded text-center">
                <div className="text-green-400 font-bold">{t({ en: 'Lineup Open', it: 'Formazione Aperta', fr: 'Alignement ouvert', de: 'Lineup offen', es: 'Alineación abierta', ru: 'Состав открыт', zh: '阵容开放', ar: 'التشكيل مفتوح', ja: 'ラインナップ変更可能' })}</div>
                {lockState.msToLock !== null && (
                  <div className="text-xs text-green-200">{t({ en: 'Locks in', it: 'Chiude tra', fr: 'Verrouille dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Закрытие через', zh: '锁定于', ar: 'يغلق في', ja: '固定まで' })} {formatCountdown(lockState.msToLock)}</div>
                )}
                <div className="mt-2 text-[10px] font-mono text-green-200 opacity-80 border-t border-green-700/50 pt-1">
                  <div>{t({ en: 'Session UTC', it: 'Sessione UTC', fr: 'Séance UTC', de: 'Sitzung UTC', es: 'Sesión UTC', ru: 'Сессия UTC', zh: '会话UTC', ar: 'الجلسة UTC', ja: 'セッションUTC' })}: {lockState.targetSessionUtc || 'N/A'}</div>
                  <div>{t({ en: 'Lock UTC', it: 'Blocco UTC', fr: 'Verrouillage UTC', de: 'Sperre UTC', es: 'Cierre UTC', ru: 'Блок. UTC', zh: '锁定UTC', ar: 'القفل UTC', ja: 'ロックUTC' })}: {lockState.lockTimeUtc || 'N/A'}</div>
                </div>
              </div>
            )}
            {lockState.status === 'closing_soon' && (
              <div className="bg-orange-900/50 border border-orange-600 p-3 rounded text-center animate-pulse">
                <div className="text-orange-400 font-bold">{t({ en: 'Closing Soon', it: 'Chiude Presto', fr: 'Fermeture bientôt', de: 'Schließt bald', es: 'Cierra pronto', ru: 'Скоро закрытие', zh: '即将关闭', ar: 'يغلق قريباً', ja: 'まもなく終了' })}</div>
                {lockState.msToLock !== null && (
                  <div className="text-xs text-orange-200">{t({ en: 'Locks in', it: 'Chiude tra', fr: 'Verrouille dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Закрытие через', zh: '锁定于', ar: 'يغلق في', ja: '固定まで' })} {formatCountdown(lockState.msToLock)}</div>
                )}
                <div className="mt-2 text-[10px] font-mono text-orange-200 opacity-80 border-t border-orange-700/50 pt-1">
                  <div>{t({ en: 'Session UTC', it: 'Sessione UTC', fr: 'Séance UTC', de: 'Sitzung UTC', es: 'Sesión UTC', ru: 'Сессия UTC', zh: '会话UTC', ar: 'الجلسة UTC', ja: 'セッションUTC' })}: {lockState.targetSessionUtc || 'N/A'}</div>
                  <div>{t({ en: 'Lock UTC', it: 'Blocco UTC', fr: 'Verrouillage UTC', de: 'Sperre UTC', es: 'Cierre UTC', ru: 'Блок. UTC', zh: '锁定UTC', ar: 'القفل UTC', ja: 'ロックUTC' })}: {lockState.lockTimeUtc || 'N/A'}</div>
                </div>
              </div>
            )}
            {lockState.status === 'locked' && (
              <div className="bg-red-900/50 border border-red-600 p-3 rounded text-center">
                <div className="text-red-400 font-bold">{t({ en: 'Lineup locked.', it: 'Formazione bloccata.', fr: 'Alignement verrouillé.', de: 'Lineup gesperrt.', es: 'Alineación bloqueada.', ru: 'Состав заблокирован.', zh: '阵容已锁定。', ar: 'تم قفل التشكيل.', ja: 'ラインナップ固定済み。' })}</div>
                <div className="text-xs text-red-200">
                  {currentRace.isSprint
                    ? t({ en: 'Sprint Qualifying is about to start.', it: 'La Sprint Shootout sta per iniziare.', fr: 'Qualification Sprint commence.', de: 'Sprint-Quali beginnt.', es: 'Sprint Quali va a comenzar.', ru: 'Спринт-квалификация начинается.', zh: '冲刺排位即将开始。', ar: 'تصفيات السرعة ستبدأ قريباً.', ja: 'スプリント予選開始。' })
                    : t({ en: 'Qualifying is about to start.', it: 'Le qualifiche stanno per iniziare.', fr: 'Les qualifications vont commencer.', de: 'Qualifying beginnt bald.', es: 'La clasificación está por comenzar.', ru: 'Квалификация начинается.', zh: '排位赛即将开始。', ar: 'التصفيات ستبدأ قريباً.', ja: '予選が始まります。' })}
                </div>
                <div className="mt-2 text-[10px] font-mono text-red-200 opacity-80 border-t border-red-700/50 pt-1">
                  <div>{t({ en: 'Lock only affects Captain/Reserve selection.', it: 'Il blocco riguarda solo Capitano/Riserva.' })}</div>
                  <div className="text-yellow-200 mt-1">{t({ en: 'Market is still OPEN.', it: 'Il Mercato è ancora APERTO.' })}</div>
                </div>
              </div>
            )}

            <h1 className="text-2xl font-bold text-white">{t({ en: 'Race Lineup', it: 'Formazione Gara', fr: 'Alignement course', de: 'Renn-Lineup', es: 'Alineación Carrera', ru: 'Состав на гонку', zh: '正赛阵容', ar: 'تشكيل السباق', ja: 'レースラインナップ' })}</h1>

            {data.team.driverIds.length < 5 ? (
              <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg text-center text-slate-500">
                {t({ en: 'Pick 5 drivers in Market to unlock Lineup.', it: 'Scegli 5 piloti nel Mercato per sbloccare la formazione.', fr: 'Choisissez 5 pilotes pour débloquer.', de: 'Wähle 5 Fahrer im Markt.', es: 'Elige 5 pilotos para desbloquear.', ru: 'Выберите 5 пилотов.', zh: '在市场选择5名车手解锁。', ar: 'اختر 5 سائقين لفتح التشكيل.', ja: 'マーケットで5人選んでください。' })}
              </div>
            ) : (
              <div className="space-y-2">
                {data.team.driverIds.map(id => {
                  const d = fetchedDrivers.find(drv => drv.id === id);
                  const c = activeConstructors.find(con => con.id === d?.constructorId);
                  const isCaptain = data.team.captainId === id;
                  const isReserve = data.team.reserveDriverId === id;
                  const isLocked = lockState.status === 'locked';

                  return (
                    <div key={id} className={`bg-slate-800 p-3 rounded flex justify-between items-center border ${isCaptain ? 'border-yellow-500' : isReserve ? 'border-green-500' : 'border-slate-700'}`}>
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-8 rounded-full" style={{ backgroundColor: c?.color || '#555' }}></div>
                        <div>
                          <div className="text-white font-medium flex items-center gap-2">
                            {d?.name}
                            {isCaptain && <span className="text-[10px] bg-yellow-500 text-black font-bold px-1 rounded">{t({ en: 'CPT', it: 'CAP', fr: 'CAP', de: 'KPT', es: 'CAP', ru: 'КЭП', zh: '队长', ar: 'كابتن', ja: 'CPT' })}</span>}
                            {isReserve && <span className="text-[10px] bg-green-500 text-black font-bold px-1 rounded">{t({ en: 'RES', it: 'RIS', fr: 'RES', de: 'ERS', es: 'RES', ru: 'РЕЗ', zh: '替补', ar: 'احتياطي', ja: 'RES' })}</span>}
                          </div>
                          <div className="text-xs text-slate-400">{c?.name}</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSetCaptain(id)}
                          disabled={isLocked || isCaptain}
                          className={`px-3 py-1 text-xs rounded font-bold uppercase ${isCaptain
                            ? 'bg-slate-700 text-slate-500 cursor-default opacity-50'
                            : isLocked
                              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                              : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                            }`}
                        >
                          Set C
                        </button>
                        <button
                          onClick={() => handleSetReserve(id)}
                          disabled={isLocked || isReserve}
                          className={`px-3 py-1 text-xs rounded font-bold uppercase ${isReserve
                            ? 'bg-slate-700 text-slate-500 cursor-default opacity-50'
                            : isLocked
                              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                              : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                            }`}
                        >
                          Set R
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      case Tab.MARKET:
        if (swapCandidate) {
          return (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white">{t({ en: 'Swap Driver', it: 'Scambia Pilota', fr: 'Échanger Pilote', de: 'Fahrer tauschen', es: 'Cambiar Piloto', ru: 'Заменить пилота', zh: '交换车手', ar: 'تبديل السائق', ja: 'ドライバー交換' })}</h2>
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 mb-4">
                <p className="text-slate-400 text-sm">{t({ en: 'Target', it: 'Obiettivo', fr: 'Cible', de: 'Ziel', es: 'Objetivo', ru: 'Цель', zh: '目标', ar: 'الهدف', ja: 'ターゲット' })}</p>
                <div className="text-xl font-bold text-white">{swapCandidate.name}</div>
                <div className="text-blue-400 font-mono">${swapCandidate.price}M</div>
              </div>

              <h3 className="text-lg text-slate-300">{t({ en: 'Select a driver to release:', it: 'Seleziona un pilota da rilasciare:', fr: 'Sélectionnez un pilote à libérer :', de: 'Wähle einen Fahrer zum Freigeben:', es: 'Selecciona un piloto para liberar:', ru: 'Введите пилота для замены:', zh: '选择要释放的车手：', ar: 'اختر سائقاً للاستبدال:', ja: '放出するドライバーを選択:' })}</h3>
              <div className="space-y-2">
                {data.team.driverIds.map(id => {
                  const d = fetchedDrivers.find(drv => drv.id === id);
                  if (!d) return null;
                  const diff = data.team.budget + d.price - swapCandidate.price;
                  const canAfford = diff >= 0;

                  return (
                    <button
                      key={id}
                      onClick={() => canAfford && handleSwapDriver(d, swapCandidate)}
                      disabled={!canAfford}
                      className={`w-full p-3 rounded flex justify-between items-center border ${canAfford
                        ? 'bg-slate-800 border-slate-600 hover:bg-slate-700'
                        : 'bg-slate-800 border-red-900 opacity-50 cursor-not-allowed'
                        }`}
                    >
                      <div className="text-left">
                        <div className="text-white font-medium">{d.name}</div>
                        <div className="text-xs text-slate-400">{t({ en: 'Sell for', it: 'Vendi per', fr: 'Vendre pour', de: 'Verkaufen für', es: 'Vender por', ru: 'Продать за', zh: '出售价格', ar: 'بيع بـ', ja: '売却額' })} ${d.price}M</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono ${canAfford ? 'text-green-400' : 'text-red-400'}`}>
                          {t({ en: 'New Budget', it: 'Nuovo Budget', fr: 'Nouveau Budget', de: 'Neues Budget', es: 'Nuevo Presupuesto', ru: 'Новый бюджет', zh: '新预算', ar: 'الميزانية الجديدة', ja: '新予算' })}: ${diff.toFixed(1)}M
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setSwapCandidate(null)}
                className="w-full mt-4 bg-slate-700 text-white py-3 rounded hover:bg-slate-600"
              >
                {t({ en: 'Cancel Swap', it: 'Annulla Scambio', fr: "Annuler l'échange", de: 'Tausch abbrechen', es: 'Cancelar Cambio', ru: 'Отменить обмен', zh: '取消交换', ar: 'إلغاء التبديل', ja: '交換キャンセル' })}
              </button>
            </div>
          );
        }

        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-slate-800 p-3 rounded-lg sticky top-0 z-10 shadow-lg border-b border-slate-700">
              <div>
                <div className="text-xs text-slate-400 uppercase">{t({ en: 'Budget', it: 'Budget', fr: 'Budget', de: 'Budget', es: 'Presupuesto', ru: 'Бюджет', zh: '预算', ar: 'الميزانية', ja: '予算' })}</div>
                <div className="text-xl font-mono text-white">${data.team.budget.toFixed(1)}M</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase text-right">{t({ en: 'Team', it: 'Team', fr: 'Équipe', de: 'Team', es: 'Equipo', ru: 'Команда', zh: '车队', ar: 'الفريق', ja: 'チーム' })}</div>
                <div className="text-xl font-mono text-white text-right">{data.team.driverIds.length}/5</div>
              </div>
            </div>

            <div className="space-y-2">
              {fetchedDrivers.map(driver => {
                const constr = activeConstructors.find(c => c.id === driver.constructorId);
                const isOwned = data.team.driverIds.includes(driver.id);
                const isTeamFull = data.team.driverIds.length >= 5;
                const canAfford = data.team.budget >= driver.price;

                return (
                  <div key={driver.id} className="bg-slate-800 p-3 rounded flex justify-between items-center border border-slate-700/50">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-10 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]" style={{ backgroundColor: constr?.color || '#555', boxShadow: `0 0 8px ${constr?.color}` }}></div>
                      <div>
                        <div className="text-white font-bold leading-tight">{driver.name}</div>
                        <div className="text-xs text-slate-400">{constr?.name}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="font-mono text-slate-200">${driver.price}M</div>
                      {isOwned ? (
                        <button 
                          onClick={() => handleSellDriver(driver)}
                          className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded font-bold uppercase tracking-wider transition-colors"
                        >
                          {t({ en: 'Sell', it: 'Vendi', fr: 'Vendre', de: 'Verkaufen', es: 'Vender', ru: 'Продать', zh: '卖', ar: 'بيع', ja: '売却' })}
                        </button>
                      ) : isTeamFull ? (
                        <button
                          onClick={() => setSwapCandidate(driver)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-bold uppercase tracking-wider transition-colors"
                        >
                          {t({ en: 'Swap', it: 'Scambia', fr: 'Échanger', de: 'Tauschen', es: 'Cambiar', ru: 'Обмен', zh: '交换', ar: 'تبديل', ja: '交換' })}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleBuyDriver(driver)}
                          disabled={!canAfford}
                          className={`px-3 py-1 text-xs rounded font-bold uppercase tracking-wider transition-colors ${canAfford
                            ? 'bg-green-600 hover:bg-green-500 text-white'
                            : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                            }`}
                        >
                          {t({ en: 'Add', it: 'Aggiungi', fr: 'Ajouter', de: 'Hinzufügen', es: 'Añadir', ru: 'Добавить', zh: '添加', ar: 'إضافة', ja: '追加' })}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Profile & Logout Card Moved to Home */}
          </div>
        );

      case Tab.ADMIN:
        return (
          <fieldset className="space-y-6 border-none p-0 m-0 min-w-0" disabled={!data.user?.isAdmin}>
            {!data.user?.isAdmin && (
              <div className="bg-yellow-900/50 text-yellow-200 p-2 rounded text-center text-xs font-bold border border-yellow-700">
                {t({ en: 'READ ONLY MODE (Guest)', it: 'MODALITÀ SOLA LETTURA (Ospite)', fr: 'MODE LECTURE SEULE (Invité)', de: 'LESEMODUS (Gast)', es: 'MODO LECTURA (Invitado)', ru: 'ТОЛЬКО ЧТЕНИЕ (Гость)', zh: '只读模式（访客）', ar: 'وضع القراءة فقط (ضيف)', ja: '読み取り専用モード（ゲスト）' })}
              </div>
            )}
            <h1 className="text-2xl font-bold text-white">{t({ en: 'Admin Controls', it: 'Controlli Admin', fr: 'Contrôles Admin', de: 'Admin-Steuerung', es: 'Controles Admin', ru: 'Управление', zh: '管理员控制', ar: 'تحكم المسؤول', ja: '管理設定' })}</h1>



        {/* Next Race Card */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-2">{t({ en: 'Race Time Config', it: 'Config Orari Gara', fr: 'Config heures course', de: 'Rennzeit-Konfig', es: 'Config Horas Carrera', ru: 'Конфиг времени гонки', zh: '赛时配置', ar: 'تكوين وقت السباق', ja: 'レース時間設定' })}</h3>
              {/* Navigation */}
              <div className="flex justify-between items-center mb-4">
                <button
                  onClick={() => setData({ ...data, currentRaceIndex: Math.max(0, data.currentRaceIndex - 1) })}
                  disabled={data.currentRaceIndex === 0}
                  className="p-2 bg-slate-700 rounded disabled:opacity-50 text-slate-200"
                >{t({ en: 'Prev', it: 'Prec', fr: 'Préc', de: 'Zurück', es: 'Ant', ru: 'Пред', zh: '上一个', ar: 'السابق', ja: '前へ' })}</button>
                <div className="text-center">
                  <div className="text-xs text-slate-400">{t({ en: 'Index', it: 'Indice', fr: 'Indice', de: 'Index', es: 'Índice', ru: 'Индекс', zh: '索引', ar: 'فهرس', ja: 'インデックス' })} {data.currentRaceIndex}</div>
                  <div className="font-bold text-white text-sm">{currentRace.name}</div>
                </div>
                <button
                  onClick={() => setData({ ...data, currentRaceIndex: Math.min(races.length - 1, data.currentRaceIndex + 1) })}
                  disabled={data.currentRaceIndex === races.length - 1}
                  className="p-2 bg-slate-700 rounded disabled:opacity-50 text-slate-200"
                >{t({ en: 'Next', it: 'Succ', fr: 'Suiv', de: 'Weiter', es: 'Sig', ru: 'След', zh: '下一个', ar: 'التالي', ja: '次へ' })}</button>
              </div>

              {/* Inputs */}
              <div className="space-y-3">
                 <button 
                    onClick={async () => {
                       if(confirm("Add 'name' column to Team table?")) {
                          const res = await import("./api").then(m => m.migrateTeamName());
                          alert(JSON.stringify(res));
                       }
                    }}
                    className="w-full bg-indigo-900/50 border border-indigo-500 text-indigo-200 text-xs py-2 rounded"
                 >
                    Run DB Migration (Add Team Name)
                 </button>
                 <div className={`p-2 rounded-lg border ${!currentRace.isSprint ? 'border-yellow-500 bg-yellow-900/20' : 'border-transparent'}`}>
                  <div className="flex justify-between">
                    <label className="block text-xs text-slate-400 mb-1">{t({ en: 'Qualifying UTC (ISO)', it: 'Qualifiche UTC (ISO)', fr: 'Qualif UTC (ISO)', de: 'Quali UTC (ISO)', es: 'Clasif UTC (ISO)', ru: 'Квалиф UTC', zh: '排位赛 UTC', ar: 'التصفيات UTC', ja: '予選 UTC' })}</label>
                    {!currentRace.isSprint && <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">{t({ en: 'SETS LOCK', it: 'LOCK ATTIVO', fr: 'VERROUILLE', de: 'SETZT LOCK', es: 'FIJA LOCK', ru: 'БЛОКИРУЕТ', zh: '设置锁定', ar: 'يقفل', ja: 'ロック設定' })}</span>}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={qualifyingUtcDraft}
                      onChange={(e) => setQualifyingUtcDraft(e.target.value)}
                      placeholder="YYYY-MM-DDTHH:MM:SSZ"
                      className="flex-1 bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={handleSaveQuali}
                      disabled={!isValidUtc(qualifyingUtcDraft)}
                      className={`px-3 rounded text-xs font-bold ${isValidUtc(qualifyingUtcDraft) ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
                    >
                      {t({ en: 'SAVE', it: 'SALVA', fr: 'SAUVER', de: 'SPEICHERN', es: 'GUARDAR', ru: 'СОХР', zh: '保存', ar: 'حفظ', ja: '保存' })}
                    </button>
                  </div>
                </div>

                {currentRace.isSprint && (
                  <div className={`p-2 rounded-lg border ${currentRace.isSprint ? 'border-yellow-500 bg-yellow-900/20' : 'border-transparent'}`}>
                    <div className="flex justify-between">
                      <label className="block text-xs text-slate-400 mb-1">{t({ en: 'Sprint Quali UTC (ISO)', it: 'Sprint Quali UTC (ISO)', fr: 'Sprint Qualif UTC', de: 'Sprint Quali UTC', es: 'Sprint Clasif UTC', ru: 'Спринт Квал UTC', zh: '冲刺排位 UTC', ar: 'تصفيات السرعة UTC', ja: 'スプリント予選 UTC' })}</label>
                      <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">{t({ en: 'SETS LOCK', it: 'LOCK ATTIVO', fr: 'VERROUILLE', de: 'SETZT LOCK', es: 'FIJA LOCK', ru: 'БЛОКИРУЕТ', zh: '设置锁定', ar: 'يقفل', ja: 'ロック設定' })}</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={sprintQualifyingUtcDraft}
                        onChange={(e) => setSprintQualifyingUtcDraft(e.target.value)}
                        placeholder="YYYY-MM-DDTHH:MM:SSZ"
                        className="flex-1 bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={handleSaveSprint}
                        disabled={!isValidUtc(sprintQualifyingUtcDraft)}
                        className={`px-3 rounded text-xs font-bold ${isValidUtc(sprintQualifyingUtcDraft) ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
                      >
                        {t({ en: 'SAVE', it: 'SALVA', fr: 'SAUVER', de: 'SPEICHERN', es: 'GUARDAR', ru: 'СОХР', zh: '保存', ar: 'حفظ', ja: '保存' })}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Debug Time Tooling */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-2">{t({ en: 'Debug Time', it: 'Debug Tempo', fr: 'Temps Debug', de: 'Debug-Zeit', es: 'Tiempo Debug', ru: 'Отладка времени', zh: '调试时间', ar: 'وقت التصحيح', ja: 'デバッグ時間' })}</h3>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => handleTestTime(120, false)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">{t({ en: 'Quali +2h', it: 'Qualifiche +2h', fr: 'Qualif +2h', de: 'Quali +2h', es: 'Clasif +2h', ru: 'Квал +2ч', zh: '排位 +2小时', ar: 'التصفيات +2س', ja: '予選 +2時間' })}</button>
                <button onClick={() => handleTestTime(10, false)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">{t({ en: 'Quali +10m', it: 'Qualifiche +10m', fr: 'Qualif +10m', de: 'Quali +10m', es: 'Clasif +10m', ru: 'Квал +10м', zh: '排位 +10分', ar: 'التصفيات +10د', ja: '予選 +10分' })}</button>
                {currentRace.isSprint && (
                  <>
                    <button onClick={() => handleTestTime(120, true)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">{t({ en: 'Sprint +2h', it: 'Sprint +2h', fr: 'Sprint +2h', de: 'Sprint +2h', es: 'Sprint +2h', ru: 'Спринт +2ч', zh: '冲刺 +2小时', ar: 'السرعة +2س', ja: 'スプリント +2時間' })}</button>
                    <button onClick={() => handleTestTime(10, true)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">{t({ en: 'Sprint +10m', it: 'Sprint +10m', fr: 'Sprint +10m', de: 'Sprint +10m', es: 'Sprint +10m', ru: 'Спринт +10м', zh: '冲刺 +10分', ar: 'السرعة +10د', ja: 'スプリント +10分' })}</button>
                  </>
                )}
              </div>
            </div>

            {/* Scoring Rules Config */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-4 border-b border-slate-700 pb-2">{t({ en: 'Scoring Rules Config', it: 'Config Punteggi', fr: 'Config Points', de: 'Punkte-Konfig', es: 'Config Puntos', ru: 'Настройка очков', zh: '计分规则', ar: 'تكوين قواعد التسجيل', ja: 'スコア設定' })}</h3>
              <div className="grid grid-cols-2 gap-4">

                {/* Race Points - Grid of 22 */}
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 block mb-2">{t({ en: 'Race Points (1-22)', it: 'Punti Gara (1-22)', fr: 'Points Course (1-22)', de: 'Rennpunkte (1-22)', es: 'Puntos Carrera (1-22)', ru: 'Очки за гонку (1-22)', zh: '比赛积分 (1-22)', ar: 'نقاط السباق (1-22)', ja: 'レースポイント (1-22)' })}</label>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {Array.from({ length: 22 }).map((_, index) => {
                      // Safely get existing point, default to 0 if out of bounds or undefined
                      const val = (data.rules.racePositionPoints && data.rules.racePositionPoints[index]) || 0;
                      return (
                        <div key={index} className="flex flex-col items-center">
                          <label className="text-[10px] text-slate-500 font-bold">#{index + 1}</label>
                          <input
                            type="number"
                            value={val}
                            onChange={(e) => handleRacePointChange(index, Number(e.target.value))}
                            className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-center text-sm text-white focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Quali */}
                <div><label className="text-xs text-slate-400">{t({ en: 'Pole Position', it: 'Pole Position', fr: 'Pole Position', de: 'Pole Position', es: 'Pole Position', ru: 'Поул-позиция', zh: '杆位', ar: 'قطب الانطلاق', ja: 'ポールポジション' })}</label><input type="number" value={data.rules.qualiPole} onChange={(e) => handleRuleChange('qualiPole', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Q3 Reached (1-10)', it: 'Accesso Q3 (1-10)', fr: 'Q3 Atteint (1-10)', de: 'Q3 Erreicht (1.-10.)', es: 'Q3 Alcanzada (1-10)', ru: 'Q3 Достигнут (1-10)', zh: '进入Q3 (1-10)', ar: 'الوصول لـ Q3 (1-10)', ja: 'Q3進出 (1-10)' })}</label><input type="number" value={data.rules.qualiQ3Reached} onChange={(e) => handleRuleChange('qualiQ3Reached', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Q2 Reached (11-16)', it: 'Accesso Q2 (11-16)', fr: 'Q2 Atteint (11-16)', de: 'Q2 Erreicht (11.-16.)', es: 'Q2 Alcanzada (11-16)', ru: 'Q2 Достигнут (11-16)', zh: '进入Q2 (11-16)', ar: 'الوصول لـ Q2 (11-16)', ja: 'Q2進出 (11-16)' })}</label><input type="number" value={data.rules.qualiQ2Reached} onChange={(e) => handleRuleChange('qualiQ2Reached', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Q1 Elim (17-22)', it: 'Eliminato Q1 (17-22)', fr: 'Éliminé Q1 (17-22)', de: 'Q1 Ausgeschieden (17.-22.)', es: 'Eliminado Q1 (17-22)', ru: 'Выбыл в Q1 (17-22)', zh: 'Q1淘汰 (17-22)', ar: 'إقصاء Q1 (17-22)', ja: 'Q1敗退 (17-22)' })}</label><input type="number" value={data.rules.qualiQ1Eliminated} onChange={(e) => handleRuleChange('qualiQ1Eliminated', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Grid Penalty', it: 'Penalità Griglia', fr: 'Pénalité Grille', de: 'Startplatzstrafe', es: 'Penalización Parrilla', ru: 'Штраф на решетке', zh: '发车位处罚', ar: 'عقوبة الشبكة', ja: 'グリッド降格' })}</label><input type="number" value={data.rules.qualiGridPenalty} onChange={(e) => handleRuleChange('qualiGridPenalty', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Race Bonuses */}
                <div><label className="text-xs text-slate-400">{t({ en: 'Last Place Malus', it: 'Malus Ultimo Posto', fr: 'Malus Dernière Place', de: 'Malus Letzter Platz', es: 'Malus Último Lugar', ru: 'Штраф за посл. место', zh: '倒数第一惩罚', ar: 'عقوبة المركز الأخير', ja: '最下位ペナルティ' })}</label><input type="number" value={data.rules.raceLastPlaceMalus} onChange={(e) => handleRuleChange('raceLastPlaceMalus', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'DNF / DNS / DSQ', it: 'Ritirato / Squalificato', fr: 'Abandon / Disqualifié', de: 'DNF / DNS / DSQ', es: 'Abandono / Descalificado', ru: 'Сход / Дисквал.', zh: '未完赛/取消资格', ar: 'انسحاب / إقصاء', ja: 'リタイア / 失格' })}</label><input type="number" value={data.rules.raceDNF} onChange={(e) => handleRuleChange('raceDNF', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Race Penalty', it: 'Penalità Gara', fr: 'Pénalité Course', de: 'Rennstrafe', es: 'Penalización Carrera', ru: 'Штраф в гонке', zh: '正赛惩罚', ar: 'عقوبة السباق', ja: 'レースペナルティ' })}</label><input type="number" value={data.rules.racePenalty} onChange={(e) => handleRuleChange('racePenalty', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Teammate */}
                <div><label className="text-xs text-slate-400">{t({ en: 'Beat Teammate', it: 'Batte Compagno', fr: 'Bat Coéquipier', de: 'Teamkollegen geschlagen', es: 'Vence Compañero', ru: 'Опередил напарника', zh: '击败队友', ar: 'تغلب على الزميل', ja: 'チームメイトに勝利' })}</label><input type="number" value={data.rules.teammateBeat} onChange={(e) => handleRuleChange('teammateBeat', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Lost to Teammate', it: 'Perde vs Compagno', fr: 'Perd contre Coéquipier', de: 'Verliert gegen Teamk.', es: 'Pierde vs Compañero', ru: 'Проиграл напарнику', zh: '输给队友', ar: 'خسر أمام الزميل', ja: 'チームメイトに敗北' })}</label><input type="number" value={data.rules.teammateLost} onChange={(e) => handleRuleChange('teammateLost', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Beat TM (TM DNF)', it: 'Batte Compagno (Ritirato)', fr: 'Bat Coéquipier (Abandon)', de: 'Teamk. geschlagen (DNF)', es: 'Vence Comp. (Abandono)', ru: 'Опередил (напарник сошел)', zh: '击败队友 (队友退赛)', ar: 'تغلب (انسحاب الزميل)', ja: '勝利 (僚機リタイア)' })}</label><input type="number" value={data.rules.teammateBeatDNF} onChange={(e) => handleRuleChange('teammateBeatDNF', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Sprint */}
                <div className="col-span-2 mt-2">
                  <label className="text-xs text-slate-400 block mb-2">{t({ en: 'Sprint Points (1st - 8th)', it: 'Punti Sprint (1°-8°)', fr: 'Points Sprint (1-8)', de: 'Sprint-Punkte (1.-8.)', es: 'Puntos Sprint (1-8)', ru: 'Очки за спринт (1-8)', zh: '冲刺赛积分 (1-8)', ar: 'نقاط السرعة (1-8)', ja: 'スプリントポイント (1-8)' })}</label>
                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                    {Array.from({ length: 8 }).map((_, index) => {
                      const val = (data.rules.sprintPositionPoints && data.rules.sprintPositionPoints[index]) || 0;
                      return (
                        <div key={index} className="flex flex-col items-center">
                          <label className="text-[10px] text-slate-500 font-bold">#{index + 1}</label>
                          <input
                            type="number"
                            value={val}
                            onChange={(e) => handleSprintSinglePointChange(index, Number(e.target.value))}
                            className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-center text-sm text-white focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Sprint Quali Pole', it: 'Pole Sprint Quali', fr: 'Pole Qualif Sprint', de: 'Sprint Quali Pole', es: 'Pole Sprint Clasif', ru: 'Поул спринт-квал.', zh: '冲刺排位杆位', ar: 'قطب تصفيات السرعة', ja: 'S予選ポール' })}</label><input type="number" value={data.rules.sprintPole} onChange={(e) => handleRuleChange('sprintPole', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
              </div>
            </div>

            {/* Constructor Multipliers */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-4 border-b border-slate-700 pb-2">{t({ en: 'Constructor Multipliers', it: 'Coefficienti Scuderie', fr: 'Coefficients Équipes', de: 'Konstrukteurs-Multiplikatoren', es: 'Coeficientes Constructores', ru: 'Коэффициенты конструкторов', zh: '车队系数', ar: 'معاملات الفرق', ja: 'コンストラクター係数' })}</h3>
              <div className="grid grid-cols-2 gap-3">
                {activeConstructors.map(c => (
                  <div key={c.id} className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-700">
                    <div className="w-1 h-6 rounded-full" style={{ backgroundColor: c.color }}></div>
                    <div className="flex-1">
                      <div className="text-xs text-slate-400">{c.name}</div>
                      <input
                        type="number"
                        step="0.1"
                        value={c.multiplier}
                        onChange={(e) => handleConstructorMultiplierChange(c.id, Number(e.target.value))}
                        className="w-full bg-transparent text-white font-mono text-sm focus:outline-none border-b border-slate-600 focus:border-blue-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Race Results Automated Sync */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-2">
                <h3 className="font-semibold text-white">{t({ en: 'Race Results (Automated)', it: 'Risultati Gara (Automatico)', fr: 'Résultats Course (Auto)', de: 'Rennergebnisse (Auto)', es: 'Resultados Carrera (Auto)', ru: 'Результаты гонки (Авто)', zh: '比赛结果 (自动)', ar: 'نتائج السباق (تلقائي)', ja: 'レース結果 (自動)' })}</h3>
                <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest bg-blue-400/10 px-2 py-0.5 rounded">OpenF1</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                {t({
                  en: 'Fetch official results from OpenF1. This will automatically update driver points based on finishing positions.',
                  it: 'Scarica i risultati ufficiali da OpenF1. Questo aggiornerà automaticamente i punti dei piloti in base alle posizioni d\'arrivo.',
                  fr: 'Récupérer résultats officiels OpenF1. Met à jour les points pilotes automatiquement.',
                  de: 'Offizielle Ergebnisse von OpenF1 laden. Aktualisiert Fahrerpunkte automatisch.',
                  es: 'Obtener resultados oficiales de OpenF1. Actualiza puntos automáticamente.',
                  ru: 'Получить официальные результаты из OpenF1. Автоматически обновляет очки пилотов.',
                  zh: '从OpenF1获取官方结果。将根据完赛位置自动更新车手积分。',
                  ar: 'جلب النتائج الرسمية من OpenF1. سيتم تحديث نقاط السائقين تلقائياً.',
                  ja: 'OpenF1から公式結果を取得。順位に基づいてドライバーポイントを自動更新します。'
                })}
              </p>
              <button
                onClick={handleSyncOpenF1}
                disabled={syncing}
                className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg ${syncing ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-900/20'}`}
              >
                {syncing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                    {t({ en: 'Syncing...', it: 'Sincronizzazione...', fr: 'Sync...', de: 'Sync...', es: 'Sincronizando...', ru: 'Синхронизация...', zh: '同步中...', ar: 'مزامنة...', ja: '同期中...' })}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    {t({ en: 'Sync results with OpenF1', it: 'Sincronizza risultati OpenF1', fr: 'Sync résultats avec OpenF1', de: 'Ergebnisse mit OpenF1 sync.', es: 'Sincronizar resultados OpenF1', ru: 'Синхр. результаты OpenF1', zh: '同步OpenF1结果', ar: 'مزامنة نتائج OpenF1', ja: 'OpenF1と同期' })}
                  </>
                )}
              </button>
            </div>

            {/* Admin Driver Config (Merged) */}
            {renderAdmin()}

            {/* Toggle Debug */}
            <div className="flex justify-center">
              <button
                onClick={() => setShowDebug(!showDebug)}
                className="text-xs text-slate-500 hover:text-slate-300 underline"
              >
                {showDebug ? t({ en: 'Hide Debug Info', it: 'Nascondi Debug', fr: 'Masquer Debug', de: 'Debug verbergen', es: 'Ocultar Debug', ru: 'Скрыть отладку', zh: '隐藏调试', ar: 'إخفاء التصحيح', ja: 'デバッグ非表示' }) : t({ en: 'Show Debug Info', it: 'Mostra Debug', fr: 'Afficher Debug', de: 'Debug zeigen', es: 'Mostrar Debug', ru: 'Показать отладку', zh: '显示调试', ar: 'إظهار التصحيح', ja: 'デバッグ表示' })}
              </button>
            </div>

            {/* Debug Info (Collapsed) */}
            {showDebug && (
              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/50">
                <h3 className="font-semibold text-white mb-2">{t({ en: 'Debug', it: 'Debug', fr: 'Debug', de: 'Debug', es: 'Debug', ru: 'Отладка', zh: '调试', ar: 'تصحيح', ja: 'デバッグ' })}</h3>
                <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded mb-4 overflow-x-auto border border-slate-800">
                  {JSON.stringify(data.team, null, 2)}
                </div>

                <h3 className="font-semibold text-white mb-2 mt-4">{t({ en: 'Race Lock Debug', it: 'Debug Blocco Gara', fr: 'Debug Verrouillage', de: 'Renn-Sperre Debug', es: 'Debug Bloqueo', ru: 'Отладка блокировки', zh: '锁定调试', ar: 'تصحيح قفل السباق', ja: 'レースロックデバッグ' })}</h3>
                <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded mb-4 overflow-x-auto border border-slate-800">
                  <p>Race: {currentRace.name}</p>
                  <p>Status: <span className={getStatusColor(lockState.status)}>{lockState.status}</span></p>
                  <p>Session: {currentRace.isSprint ? t({ en: 'Sprint Qualifying', it: 'Sprint Shootout', fr: 'Qualif Sprint', de: 'Sprint Quali', es: 'Sprint Clasif', ru: 'Спринт Квал', zh: '冲刺排位', ar: 'تصفيات السرعة', ja: 'スプリント予選' }) : t({ en: 'Qualifying', it: 'Qualifiche', fr: 'Qualifications', de: 'Qualifying', es: 'Clasificación', ru: 'Квалификация', zh: '排位赛', ar: 'التصفيات', ja: '予選' })}</p>
                  <p>Target UTC: {lockState.targetSessionUtc || 'N/A'}</p>
                  <p>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</p>
                  <p>Server Time: {new Date(now).toISOString()}</p>
                </div>
              </div>
            )}
          </fieldset>
        );

      case Tab.STANDINGS:
        return renderStandings();


      default:
        return <div>Tab not found</div>;
    }
  };

  const handleAdminValueChange = (driverId: string, field: 'price' | 'points', val: number) => {
    setAdminUpdates(prev => {
      const existing = prev[driverId] || fetchedDrivers.find(d => d.id === driverId) || { price: 0, points: 0 };
      return {
        ...prev,
        [driverId]: { ...existing, [field]: val }
      };
    });
  };

  const saveAdminUpdates = async () => {
    const list = Object.entries(adminUpdates).map(([id, vals]) => ({ id, ...vals as object }));
    if (list.length === 0) return;

    try {
      await updateDriverInfo(list);
      // Refresh local list
      const updated = await getDrivers();
      setFetchedDrivers(updated);
      setAdminUpdates({});
      alert(t({ en: "Changes saved!", it: "Cambiamenti salvati!" }));
    } catch (e) {
      console.error(e);
      alert(t({ en: "Error saving changes.", it: "Errore durante il salvataggio." }));
    }
  };



  const handleKickMember = async (targetUserId: string, targetName: string) => {
    if (!confirm(t({ en: `Kick ${targetName}?`, it: `Espellere ${targetName}?` }))) return;
    if (!data?.user?.leagueId) return;

    try {
      await kickMember(data.user.leagueId, targetUserId);
      alert(t({ en: "User kicked.", it: "Utente espulso." }));
      // Refresh
      const { leagues } = await getMe();
      if (leagues[0]?.members) setLeagueMembers(leagues[0].members);
    } catch (e) {
      console.error(e);
      alert(t({ en: "Failed to kick user.", it: "Errore durante l'espulsione." }));
    }
  };

  const handleDeleteLeague = async () => {
    if (!confirm(t({ en: "DELETE ENTIRE LEAGUE? This cannot be undone.", it: "CANCELLARE INTERA LEGA? Non si può annullare." }))) return;
    if (!confirm(t({ en: "Are you really sure?", it: "Sei davvero sicuro?" }))) return;
    if (!data?.user?.leagueId) return;

    try {
      await deleteLeague(data.user.leagueId);
      alert(t({ en: "League deleted.", it: "Lega cancellata." }));
      handleLogout();
    } catch (e) {
      console.error(e);
      alert(t({ en: "Failed to delete league.", it: "Errore durante la cancellazione." }));
    }
  };
  const handleAddPenalty = async (targetUserId: string, targetName: string, targetTeamId: string | undefined) => {
     if (!targetTeamId) {
        alert(t({ en: "User has no team yet.", it: "L'utente non ha ancora una squadra." }));
        return;
     }

     const pointsStr = prompt(t({ en: `Enter penalty points for ${targetName} (e.g. -10 for penalty, 10 for bonus):`, it: `Inserisci punti penalità per ${targetName} (es. -10 per penalità, 10 per bonus):` }));
     if (!pointsStr) return;
     const points = parseFloat(pointsStr);
     if (isNaN(points)) {
        alert(t({ en: "Invalid number", it: "Numero non valido" }));
        return;
     }

     const comment = prompt(t({ en: "Reason/Comment:", it: "Motivo/Commento:" })) || "Admin Penalty";

     if (!data?.user?.leagueId) return;

     try {
        await addPenalty(data.user.leagueId, targetTeamId, points, comment);
        alert(t({ en: "Penalty applied.", it: "Penalità applicata." }));
        // Refresh
        const { leagues } = await getMe();
        if (leagues[0]?.members) setLeagueMembers(leagues[0].members);
     } catch (e) {
        console.error(e);
        alert(t({ en: "Failed to apply penalty.", it: "Errore durante l'applicazione." }));
     }
  };

  const handleSaveRules = async () => {
    if (!data?.user?.leagueId || !data.rules) return;
    try {
        await updateLeagueRules(data.user.leagueId, data.rules);
        alert(t({ en: "Rules saved!", it: "Regole salvate!" }));
    } catch (e) {
        console.error(e);
        alert(t({ en: "Error saving rules.", it: "Errore salvataggio regole." }));
    }
  };

  const handleRuleChangeNumeric = (field: keyof ScoringRules, value: string) => {
      const num = parseFloat(value);
      if (isNaN(num)) return;
      setData(prev => prev ? { ...prev, rules: { ...prev.rules, [field]: num } } : null);
  };


  const handleWatchAdForPremium = async () => {
    const reward = await showRewardVideo();
    if (reward) {
      const now = Date.now();
      const expiry = now + 24 * 60 * 60 * 1000; // 24 hours
      setIsPremium(true);
      localStorage.setItem('fantaF1Premium', 'true');
      localStorage.setItem('fantaF1PremiumExpiry', String(expiry));
      alert(t({ en: "Premium activated for 24h!", it: "Premium attivato per 24h!" }));
    }
  };

  const renderAdmin = () => {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-white">{t({ en: 'Administrator', it: 'Amministratore' })}</h1>
          <p className="text-slate-400 text-sm">{t({ en: 'Manage drivers prices and points.', it: 'Gestisci quotazioni e punteggi.', fr: 'Gérer prix et points pilotes.', de: 'Fahrerpreise und Punkte verwalten.', es: 'Gestionar precios y puntos.', ru: 'Управление ценами и очками.', zh: '管理车手价格和积分。', ar: 'إدارة أسعار ونقاط السائقين.', ja: 'ドライバー価格とポイント管理。' })}</p>
        </header>

        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-4">
             <div className="flex justify-between items-center border-b border-slate-700 pb-2">
                 <h2 className="text-lg font-bold text-white uppercase tracking-wider">{t({ en: 'Scoring Rules', it: 'Regole Punteggio' })}</h2>
                 <button 
                    onClick={handleSaveRules}
                    className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-2 px-4 rounded transition-all"
                 >
                    {t({ en: 'SAVE RULES', it: 'SALVA REGOLE' })}
                 </button>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                 <div>
                    <label className="text-[10px] uppercase text-slate-500 font-bold mb-1 block">
                        {t({ en: 'Overtake (P1-10)', it: 'Sorpasso (P1-10)' })}
                    </label>
                    <input 
                        type="number" step="0.1"
                        value={data?.rules.positionGainedPos1_10 ?? 1}
                        onChange={(e) => handleRuleChangeNumeric('positionGainedPos1_10', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono text-sm"
                    />
                 </div>
                 <div>
                    <label className="text-[10px] uppercase text-slate-500 font-bold mb-1 block">
                        {t({ en: 'Overtake (P11+)', it: 'Sorpasso (P11+)' })}
                    </label>
                    <input 
                        type="number" step="0.1"
                        value={data?.rules.positionGainedPos11_Plus ?? 0.5}
                        onChange={(e) => handleRuleChangeNumeric('positionGainedPos11_Plus', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono text-sm"
                    />
                 </div>
                 <div>
                    <label className="text-[10px] uppercase text-slate-500 font-bold mb-1 block">
                        {t({ en: 'Lost Pos (P1-10)', it: 'Pos Persa (P1-10)' })}
                    </label>
                    <input 
                        type="number" step="0.1"
                        value={data?.rules.positionLostPos1_10 ?? -1}
                        onChange={(e) => handleRuleChangeNumeric('positionLostPos1_10', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono text-sm"
                    />
                 </div>
                 <div>
                    <label className="text-[10px] uppercase text-slate-500 font-bold mb-1 block">
                        {t({ en: 'Lost Pos (P11+)', it: 'Pos Persa (P11+)' })}
                    </label>
                    <input 
                        type="number" step="0.1"
                        value={data?.rules.positionLostPos11_Plus ?? -0.5}
                        onChange={(e) => handleRuleChangeNumeric('positionLostPos11_Plus', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono text-sm"
                    />
                 </div>
             </div>
        </div>

        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-4">
          <h2 className="text-lg font-bold text-white uppercase tracking-wider border-b border-slate-700 pb-2">{t({ en: 'League Management', it: 'Gestione Lega' })}</h2>
          
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">{t({ en: 'Members', it: 'Membri' })}</h3>
            {leagueMembers.map(m => (
              <div key={m.userId} className="flex justify-between items-center bg-slate-900/50 p-2 rounded">
                 <div>
                    <span className="text-white font-medium">{m.userName}</span>
                    <span className="ml-2 text-xs text-slate-500">{m.role}</span>
                 </div>
                 {m.userId !== data?.user?.id && (
                    <div className="flex">
                      <button 
                        onClick={() => handleKickMember(m.userId, m.userName)}
                        className="text-red-400 hover:text-red-300 px-2"
                        title="Kick User"
                      >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                      <button 
                        onClick={() => handleAddPenalty(m.userId, m.userName, m.teamId)}
                        className="text-yellow-400 hover:text-yellow-300 px-2"
                        title="Add Penalty/Bonus"
                      >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>
                      </button>
                    </div>
                 )}
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-700">
             <button 
                onClick={handleDeleteLeague}
                className="w-full bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-700 font-bold py-2 rounded transition-all flex items-center justify-center gap-2"
             >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                {t({ en: 'DELETE LEAGUE', it: 'CANCELLA LEGA' })}
             </button>
          </div>
        </div>

        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-700 pb-2">
             <h2 className="text-lg font-bold text-white uppercase tracking-wider">{t({ en: 'Drivers List', it: 'Lista Piloti', fr: 'Liste Pilotes', de: 'Fahrerliste', es: 'Lista Pilotos', ru: 'Список пилотов', zh: '车手列表', ar: 'قائمة السائقين', ja: 'ドライバー一覧' })}</h2>
             <button 
                onClick={saveAdminUpdates}
                disabled={Object.keys(adminUpdates).length === 0}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-xs font-bold py-2 px-4 rounded transition-all"
             >
                {t({ en: 'SAVE ALL', it: 'SALVA TUTTO', fr: 'TOUT SAUVER', de: 'ALLE SPEICHERN', es: 'GUARDAR TODO', ru: 'СОХР ВСЕ', zh: '全部保存', ar: 'حفظ الكل', ja: '全て保存' })}
             </button>
          </div>

          <div className="space-y-3">
             {fetchedDrivers.map(d => {
                const draft = adminUpdates[d.id];
                const price = draft ? draft.price : d.price;
                const points = draft ? draft.points : d.points;
                const c = activeConstructors.find(con => con.id === d.constructorId);

                return (
                   <div key={d.id} className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                         <div className="w-1 h-6 rounded-full" style={{ backgroundColor: c?.color || '#555' }}></div>
                         <div className="font-bold text-white">{d.name}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label className="text-[10px] uppercase text-slate-500 font-bold mb-1 block">{t({ en: 'Price ($M)', it: 'Prezzo ($M)', fr: 'Prix ($M)', de: 'Preis ($M)', es: 'Precio ($M)', ru: 'Цена ($M)', zh: '价格 ($M)', ar: 'السعر ($M)', ja: '価格 ($M)' })}</label>
                            <input 
                               type="number" 
                               step="0.1" 
                               value={price}
                               onChange={(e) => handleAdminValueChange(d.id, 'price', Number(e.target.value))}
                               className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono text-sm"
                            />
                         </div>
                         <div>
                            <label className="text-[10px] uppercase text-slate-500 font-bold mb-1 block">{t({ en: 'Total Pts', it: 'Punti Tot.', fr: 'Pts Tot.', de: 'Punkte Ges.', es: 'Pts Tot.', ru: 'Всего Очк.', zh: '总分', ar: 'مجموع النقاط', ja: '合計Pt' })}</label>
                            <input 
                               type="number" 
                               value={points}
                               onChange={(e) => handleAdminValueChange(d.id, 'points', Number(e.target.value))}
                               className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono text-sm"
                            />
                         </div>
                      </div>
                   </div>
                );
             })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <ErrorBoundary>
        {LangMenu}
        <Layout
          activeTab={activeTab}
          onTabChange={setActiveTab}
          showAdmin={data?.user?.isAdmin}
          lang={language}
          t={t}
        > 
          <AdBanner isPremium={isPremium} />
          {renderContent()}
        </Layout>
      </ErrorBoundary>
    </>
  );
};

export default App;


