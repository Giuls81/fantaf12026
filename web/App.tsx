import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import { AppData, Tab, UserTeam, Driver, Race, User, ScoringRules } from './types';
import { DEFAULT_SCORING_RULES, DRIVERS, CONSTRUCTORS } from './constants';
import { health, getRaces, getDrivers, createAnonUser, createLeague, joinLeague, getMe, updateMarket, updateLineup, updateDriverInfo, getApiUrl } from "./api";
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
  constructors: CONSTRUCTORS,
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // API returns ISO strings (YYYY-MM-DDTHH:mm:ss.sssZ) - new Date() parses them correctly
  const idx = races.findIndex(r => new Date(r.date) >= today);
  return idx === -1 ? races.length - 1 : idx;
};

type LangCode = 'en' | 'it' | 'fr' | 'de' | 'es' | 'ru' | 'zh' | 'ar' | 'ja';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.HOME);
  const [data, setData] = useState<AppData | null>(null);
  const [swapCandidate, setSwapCandidate] = useState<Driver | null>(null);
  const [now, setNow] = useState(Date.now());
  const [races, setRaces] = useState<Race[]>([]);
  const [fetchedDrivers, setFetchedDrivers] = useState<Driver[]>([]);
  const [adminUpdates, setAdminUpdates] = useState<Record<string, { price: number; points: number }>>({});

  // 1. Initial Load (races + drivers)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [apiRaces, apiDrivers] = await Promise.all([getRaces(), getDrivers()]);
        if (alive) {
          setRaces(apiRaces);
          setFetchedDrivers(apiDrivers);
        }
      } catch (e: any) {
        console.error("API load failed", e);
        // Fallback for races? Or Alert?
        alert(`Failed to load race data: ${e.message}`);
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
  const [sprintPointsInput, setSprintPointsInput] = useState('');
  const [pointsError, setPointsError] = useState<{ sprint?: string }>({});

  const [showDebug, setShowDebug] = useState(false);

  // Login Form State
  const [username, setUsername] = useState('');
  const [loginMode, setLoginMode] = useState<'create' | 'join'>('create');
  const [leagueName, setLeagueName] = useState('');
  const [leagueCodeInput, setLeagueCodeInput] = useState('');

  // UI State
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  // Timer for countdown
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
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
    if (!token) return;

    (async () => {
      try {
        const { user, leagues } = await getMe();
          const firstLeague = leagues[0];
          const fullUser: User = {
            id: user.id,
            name: 'Player', 
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

  // Translation Helper
  const t = (dict: { [key: string]: string }) => {
    return dict[language] || dict['en'] || '';
  };

  // NOTE: The separate useEffect for loading races from localStorage has been removed
  // to avoid overwriting the API call in the main useEffect above.

  // Load data from localStorage on mount
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
        if (typeof parsed.currentRaceIndex !== 'number') {
          parsed.currentRaceIndex = getNextRaceIndex(races);
        } else {
          if (parsed.currentRaceIndex < 0) parsed.currentRaceIndex = 0;
          if (parsed.currentRaceIndex >= races.length) parsed.currentRaceIndex = races.length - 1;
        }
        // Migration for constructors if missing
        if (!parsed.constructors) {
          parsed.constructors = CONSTRUCTORS;
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

  // Sync Drafts with current race and rules when entering Admin or when data changes
  useEffect(() => {
    if (data && races.length > 0) {
      const race = races[data.currentRaceIndex];
      setQualifyingUtcDraft(race.qualifyingUtc || '');
      setSprintQualifyingUtcDraft(race.sprintQualifyingUtc || '');
    }
    if (data && data.rules) {
      // Initialize text inputs for points only if they are empty (first load)
      // to avoid overwriting user typing if data updates in background (unlikely here but safe)
      setSprintPointsInput(prev => prev || data.rules.sprintPositionPoints.join(', '));
    }
  }, [data?.currentRaceIndex, races, activeTab]);
  // Dependency on activeTab ensures re-sync when entering Admin

  // Save data to localStorage whenever it changes
  useEffect(() => {
    if (data && data.user) {
      localStorage.setItem('fantaF1Data', JSON.stringify(data));
    }
  }, [data]);

  // Save races to localStorage (Updates when Admin edits or API loads)

  // NOTE: persistence of races to localStorage disabled (races are sourced from API)
  // Redirect non-admins if they try to access Admin tab
  useEffect(() => {
    if (data?.user && !data.user.isAdmin && activeTab === Tab.ADMIN) {
      setActiveTab(Tab.HOME);
    }
  }, [activeTab, data]);

  const handleLogin = async () => {
    if (!username.trim()) return alert(t({ en: "Please enter a username.", it: "Inserisci un nome utente." }));

    try {
      // 1. Create User (Anon)
      const { authToken } = await createAnonUser();
      localStorage.setItem('fantaF1AuthToken', authToken);

      // 2. Create or Join League
      if (loginMode === 'create') {
         if (!leagueName.trim()) return alert(t({ en: "Please enter a league name.", it: "Inserisci il nome della lega." }));
         await createLeague(leagueName.trim());
      } else {
         if (!leagueCodeInput.trim() || leagueCodeInput.length < 6) return alert(t({ en: "Please enter a valid 6-character league code.", it: "Inserisci un codice lega valido di 6 caratteri." }));
         await joinLeague(leagueCodeInput.trim().toUpperCase());
      }

      // 3. Refresh Me (to get User object with League info)
      const { user, leagues } = await getMe();
      const myLeague = leagues[0];
      
      const newUser: User = {
        id: user.id,
        name: username.trim(), 
        isAdmin: myLeague.isAdmin,
        leagueId: myLeague.id,
        leagueName: myLeague.name,
        leagueCode: myLeague.joinCode
      };

      const serverTeam: UserTeam = myLeague.team ? {
        name: 'My F1 Team',
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
      let msg = t({ en: "Login failed.", it: "Login fallito." });
      
      if (e.message && e.message.includes("league_not_found")) {
        msg = t({ en: "League not found. Check the code.", it: "Lega non trovata. Controlla il codice." });
      } else if (e.message && e.message.includes("404")) {
         msg = t({ en: "League not found.", it: "Lega non trovata." });
      } else {
         // Verbose debug for mobile
         msg += `\nError: ${e.message || String(e)}`;
         msg += `\nAPI: ${getApiUrl()}`;
      }

      alert(msg);
      localStorage.removeItem('fantaF1AuthToken');
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
    setLeagueName('');
    setLeagueCodeInput('');
    setLoginMode('create');
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
    if (data.team.budget < driver.price) {
      alert(t({ en: "Insufficient budget!", it: "Budget insufficiente!" }));
      return;
    }

    try {
      const { newBudget } = await updateMarket(data.user.leagueId, driver.id);
      
      const newDriverIds = [...data.team.driverIds, driver.id];
      const newTeamRaw = {
        ...data.team,
        driverIds: newDriverIds,
        budget: newBudget,
        totalValue: calculateTotalValue(newBudget, newDriverIds)
      };

      setData({
        ...data,
        team: sanitizeTeamRoles(newTeamRaw)
      });
    } catch (e: any) {
      console.error(e);
      alert(t({ en: "Market update failed.", it: "Aggiornamento mercato fallito." }));
    }
  };

  const handleSwapDriver = async (driverOut: Driver, driverIn: Driver) => {
    if (!data?.user) return;
    const estimatedBudget = data.team.budget + driverOut.price - driverIn.price;
    if (estimatedBudget < 0) {
      alert(t({ en: "Insufficient budget for this swap.", it: "Budget insufficiente per questo scambio." }));
      return;
    }

    try {
      const { newBudget } = await updateMarket(data.user.leagueId, driverIn.id, driverOut.id);
      
      const newDriverIds = data.team.driverIds.filter(id => id !== driverOut.id);
      newDriverIds.push(driverIn.id);

      const newTeamRaw = {
        ...data.team,
        driverIds: newDriverIds,
        budget: newBudget,
        totalValue: calculateTotalValue(newBudget, newDriverIds)
      };

      setData({
        ...data,
        team: sanitizeTeamRoles(newTeamRaw)
      });
      setSwapCandidate(null);
    } catch (e: any) {
      console.error(e);
      alert(t({ en: "Swap failed.", it: "Scambio fallito." }));
    }
  };

  const isValidUtc = (str: string) => {
    return str.trim() !== '' && !isNaN(new Date(str).getTime());
  };

  const handleSaveQuali = () => {
    if (!data) return;
    if (!isValidUtc(qualifyingUtcDraft)) return;

    const newRaces = [...races];
    newRaces[data.currentRaceIndex] = {
      ...newRaces[data.currentRaceIndex],
      qualifyingUtc: qualifyingUtcDraft.trim()
    };
    setRaces(newRaces);
  };

  const handleSaveSprint = () => {
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

  const handleRuleChange = (key: keyof ScoringRules, value: any) => {
    if (!data) return;
    setData({
      ...data,
      rules: {
        ...data.rules,
        [key]: value
      }
    });
  };

  const handleRacePointChange = (index: number, val: number) => {
    if (!data) return;
    if (!Number.isFinite(val)) return; // Anti-NaN

    // Safeguard: handle if array is smaller (e.g. from old localstorage)
    const newPoints = [...(data.rules.racePositionPoints || [])];

    // Ensure we have enough slots
    while (newPoints.length < 22) {
      newPoints.push(0);
    }

    newPoints[index] = val;
    handleRuleChange('racePositionPoints', newPoints);
  };

  const handleSprintPointsChange = (input: string) => {
    setSprintPointsInput(input);
    // Robust split and validation
    const parts = input.split(',').map(s => {
      const trimmed = s.trim();
      return trimmed === '' ? NaN : Number(trimmed);
    });

    if (parts.length !== 8 || parts.some(n => !Number.isFinite(n))) {
      setPointsError(prev => ({ ...prev, sprint: t({ en: 'Must be 8 numbers separated by commas', it: 'Devono essere 8 numeri separati da virgole' }) }));
    } else {
      setPointsError(prev => ({ ...prev, sprint: undefined }));
      handleRuleChange('sprintPositionPoints', parts);
    }
  };

  const handleConstructorMultiplierChange = (id: string, multiplier: number) => {
    if (!data) return;
    const newConstructors = data.constructors.map(c =>
      c.id === id ? { ...c, multiplier } : c
    );
    setData({
      ...data,
      constructors: newConstructors
    });
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

  // --------------------------------------------------------------------------------
  // RENDER
  // --------------------------------------------------------------------------------

  const LangMenu = (
    <div className="fixed top-4 right-4 z-50 flex flex-col items-end">
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
  if (!data) return <div className="flex h-screen items-center justify-center text-slate-400">Loading Paddock...</div>;

  // Login / Auth Screen
  if (!data.user) {
    return (
      <div className="flex flex-col h-screen bg-slate-900 text-white items-center justify-center p-6">
        {LangMenu}
        <h1 className="text-4xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-red-500">
          FantaF1
        </h1>
        <p className="text-slate-400 mb-8">2026 Season Manager</p>

        <div className="w-full max-w-sm bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-2xl">

          {/* Mode Toggle */}
          <div className="flex bg-slate-900 rounded-lg p-1 mb-6">
            <button
              onClick={() => setLoginMode('create')}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${loginMode === 'create' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {t({ en: 'Create League', it: 'Crea Lega', fr: 'CrÃƒÂ©er ligue', de: 'Liga erstellen', es: 'Crear liga', ru: 'ÃÂ¡ÃÂ¾ÃÂ·ÃÂ´ÃÂ°Ã‘â€šÃ‘Å’ ÃÂ»ÃÂ¸ÃÂ³Ã‘Æ’', zh: 'Ã¥Ë†â€ºÃ¥Â»ÂºÃ¨Ââ€Ã§â€ºÅ¸', ar: 'Ã˜Â¥Ã™â€ Ã˜Â´Ã˜Â§Ã˜Â¡ Ã˜Â¯Ã™Ë†Ã˜Â±Ã™Å ', ja: 'Ã£Æ’ÂªÃ£Æ’Â¼Ã£â€šÂ°Ã¤Â½Å“Ã¦Ë†Â' })}
            </button>
            <button
              onClick={() => setLoginMode('join')}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${loginMode === 'join' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {t({ en: 'Join League', it: 'Unisciti', fr: 'Rejoindre', de: 'Beitreten', es: 'Unirse', ru: 'Ãâ€™ÃÂ¾ÃÂ¹Ã‘â€šÃÂ¸', zh: 'Ã¥Å  Ã¥â€¦Â¥Ã¨Ââ€Ã§â€ºÅ¸', ar: 'Ã˜Â§Ã™â€ Ã˜Â¶Ã™â€¦Ã˜Â§Ã™â€¦', ja: 'Ã¥Ââ€šÃ¥Å  ' })}
            </button>
          </div>

          {/* Common Input */}
          <div className="mb-4">
            <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'Username', it: 'Nome Utente', fr: "Nom d'utilisateur", de: 'Benutzername', es: 'Usuario', ru: 'ÃËœÃÂ¼Ã‘Â ÃÂ¿ÃÂ¾ÃÂ»Ã‘Å’ÃÂ·ÃÂ¾ÃÂ²ÃÂ°Ã‘â€šÃÂµÃÂ»Ã‘Â', zh: 'Ã§â€Â¨Ã¦Ë†Â·Ã¥ÂÂ', ar: 'Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦', ja: 'Ã£Æ’Â¦Ã£Æ’Â¼Ã£â€šÂ¶Ã£Æ’Â¼Ã¥ÂÂ' })}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t({ en: 'Enter your name', it: 'Inserisci nome', fr: 'Entrez votre nom', de: 'Name eingeben', es: 'Ingresa tu nombre', ru: 'Ãâ€™ÃÂ²ÃÂµÃÂ´ÃÂ¸Ã‘â€šÃÂµ ÃÂ¸ÃÂ¼Ã‘Â', zh: 'Ã¨Â¾â€œÃ¥â€¦Â¥Ã¥ÂÂÃ¥Â­â€”', ar: 'Ã˜Â£Ã˜Â¯Ã˜Â®Ã™â€ž Ã˜Â§Ã˜Â³Ã™â€¦Ã™Æ’', ja: 'Ã¥ÂÂÃ¥â€°ÂÃ£â€šâ€™Ã¥â€¦Â¥Ã¥Å â€º' })}
              className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Create Fields */}
          {loginMode === 'create' && (
            <div className="mb-6">
              <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'League Name', it: 'Nome Lega', fr: 'Nom de la ligue', de: 'Liganame', es: 'Nombre Liga', ru: 'ÃÂÃÂ°ÃÂ·ÃÂ²ÃÂ°ÃÂ½ÃÂ¸ÃÂµ ÃÂ»ÃÂ¸ÃÂ³ÃÂ¸', zh: 'Ã¨Ââ€Ã§â€ºÅ¸Ã¥ÂÂÃ§Â§Â°', ar: 'Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã™Å ', ja: 'Ã£Æ’ÂªÃ£Æ’Â¼Ã£â€šÂ°Ã¥ÂÂ' })}</label>
              <input
                type="text"
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                placeholder={t({ en: 'e.g. Sunday Racing Club', it: 'es. Racing Club', fr: 'ex. Racing Club', de: 'z.B. Racing Club', es: 'ej. Racing Club', ru: 'ÃÂ½ÃÂ°ÃÂ¿Ã‘â‚¬. ÃÅ¡ÃÂ»Ã‘Æ’ÃÂ±', zh: 'Ã¤Â¾â€¹Ã¥Â¦â€šÃ¯Â¼Å¡Ã¥â€˜Â¨Ã¦â€”Â¥Ã¨Âµâ€ºÃ¨Â½Â¦', ar: 'Ã™â€¦Ã˜Â«Ã˜Â§Ã™â€ž: Ã™â€ Ã˜Â§Ã˜Â¯Ã™Å  Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¨Ã˜Â§Ã™â€š', ja: 'Ã¤Â¾â€¹: Ã£Æ’Â¬Ã£Æ’Â¼Ã£â€šÂ·Ã£Æ’Â³Ã£â€šÂ°Ã£â€šÂ¯Ã£Æ’Â©Ã£Æ’â€“' })}
                className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Join Fields */}
          {loginMode === 'join' && (
            <div className="mb-6">
              <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'League Code', it: 'Codice Lega', fr: 'Code Ligue', de: 'Liga-Code', es: 'CÃƒÂ³digo Liga', ru: 'ÃÅ¡ÃÂ¾ÃÂ´ ÃÂ»ÃÂ¸ÃÂ³ÃÂ¸', zh: 'Ã¨Ââ€Ã§â€ºÅ¸Ã¤Â»Â£Ã§ Â', ar: 'Ã˜Â±Ã™â€¦Ã˜Â² Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã™Å ', ja: 'Ã£Æ’ÂªÃ£Æ’Â¼Ã£â€šÂ°Ã£â€šÂ³Ã£Æ’Â¼Ã£Æ’â€°' })}</label>
              <input
                type="text"
                value={leagueCodeInput}
                onChange={(e) => setLeagueCodeInput(e.target.value.toUpperCase())}
                placeholder={t({ en: '6-Digit Code', it: 'Codice 6 cifre', fr: 'Code 6 chiffres', de: '6-stelliger Code', es: 'CÃƒÂ³digo 6 dÃƒÂ­gitos', ru: '6 Ã‘â€ ÃÂ¸Ã‘â€žÃ‘â‚¬', zh: '6Ã¤Â½ÂÃ¤Â»Â£Ã§ Â', ar: 'Ã˜Â±Ã™â€¦Ã˜Â² Ã™â€¦Ã™â€  6 Ã˜Â£Ã˜Â±Ã™â€šÃ˜Â§Ã™â€¦', ja: '6Ã¦Â¡ÂÃ£â€šÂ³Ã£Æ’Â¼Ã£Æ’â€°' })}
                maxLength={6}
                className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest uppercase"
              />
            </div>
          )}

          <button
            onClick={handleLogin}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-3 px-4 rounded transition-all shadow-lg transform hover:scale-[1.02]"
          >
            {loginMode === 'create' ? t({ en: 'Start Season', it: 'Inizia Stagione', fr: 'DÃƒÂ©marrer saison', de: 'Saison starten', es: 'Iniciar temporada', ru: 'ÃÂÃÂ°Ã‘â€¡ÃÂ°Ã‘â€šÃ‘Å’ Ã‘ÂÃÂµÃÂ·ÃÂ¾ÃÂ½', zh: 'Ã¥Â¼â‚¬Ã¥Â§â€¹Ã¨Âµâ€ºÃ¥Â­Â£', ar: 'Ã˜Â¨Ã˜Â¯Ã˜Â¡ Ã˜Â§Ã™â€žÃ™â€¦Ã™Ë†Ã˜Â³Ã™â€¦', ja: 'Ã£â€šÂ·Ã£Æ’Â¼Ã£â€šÂºÃ£Æ’Â³Ã©â€“â€¹Ã¥Â§â€¹' }) : t({ en: 'Join Season', it: 'Unisciti', fr: 'Rejoindre saison', de: 'Beitreten', es: 'Unirse', ru: 'ÃÅ¸Ã‘â‚¬ÃÂ¸Ã‘ÂÃÂ¾ÃÂµÃÂ´ÃÂ¸ÃÂ½ÃÂ¸Ã‘â€šÃ‘Å’Ã‘ÂÃ‘Â', zh: 'Ã¥Å  Ã¥â€¦Â¥Ã¨Âµâ€ºÃ¥Â­Â£', ar: 'Ã˜Â§Ã™â€ Ã˜Â¶Ã™â€¦Ã˜Â§Ã™â€¦ Ã™â€žÃ™â€žÃ™â€¦Ã™Ë†Ã˜Â³Ã™â€¦', ja: 'Ã£â€šÂ·Ã£Æ’Â¼Ã£â€šÂºÃ£Æ’Â³Ã¥Ââ€šÃ¥Å  ' })}
          </button>

        </div>
      </div>
    );
  }

  // Main App Content (Only rendered if logged in)
  const currentRace = races[data.currentRaceIndex];
  const lockState = getLockStatus(currentRace, now);
  // Use constructors from data (editable) fallback to constant if needed
  const activeConstructors = data.constructors || CONSTRUCTORS;

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
              <h1 className="text-2xl font-bold text-white">{t({ en: 'Welcome', it: 'Benvenuto', fr: 'Bienvenue', de: 'Willkommen', es: 'Bienvenido', ru: 'Ãâ€ÃÂ¾ÃÂ±Ã‘â‚¬ÃÂ¾ ÃÂ¿ÃÂ¾ÃÂ¶ÃÂ°ÃÂ»ÃÂ¾ÃÂ²ÃÂ°Ã‘â€šÃ‘Å’', zh: 'Ã¦Â¬Â¢Ã¨Â¿Å½', ar: 'Ã™â€¦Ã˜Â±Ã˜Â­Ã˜Â¨Ã˜Â§Ã™â€¹', ja: 'Ã£â€šË†Ã£Ââ€ Ã£Ââ€œÃ£ÂÂ' })}, {data.user?.name}</h1>
              <p className="text-slate-400">
                {data.user?.isAdmin ? `${t({ en: 'Admin of', it: 'Admin di', fr: 'Admin de', de: 'Admin von', es: 'Admin de', ru: 'ÃÂÃÂ´ÃÂ¼ÃÂ¸ÃÂ½', zh: 'Ã§Â®Â¡Ã§Ââ€ Ã¥â€˜Ëœ', ar: 'Ã™â€¦Ã˜Â³Ã˜Â¤Ã™Ë†Ã™â€ž Ã˜Â¹Ã™â€ ', ja: 'Ã§Â®Â¡Ã§Ââ€ Ã¨â‚¬â€¦' })} ${data.user.leagueName}` : t({ en: 'Member', it: 'Membro', fr: 'Membre', de: 'Mitglied', es: 'Miembro', ru: 'ÃÂ£Ã‘â€¡ÃÂ°Ã‘ÂÃ‘â€šÃÂ½ÃÂ¸ÃÂº', zh: 'Ã¦Ë†ÂÃ¥â€˜Ëœ', ar: 'Ã˜Â¹Ã˜Â¶Ã™Ë†', ja: 'Ã£Æ’Â¡Ã£Æ’Â³Ã£Æ’ÂÃ£Æ’Â¼' })}
              </p>
              {data.user?.isAdmin && (
                <div className="mt-2 inline-block bg-blue-900/50 border border-blue-500/30 rounded px-3 py-1">
                  <span className="text-slate-400 text-xs mr-2">{t({ en: 'LEAGUE CODE', it: 'CODICE LEGA', fr: 'CODE LIGUE', de: 'LIGA-CODE', es: 'CÃƒâ€œDIGO LIGA', ru: 'ÃÅ¡ÃÅ¾Ãâ€ Ãâ€ºÃËœÃâ€œÃËœ', zh: 'Ã¨Ââ€Ã§â€ºÅ¸Ã¤Â»Â£Ã§ Â', ar: 'Ã˜Â±Ã™â€¦Ã˜Â² Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã™Å ', ja: 'Ã£Æ’ÂªÃ£Æ’Â¼Ã£â€šÂ°Ã£â€šÂ³Ã£Æ’Â¼Ã£Æ’â€°' })}:</span>
                  <span className="font-mono font-bold text-blue-300">{data.user.leagueCode}</span>
                </div>
              )}
            </header>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h2 className="text-lg font-semibold text-blue-400 mb-2">{t({ en: 'Selected Race', it: 'Gara Selezionata', fr: 'Course sÃƒÂ©lectionnÃƒÂ©e', de: 'AusgewÃƒÂ¤hltes Rennen', es: 'Carrera seleccionada', ru: 'Ãâ€™Ã‘â€¹ÃÂ±Ã‘â‚¬ÃÂ°ÃÂ½ÃÂ½ÃÂ°Ã‘Â ÃÂ³ÃÂ¾ÃÂ½ÃÂºÃÂ°', zh: 'Ã¥Â·Â²Ã©â‚¬â€°Ã¨Âµâ€ºÃ¤Âºâ€¹', ar: 'Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¨Ã˜Â§Ã™â€š Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã˜Â¯Ã˜Â¯', ja: 'Ã©ÂÂ¸Ã¦Å Å¾Ã£Ââ€¢Ã£â€šÅ’Ã£ÂÅ¸Ã£Æ’Â¬Ã£Æ’Â¼Ã£â€šÂ¹' })}</h2>
              <div className="text-3xl font-bold text-white">{currentRace.name}</div>
              <div className="text-slate-400 mt-1">{currentRace.date}</div>
              {lockState.status !== 'unconfigured' && (
                <div className="mt-3 bg-slate-900/50 p-2 rounded text-center border border-slate-600">
                  <span className="text-xs text-slate-400 uppercase mr-2">{t({ en: 'Lineup Locks In', it: 'Chiude tra', fr: 'Verrouillage dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Ãâ€”ÃÂ°ÃÂºÃ‘â‚¬Ã‘â€¹Ã‘â€šÃÂ¸ÃÂµ Ã‘â€¡ÃÂµÃ‘â‚¬ÃÂµÃÂ·', zh: 'Ã©ËœÂµÃ¥Â®Â¹Ã©â€ÂÃ¥Â®Å¡Ã¤ÂºÅ½', ar: 'Ã™Å Ã˜ÂºÃ™â€žÃ™â€š Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â´Ã™Æ’Ã™Å Ã™â€ž Ã™ÂÃ™Å ', ja: 'Ã£Æ’Â©Ã£â€šÂ¤Ã£Æ’Â³Ã£Æ’Å Ã£Æ’Æ’Ã£Æ’â€”Ã¥â€ºÂºÃ¥Â®Å¡Ã£ÂÂ¾Ã£ÂÂ§' })}</span>
                  <span className={`font-mono font-bold ${lockState.status === 'locked' ? 'text-red-400' : 'text-green-400'}`}>
                    {lockState.status === 'locked' ? 'LOCKED' : formatCountdown(lockState.msToLock || 0)}
                  </span>
                </div>
              )}
            </div>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h2 className="text-lg font-semibold text-green-400 mb-2">{t({ en: 'Team Status', it: 'Stato Team', fr: 'Statut ÃƒÂ©quipe', de: 'Teamstatus', es: 'Estado Equipo', ru: 'ÃÂ¡Ã‘â€šÃÂ°Ã‘â€šÃ‘Æ’Ã‘Â ÃÂºÃÂ¾ÃÂ¼ÃÂ°ÃÂ½ÃÂ´Ã‘â€¹', zh: 'Ã¨Â½Â¦Ã©ËœÅ¸Ã§Å Â¶Ã¦â‚¬Â', ar: 'Ã˜Â­Ã˜Â§Ã™â€žÃ˜Â© Ã˜Â§Ã™â€žÃ™ÂÃ˜Â±Ã™Å Ã™â€š', ja: 'Ã£Æ’ÂÃ£Æ’Â¼Ã£Æ’ Ã§Å Â¶Ã¦Â³Â' })}</h2>
              <div className="flex justify-between items-center mb-2">
                <span className="text-slate-300">{t({ en: 'Budget', it: 'Budget', fr: 'Budget', de: 'Budget', es: 'Presupuesto', ru: 'Ãâ€˜Ã‘Å½ÃÂ´ÃÂ¶ÃÂµÃ‘â€š', zh: 'Ã©Â¢â€žÃ§Â®â€”', ar: 'Ã˜Â§Ã™â€žÃ™â€¦Ã™Å Ã˜Â²Ã˜Â§Ã™â€ Ã™Å Ã˜Â©', ja: 'Ã¤ÂºË†Ã§Â®â€”' })}</span>
                <span className="font-mono text-white text-lg">${data.team.budget.toFixed(1)}M</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-300">{t({ en: 'Drivers Signed', it: 'Piloti', fr: 'Pilotes', de: 'Fahrer', es: 'Pilotos', ru: 'ÃÅ¸ÃÂ¸ÃÂ»ÃÂ¾Ã‘â€šÃ‘â€¹', zh: 'Ã¨Â½Â¦Ã¦â€°â€¹', ar: 'Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â§Ã˜Â¦Ã™â€šÃ™Å Ã™â€ ', ja: 'Ã¥Â¥â€˜Ã§Â´â€žÃ£Æ’â€°Ã£Æ’Â©Ã£â€šÂ¤Ã£Æ’ÂÃ£Æ’Â¼' })}</span>
                <span className="font-mono text-white text-lg">{data.team.driverIds.length}/5</span>
              </div>
            </div>
          </div>
        );

      case Tab.TEAM:
        return (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-white mb-4">{t({ en: 'My Team', it: 'Il Mio Team', fr: 'Mon Ãƒâ€°quipe', de: 'Mein Team', es: 'Mi Equipo', ru: 'ÃÅ“ÃÂ¾Ã‘Â ÃÅ¡ÃÂ¾ÃÂ¼ÃÂ°ÃÂ½ÃÂ´ÃÂ°', zh: 'Ã¦Ë†â€˜Ã§Å¡â€žÃ¨Â½Â¦Ã©ËœÅ¸', ar: 'Ã™ÂÃ˜Â±Ã™Å Ã™â€šÃ™Å ', ja: 'Ã£Æ’Å¾Ã£â€šÂ¤Ã£Æ’ÂÃ£Æ’Â¼Ã£Æ’ ' })}</h1>
            <div className="p-4 bg-slate-800 rounded-lg text-center border border-slate-700">
              <p className="text-slate-400 mb-2">{t({ en: 'Team Name', it: 'Nome Team', fr: "Nom de l'ÃƒÂ©quipe", de: 'Teamname', es: 'Nombre del Equipo', ru: 'ÃÂÃÂ°ÃÂ·ÃÂ²ÃÂ°ÃÂ½ÃÂ¸ÃÂµ ÃÂºÃÂ¾ÃÂ¼ÃÂ°ÃÂ½ÃÂ´Ã‘â€¹', zh: 'Ã¨Â½Â¦Ã©ËœÅ¸Ã¥ÂÂÃ§Â§Â°', ar: 'Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ™ÂÃ˜Â±Ã™Å Ã™â€š', ja: 'Ã£Æ’ÂÃ£Æ’Â¼Ã£Æ’ Ã¥ÂÂ' })}</p>
              <h2 className="text-xl font-bold text-white">{data.team.name}</h2>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-200">{t({ en: 'Roster', it: 'Rosa', fr: 'Effectif', de: 'Kader', es: 'Plantilla', ru: 'ÃÂ¡ÃÂ¾Ã‘ÂÃ‘â€šÃÂ°ÃÂ²', zh: 'Ã©ËœÂµÃ¥Â®Â¹', ar: 'Ã˜Â§Ã™â€žÃ™â€šÃ˜Â§Ã˜Â¦Ã™â€¦Ã˜Â©', ja: 'Ã£Æ’Â­Ã£Æ’Â¼Ã£â€šÂ¹Ã£â€šÂ¿Ã£Æ’Â¼' })}</h3>
              {data.team.driverIds.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg text-center text-slate-500">
                  {t({ en: 'No drivers selected yet. Go to Market.', it: 'Nessun pilota selezionato. Vai al Mercato.', fr: 'Aucun pilote sÃƒÂ©lectionnÃƒÂ©. Allez au MarchÃƒÂ©.', de: 'Noch keine Fahrer ausgewÃƒÂ¤hlt. Zum Markt gehen.', es: 'Sin pilotos seleccionados. Ir al Mercado.', ru: 'ÃÅ¸ÃÂ¸ÃÂ»ÃÂ¾Ã‘â€šÃ‘â€¹ ÃÂ½ÃÂµ ÃÂ²Ã‘â€¹ÃÂ±Ã‘â‚¬ÃÂ°ÃÂ½Ã‘â€¹. ÃÅ¸ÃÂµÃ‘â‚¬ÃÂµÃÂ¹ÃÂ´ÃÂ¸Ã‘â€šÃÂµ ÃÂ½ÃÂ° Ã‘â‚¬Ã‘â€¹ÃÂ½ÃÂ¾ÃÂº.', zh: 'Ã¥Â°Å¡Ã¦Å“ÂªÃ©â‚¬â€°Ã¦â€¹Â©Ã¨Â½Â¦Ã¦â€°â€¹Ã£â‚¬â€šÃ¥â€°ÂÃ¥Â¾â‚¬Ã¥Â¸â€šÃ¥Å“ÂºÃ£â‚¬â€š', ar: 'Ã™â€žÃ™â€¦ Ã™Å Ã˜ÂªÃ™â€¦ Ã˜Â§Ã˜Â®Ã˜ÂªÃ™Å Ã˜Â§Ã˜Â± Ã˜Â³Ã˜Â§Ã˜Â¦Ã™â€šÃ™Å Ã™â€  Ã˜Â¨Ã˜Â¹Ã˜Â¯. Ã˜Â§Ã˜Â°Ã™â€¡Ã˜Â¨ Ã˜Â¥Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â³Ã™Ë†Ã™â€š.', ja: 'Ã£Æ’â€°Ã£Æ’Â©Ã£â€šÂ¤Ã£Æ’ÂÃ£Æ’Â¼Ã¦Å“ÂªÃ©ÂÂ¸Ã¦Å Å¾Ã£â‚¬â€šÃ£Æ’Å¾Ã£Æ’Â¼Ã£â€šÂ±Ã£Æ’Æ’Ã£Æ’Ë†Ã£ÂÂ¸Ã£â‚¬â€š' })}
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
                <div className="text-yellow-400 font-bold">{t({ en: 'Config Missing', it: 'Config Mancante', fr: 'Config manquante', de: 'Konfig fehlt', es: 'Falta config', ru: 'ÃÂÃÂµÃ‘â€š ÃÂºÃÂ¾ÃÂ½Ã‘â€žÃÂ¸ÃÂ³ÃÂ°', zh: 'Ã§Â¼ÂºÃ¥Â°â€˜Ã©â€¦ÂÃ§Â½Â®', ar: 'Ã˜Â§Ã™â€žÃ˜ÂªÃ™Æ’Ã™Ë†Ã™Å Ã™â€  Ã™â€¦Ã™ÂÃ™â€šÃ™Ë†Ã˜Â¯', ja: 'Ã¨Â¨Â­Ã¥Â®Å¡Ã¤Â¸ÂÃ¨Â¶Â³' })}</div>
                <div className="text-xs text-yellow-200">{t({ en: 'Admin: Set UTC times.', it: 'Admin: Imposta orari UTC.', fr: 'Admin: DÃƒÂ©finir heures UTC.', de: 'Admin: UTC-Zeiten setzen.', es: 'Admin: Fijar horas UTC.', ru: 'ÃÂÃÂ´ÃÂ¼ÃÂ¸ÃÂ½: ÃÂ£Ã‘ÂÃ‘â€š. UTC.', zh: 'Ã§Â®Â¡Ã§Ââ€ Ã¥â€˜ËœÃ¯Â¼Å¡Ã¨Â®Â¾Ã§Â½Â®UTCÃ¦â€”Â¶Ã©â€”Â´Ã£â‚¬â€š', ar: 'Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜Â¤Ã™Ë†Ã™â€ž: Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã˜ÂªÃ™Ë†Ã™â€šÃ™Å Ã˜Âª UTC.', ja: 'Ã§Â®Â¡Ã§Ââ€ Ã¨â‚¬â€¦: UTCÃ¨Â¨Â­Ã¥Â®Å¡' })}</div>
              </div>
            )}
            {lockState.status === 'open' && (
              <div className="bg-green-900/50 border border-green-600 p-3 rounded text-center">
                <div className="text-green-400 font-bold">{t({ en: 'Lineup Open', it: 'Formazione Aperta', fr: 'Alignement ouvert', de: 'Lineup offen', es: 'AlineaciÃƒÂ³n abierta', ru: 'ÃÂ¡ÃÂ¾Ã‘ÂÃ‘â€šÃÂ°ÃÂ² ÃÂ¾Ã‘â€šÃÂºÃ‘â‚¬Ã‘â€¹Ã‘â€š', zh: 'Ã©ËœÂµÃ¥Â®Â¹Ã¥Â¼â‚¬Ã¦â€Â¾', ar: 'Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â´Ã™Æ’Ã™Å Ã™â€ž Ã™â€¦Ã™ÂÃ˜ÂªÃ™Ë†Ã˜Â­', ja: 'Ã£Æ’Â©Ã£â€šÂ¤Ã£Æ’Â³Ã£Æ’Å Ã£Æ’Æ’Ã£Æ’â€”Ã¥Â¤â€°Ã¦â€ºÂ´Ã¥ÂÂ¯' })}</div>
                {lockState.msToLock !== null && (
                  <div className="text-xs text-green-200">{t({ en: 'Locks in', it: 'Chiude tra', fr: 'Verrouille dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Ãâ€”ÃÂ°ÃÂºÃ‘â‚¬Ã‘â€¹Ã‘â€šÃÂ¸ÃÂµ Ã‘â€¡ÃÂµÃ‘â‚¬ÃÂµÃÂ·', zh: 'Ã©â€ÂÃ¥Â®Å¡Ã¤ÂºÅ½', ar: 'Ã™Å Ã˜ÂºÃ™â€žÃ™â€š Ã™ÂÃ™Å ', ja: 'Ã¥â€ºÂºÃ¥Â®Å¡Ã£ÂÂ¾Ã£ÂÂ§' })} {formatCountdown(lockState.msToLock)}</div>
                )}
                <div className="mt-2 text-[10px] font-mono text-green-200 opacity-80 border-t border-green-700/50 pt-1">
                  <div>Session UTC: {lockState.targetSessionUtc || 'N/A'}</div>
                  <div>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</div>
                </div>
              </div>
            )}
            {lockState.status === 'closing_soon' && (
              <div className="bg-orange-900/50 border border-orange-600 p-3 rounded text-center animate-pulse">
                <div className="text-orange-400 font-bold">{t({ en: 'Closing Soon', it: 'Chiude Presto', fr: 'Fermeture bientÃƒÂ´t', de: 'SchlieÃƒÅ¸t bald', es: 'Cierra pronto', ru: 'ÃÂ¡ÃÂºÃÂ¾Ã‘â‚¬ÃÂ¾ ÃÂ·ÃÂ°ÃÂºÃ‘â‚¬Ã‘â€¹Ã‘â€šÃÂ¸ÃÂµ', zh: 'Ã¥ÂÂ³Ã¥Â°â€ Ã¥â€¦Â³Ã©â€”Â­', ar: 'Ã™Å Ã˜ÂºÃ™â€žÃ™â€š Ã™â€šÃ˜Â±Ã™Å Ã˜Â¨Ã˜Â§', ja: 'Ã£ÂÂ¾Ã£â€šâ€šÃ£ÂÂªÃ£ÂÂÃ§Âµâ€šÃ¤Âºâ€ ' })}</div>
                {lockState.msToLock !== null && (
                  <div className="text-xs text-orange-200">{t({ en: 'Locks in', it: 'Chiude tra', fr: 'Verrouille dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Ãâ€”ÃÂ°ÃÂºÃ‘â‚¬Ã‘â€¹Ã‘â€šÃÂ¸ÃÂµ Ã‘â€¡ÃÂµÃ‘â‚¬ÃÂµÃÂ·', zh: 'Ã©â€ÂÃ¥Â®Å¡Ã¤ÂºÅ½', ar: 'Ã™Å Ã˜ÂºÃ™â€žÃ™â€š Ã™ÂÃ™Å ', ja: 'Ã¥â€ºÂºÃ¥Â®Å¡Ã£ÂÂ¾Ã£ÂÂ§' })} {formatCountdown(lockState.msToLock)}</div>
                )}
                <div className="mt-2 text-[10px] font-mono text-orange-200 opacity-80 border-t border-orange-700/50 pt-1">
                  <div>Session UTC: {lockState.targetSessionUtc || 'N/A'}</div>
                  <div>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</div>
                </div>
              </div>
            )}
            {lockState.status === 'locked' && (
              <div className="bg-red-900/50 border border-red-600 p-3 rounded text-center">
                <div className="text-red-400 font-bold">{t({ en: 'Lineup locked.', it: 'Formazione bloccata.', fr: 'Alignement verrouillÃƒÂ©.', de: 'Lineup gesperrt.', es: 'AlineaciÃƒÂ³n bloqueada.', ru: 'ÃÂ¡ÃÂ¾Ã‘ÂÃ‘â€šÃÂ°ÃÂ² ÃÂ·ÃÂ°ÃÂ±ÃÂ»ÃÂ¾ÃÂºÃÂ¸Ã‘â‚¬ÃÂ¾ÃÂ²ÃÂ°ÃÂ½.', zh: 'Ã©ËœÂµÃ¥Â®Â¹Ã¥Â·Â²Ã©â€ÂÃ¥Â®Å¡Ã£â‚¬â€š', ar: 'Ã˜ÂªÃ™â€¦ Ã™â€šÃ™ÂÃ™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â´Ã™Æ’Ã™Å Ã™â€ž.', ja: 'Ã£Æ’Â©Ã£â€šÂ¤Ã£Æ’Â³Ã£Æ’Å Ã£Æ’Æ’Ã£Æ’â€”Ã¥â€ºÂºÃ¥Â®Å¡Ã¦Â¸Ë†Ã£ÂÂ¿Ã£â‚¬â€š' })}</div>
                <div className="text-xs text-red-200">
                  {currentRace.isSprint
                    ? t({ en: 'Sprint Qualifying is about to start.', it: 'La Sprint Shootout sta per iniziare.', fr: 'Qualification Sprint commence.', de: 'Sprint-Quali beginnt.', es: 'Sprint Quali va a comenzar.', ru: 'ÃÂ¡ÃÂ¿Ã‘â‚¬ÃÂ¸ÃÂ½Ã‘â€š-ÃÂºÃÂ²ÃÂ°ÃÂ»ÃÂ¸Ã‘â€žÃÂ¸ÃÂºÃÂ°Ã‘â€ ÃÂ¸Ã‘Â ÃÂ½ÃÂ°Ã‘â€¡ÃÂ¸ÃÂ½ÃÂ°ÃÂµÃ‘â€šÃ‘ÂÃ‘Â.', zh: 'Ã¥â€ Â²Ã¥Ë†ÂºÃ¦Å½â€™Ã¤Â½ÂÃ¥ÂÂ³Ã¥Â°â€ Ã¥Â¼â‚¬Ã¥Â§â€¹Ã£â‚¬â€š', ar: 'Ã˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â±Ã˜Â¹Ã˜Â© Ã˜Â³Ã˜ÂªÃ˜Â¨Ã˜Â¯Ã˜Â£ Ã™â€šÃ˜Â±Ã™Å Ã˜Â¨Ã˜Â§.', ja: 'Ã£â€šÂ¹Ã£Æ’â€”Ã£Æ’ÂªÃ£Æ’Â³Ã£Æ’Ë†Ã¤ÂºË†Ã©ÂÂ¸Ã©â€“â€¹Ã¥Â§â€¹Ã£â‚¬â€š' })
                    : t({ en: 'Qualifying is about to start.', it: 'Le qualifiche stanno per iniziare.', fr: 'Les qualifications vont commencer.', de: 'Qualifying beginnt bald.', es: 'La clasificaciÃƒÂ³n estÃƒÂ¡ por comenzar.', ru: 'ÃÅ¡ÃÂ²ÃÂ°ÃÂ»ÃÂ¸Ã‘â€žÃÂ¸ÃÂºÃÂ°Ã‘â€ ÃÂ¸Ã‘Â ÃÂ½ÃÂ°Ã‘â€¡ÃÂ¸ÃÂ½ÃÂ°ÃÂµÃ‘â€šÃ‘ÂÃ‘Â.', zh: 'Ã¦Å½â€™Ã¤Â½ÂÃ¨Âµâ€ºÃ¥ÂÂ³Ã¥Â°â€ Ã¥Â¼â‚¬Ã¥Â§â€¹Ã£â‚¬â€š', ar: 'Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â§Ã˜Âª Ã˜Â³Ã˜ÂªÃ˜Â¨Ã˜Â¯Ã˜Â£ Ã™â€šÃ˜Â±Ã™Å Ã˜Â¨Ã˜Â§.', ja: 'Ã¤ÂºË†Ã©ÂÂ¸Ã£ÂÅ’Ã¥Â§â€¹Ã£ÂÂ¾Ã£â€šÅ Ã£ÂÂ¾Ã£Ââ„¢Ã£â‚¬â€š' })}
                </div>
                <div className="mt-2 text-[10px] font-mono text-red-200 opacity-80 border-t border-red-700/50 pt-1">
                  <div>{t({ en: 'Lock only affects Captain/Reserve selection.', it: 'Il blocco riguarda solo Capitano/Riserva.' })}</div>
                  <div className="text-yellow-200 mt-1">{t({ en: 'Market is still OPEN.', it: 'Il Mercato ÃƒÂ¨ ancora APERTO.' })}</div>
                </div>
              </div>
            )}

            <h1 className="text-2xl font-bold text-white">{t({ en: 'Race Lineup', it: 'Formazione Gara', fr: 'Alignement course', de: 'Renn-Lineup', es: 'AlineaciÃƒÂ³n Carrera', ru: 'ÃÂ¡ÃÂ¾Ã‘ÂÃ‘â€šÃÂ°ÃÂ² ÃÂ½ÃÂ° ÃÂ³ÃÂ¾ÃÂ½ÃÂºÃ‘Æ’', zh: 'Ã¦Â­Â£Ã¨Âµâ€ºÃ©ËœÂµÃ¥Â®Â¹', ar: 'Ã˜ÂªÃ˜Â´Ã™Æ’Ã™Å Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¨Ã˜Â§Ã™â€š', ja: 'Ã£Æ’Â¬Ã£Æ’Â¼Ã£â€šÂ¹Ã£Æ’Â©Ã£â€šÂ¤Ã£Æ’Â³Ã£Æ’Å Ã£Æ’Æ’Ã£Æ’â€”' })}</h1>

            {data.team.driverIds.length < 5 ? (
              <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg text-center text-slate-500">
                {t({ en: 'Pick 5 drivers in Market to unlock Lineup.', it: 'Scegli 5 piloti nel Mercato per sbloccare la formazione.', fr: 'Choisissez 5 pilotes pour dÃƒÂ©bloquer.', de: 'WÃƒÂ¤hle 5 Fahrer im Markt.', es: 'Elige 5 pilotos para desbloquear.', ru: 'Ãâ€™Ã‘â€¹ÃÂ±ÃÂµÃ‘â‚¬ÃÂ¸Ã‘â€šÃÂµ 5 ÃÂ¿ÃÂ¸ÃÂ»ÃÂ¾Ã‘â€šÃÂ¾ÃÂ².', zh: 'Ã¥Å“Â¨Ã¥Â¸â€šÃ¥Å“ÂºÃ©â‚¬â€°Ã¦â€¹Â©5Ã¥ÂÂÃ¨Â½Â¦Ã¦â€°â€¹Ã¨Â§Â£Ã©â€ÂÃ£â‚¬â€š', ar: 'Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â± 5 Ã˜Â³Ã˜Â§Ã˜Â¦Ã™â€šÃ™Å Ã™â€  Ã™â€žÃ™ÂÃ˜ÂªÃ˜Â­ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â´Ã™Æ’Ã™Å Ã™â€ž.', ja: 'Ã£Æ’Å¾Ã£Æ’Â¼Ã£â€šÂ±Ã£Æ’Æ’Ã£Æ’Ë†Ã£ÂÂ§5Ã¤ÂºÂºÃ©ÂÂ¸Ã£â€šâ€œÃ£ÂÂ§Ã£ÂÂÃ£Â Ã£Ââ€¢Ã£Ââ€žÃ£â‚¬â€š' })}
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
                            {isCaptain && <span className="text-[10px] bg-yellow-500 text-black font-bold px-1 rounded">CPT</span>}
                            {isReserve && <span className="text-[10px] bg-green-500 text-black font-bold px-1 rounded">RES</span>}
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
              <h2 className="text-xl font-bold text-white">{t({ en: 'Swap Driver', it: 'Scambia Pilota', fr: 'Ãƒâ€°changer Pilote', de: 'Fahrer tauschen', es: 'Cambiar Piloto', ru: 'Ãâ€”ÃÂ°ÃÂ¼ÃÂµÃÂ½ÃÂ¸Ã‘â€šÃ‘Å’ ÃÂ¿ÃÂ¸ÃÂ»ÃÂ¾Ã‘â€šÃÂ°', zh: 'Ã¤ÂºÂ¤Ã¦ÂÂ¢Ã¨Â½Â¦Ã¦â€°â€¹', ar: 'Ã˜ÂªÃ˜Â¨Ã˜Â¯Ã™Å Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â§Ã˜Â¦Ã™â€š', ja: 'Ã£Æ’â€°Ã£Æ’Â©Ã£â€šÂ¤Ã£Æ’ÂÃ£Æ’Â¼Ã¤ÂºÂ¤Ã¦Ââ€º' })}</h2>
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 mb-4">
                <p className="text-slate-400 text-sm">{t({ en: 'Target', it: 'Obiettivo', fr: 'Cible', de: 'Ziel', es: 'Objetivo', ru: 'ÃÂ¦ÃÂµÃÂ»Ã‘Å’', zh: 'Ã§â€ºÂ®Ã¦ â€¡', ar: 'Ã˜Â§Ã™â€žÃ™â€¡Ã˜Â¯Ã™Â', ja: 'Ã£â€šÂ¿Ã£Æ’Â¼Ã£â€šÂ²Ã£Æ’Æ’Ã£Æ’Ë†' })}</p>
                <div className="text-xl font-bold text-white">{swapCandidate.name}</div>
                <div className="text-blue-400 font-mono">${swapCandidate.price}M</div>
              </div>

              <h3 className="text-lg text-slate-300">{t({ en: 'Select a driver to release:', it: 'Seleziona un pilota da rilasciare:', fr: 'SÃƒÂ©lectionnez un pilote ÃƒÂ  libÃƒÂ©rer :', de: 'WÃƒÂ¤hle einen Fahrer zum Freigeben:', es: 'Selecciona un piloto para liberar:', ru: 'Ãâ€™ÃÂ²ÃÂµÃÂ´ÃÂ¸Ã‘â€šÃÂµ ÃÂ¿ÃÂ¸ÃÂ»ÃÂ¾Ã‘â€šÃÂ° ÃÂ´ÃÂ»Ã‘Â ÃÂ·ÃÂ°ÃÂ¼ÃÂµÃÂ½Ã‘â€¹:', zh: 'Ã©â‚¬â€°Ã¦â€¹Â©Ã¨Â¦ÂÃ©â€¡Å Ã¦â€Â¾Ã§Å¡â€žÃ¨Â½Â¦Ã¦â€°â€¹Ã¯Â¼Å¡', ar: 'Ã˜Â§Ã˜Â®Ã˜ÂªÃ˜Â± Ã˜Â³Ã˜Â§Ã˜Â¦Ã™â€šÃ˜Â§Ã™â€¹ Ã™â€žÃ™â€žÃ˜Â§Ã˜Â³Ã˜ÂªÃ˜Â¨Ã˜Â¯Ã˜Â§Ã™â€ž:', ja: 'Ã¦â€Â¾Ã¥â€¡ÂºÃ£Ââ„¢Ã£â€šâ€¹Ã£Æ’â€°Ã£Æ’Â©Ã£â€šÂ¤Ã£Æ’ÂÃ£Æ’Â¼Ã£â€šâ€™Ã©ÂÂ¸Ã¦Å Å¾:' })}</h3>
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
                        <div className="text-xs text-slate-400">{t({ en: 'Sell for', it: 'Vendi per', fr: 'Vendre pour', de: 'Verkaufen fÃƒÂ¼r', es: 'Vender por', ru: 'ÃÅ¸Ã‘â‚¬ÃÂ¾ÃÂ´ÃÂ°Ã‘â€šÃ‘Å’ ÃÂ·ÃÂ°', zh: 'Ã¥â€¡ÂºÃ¥â€Â®Ã¤Â»Â·Ã¦ Â¼', ar: 'Ã˜Â¨Ã™Å Ã˜Â¹ Ã˜Â¨Ã™â‚¬', ja: 'Ã¥Â£Â²Ã¥ÂÂ´Ã©Â¡Â' })} ${d.price}M</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono ${canAfford ? 'text-green-400' : 'text-red-400'}`}>
                          {t({ en: 'New Budget', it: 'Nuovo Budget', fr: 'Nouveau Budget', de: 'Neues Budget', es: 'Nuevo Presupuesto', ru: 'ÃÂÃÂ¾ÃÂ²Ã‘â€¹ÃÂ¹ ÃÂ±Ã‘Å½ÃÂ´ÃÂ¶ÃÂµÃ‘â€š', zh: 'Ã¦â€“Â°Ã©Â¢â€žÃ§Â®â€”', ar: 'Ã˜Â§Ã™â€žÃ™â€¦Ã™Å Ã˜Â²Ã˜Â§Ã™â€ Ã™Å Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯Ã˜Â©', ja: 'Ã¦â€“Â°Ã¤ÂºË†Ã§Â®â€”' })}: ${diff.toFixed(1)}M
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
                {t({ en: 'Cancel Swap', it: 'Annulla Scambio', fr: "Annuler l'ÃƒÂ©change", de: 'Tausch abbrechen', es: 'Cancelar Cambio', ru: 'ÃÅ¾Ã‘â€šÃÂ¼ÃÂµÃÂ½ÃÂ¸Ã‘â€šÃ‘Å’ ÃÂ¾ÃÂ±ÃÂ¼ÃÂµÃÂ½', zh: 'Ã¥Ââ€“Ã¦Â¶Ë†Ã¤ÂºÂ¤Ã¦ÂÂ¢', ar: 'Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¨Ã˜Â¯Ã™Å Ã™â€ž', ja: 'Ã¤ÂºÂ¤Ã¦Ââ€ºÃ£â€šÂ­Ã£Æ’Â£Ã£Æ’Â³Ã£â€šÂ»Ã£Æ’Â«' })}
              </button>
            </div>
          );
        }

        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-slate-800 p-3 rounded-lg sticky top-0 z-10 shadow-lg border-b border-slate-700">
              <div>
                <div className="text-xs text-slate-400 uppercase">{t({ en: 'Budget', it: 'Budget', fr: 'Budget', de: 'Budget', es: 'Presupuesto', ru: 'Ãâ€˜Ã‘Å½ÃÂ´ÃÂ¶ÃÂµÃ‘â€š', zh: 'Ã©Â¢â€žÃ§Â®â€”', ar: 'Ã˜Â§Ã™â€žÃ™â€¦Ã™Å Ã˜Â²Ã˜Â§Ã™â€ Ã™Å Ã˜Â©', ja: 'Ã¤ÂºË†Ã§Â®â€”' })}</div>
                <div className="text-xl font-mono text-white">${data.team.budget.toFixed(1)}M</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase text-right">{t({ en: 'Team', it: 'Team', fr: 'Ãƒâ€°quipe', de: 'Team', es: 'Equipo', ru: 'ÃÅ¡ÃÂ¾ÃÂ¼ÃÂ°ÃÂ½ÃÂ´ÃÂ°', zh: 'Ã¨Â½Â¦Ã©ËœÅ¸', ar: 'Ã˜Â§Ã™â€žÃ™ÂÃ˜Â±Ã™Å Ã™â€š', ja: 'Ã£Æ’ÂÃ£Æ’Â¼Ã£Æ’ ' })}</div>
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
                        <button disabled className="px-3 py-1 bg-slate-700 text-slate-400 text-xs rounded font-bold uppercase tracking-wider cursor-default">
                          {t({ en: 'Owned', it: 'Posseduto', fr: 'PossÃƒÂ©dÃƒÂ©', de: 'Im Besitz', es: 'En propiedad', ru: 'ÃÅ¡Ã‘Æ’ÃÂ¿ÃÂ»ÃÂµÃÂ½', zh: 'Ã¥Â·Â²Ã¦â€¹Â¥Ã¦Å“â€°', ar: 'Ã™â€¦Ã™â€¦Ã™â€žÃ™Ë†Ã™Æ’', ja: 'Ã¦â€°â‚¬Ã¦Å“â€°Ã¤Â¸Â­' })}
                        </button>
                      ) : isTeamFull ? (
                        <button
                          onClick={() => setSwapCandidate(driver)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-bold uppercase tracking-wider transition-colors"
                        >
                          {t({ en: 'Swap', it: 'Scambia', fr: 'Ãƒâ€°changer', de: 'Tauschen', es: 'Cambiar', ru: 'ÃÅ¾ÃÂ±ÃÂ¼ÃÂµÃÂ½', zh: 'Ã¤ÂºÂ¤Ã¦ÂÂ¢', ar: 'Ã˜ÂªÃ˜Â¨Ã˜Â¯Ã™Å Ã™â€ž', ja: 'Ã¤ÂºÂ¤Ã¦Ââ€º' })}
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
                          {t({ en: 'Add', it: 'Aggiungi', fr: 'Ajouter', de: 'HinzufÃƒÂ¼gen', es: 'AÃƒÂ±adir', ru: 'Ãâ€ÃÂ¾ÃÂ±ÃÂ°ÃÂ²ÃÂ¸Ã‘â€šÃ‘Å’', zh: 'Ã¦Â·Â»Ã¥Å  ', ar: 'Ã˜Â¥Ã˜Â¶Ã˜Â§Ã™ÂÃ˜Â©', ja: 'Ã¨Â¿Â½Ã¥Å  ' })}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case Tab.ADMIN:
        return (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-white">{t({ en: 'Admin Controls', it: 'Controlli Admin', fr: 'ContrÃƒÂ´les Admin', de: 'Admin-Steuerung', es: 'Controles Admin', ru: 'ÃÂ£ÃÂ¿Ã‘â‚¬ÃÂ°ÃÂ²ÃÂ»ÃÂµÃÂ½ÃÂ¸ÃÂµ', zh: 'Ã§Â®Â¡Ã§Ââ€ Ã¥â€˜ËœÃ¦Å½Â§Ã¥Ë†Â¶', ar: 'Ã˜ÂªÃ˜Â­Ã™Æ’Ã™â€¦ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜Â¤Ã™Ë†Ã™â€ž', ja: 'Ã§Â®Â¡Ã§Ââ€ Ã¨Â¨Â­Ã¥Â®Å¡' })}</h1>

            {/* Race Config Card */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-2">{t({ en: 'Race Time Config', it: 'Config Orari Gara', fr: 'Config heures course', de: 'Rennzeit-Konfig', es: 'Config Horas Carrera', ru: 'ÃÅ¡ÃÂ¾ÃÂ½Ã‘â€žÃÂ¸ÃÂ³ ÃÂ²Ã‘â‚¬ÃÂµÃÂ¼ÃÂµÃÂ½ÃÂ¸ ÃÂ³ÃÂ¾ÃÂ½ÃÂºÃÂ¸', zh: 'Ã¨Âµâ€ºÃ¦â€”Â¶Ã©â€¦ÂÃ§Â½Â®', ar: 'Ã˜ÂªÃ™Æ’Ã™Ë†Ã™Å Ã™â€  Ã™Ë†Ã™â€šÃ˜Âª Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¨Ã˜Â§Ã™â€š', ja: 'Ã£Æ’Â¬Ã£Æ’Â¼Ã£â€šÂ¹Ã¦â„¢â€šÃ©â€“â€œÃ¨Â¨Â­Ã¥Â®Å¡' })}</h3>
              {/* Navigation */}
              <div className="flex justify-between items-center mb-4">
                <button
                  onClick={() => setData({ ...data, currentRaceIndex: Math.max(0, data.currentRaceIndex - 1) })}
                  disabled={data.currentRaceIndex === 0}
                  className="p-2 bg-slate-700 rounded disabled:opacity-50 text-slate-200"
                >{t({ en: 'Prev', it: 'Prec', fr: 'PrÃƒÂ©c', de: 'ZurÃƒÂ¼ck', es: 'Ant', ru: 'ÃÅ¸Ã‘â‚¬ÃÂµÃÂ´', zh: 'Ã¤Â¸Å Ã¤Â¸â‚¬Ã¤Â¸Âª', ar: 'Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â§Ã˜Â¨Ã™â€š', ja: 'Ã¥â€°ÂÃ£ÂÂ¸' })}</button>
                <div className="text-center">
                  <div className="text-xs text-slate-400">{t({ en: 'Index', it: 'Indice', fr: 'Indice', de: 'Index', es: 'ÃƒÂndice', ru: 'ÃËœÃÂ½ÃÂ´ÃÂµÃÂºÃ‘Â', zh: 'Ã§Â´Â¢Ã¥Â¼â€¢', ar: 'Ã™ÂÃ™â€¡Ã˜Â±Ã˜Â³', ja: 'Ã£â€šÂ¤Ã£Æ’Â³Ã£Æ’â€¡Ã£Æ’Æ’Ã£â€šÂ¯Ã£â€šÂ¹' })} {data.currentRaceIndex}</div>
                  <div className="font-bold text-white text-sm">{currentRace.name}</div>
                </div>
                <button
                  onClick={() => setData({ ...data, currentRaceIndex: Math.min(races.length - 1, data.currentRaceIndex + 1) })}
                  disabled={data.currentRaceIndex === races.length - 1}
                  className="p-2 bg-slate-700 rounded disabled:opacity-50 text-slate-200"
                >{t({ en: 'Next', it: 'Succ', fr: 'Suiv', de: 'Weiter', es: 'Sig', ru: 'ÃÂ¡ÃÂ»ÃÂµÃÂ´', zh: 'Ã¤Â¸â€¹Ã¤Â¸â‚¬Ã¤Â¸Âª', ar: 'Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å ', ja: 'Ã¦Â¬Â¡Ã£ÂÂ¸' })}</button>
              </div>

              {/* Inputs */}
              <div className="space-y-3">
                <div className={`p-2 rounded-lg border ${!currentRace.isSprint ? 'border-yellow-500 bg-yellow-900/20' : 'border-transparent'}`}>
                  <div className="flex justify-between">
                    <label className="block text-xs text-slate-400 mb-1">{t({ en: 'Qualifying UTC (ISO)', it: 'Qualifiche UTC (ISO)', fr: 'Qualif UTC (ISO)', de: 'Quali UTC (ISO)', es: 'Clasif UTC (ISO)', ru: 'ÃÅ¡ÃÂ²ÃÂ°ÃÂ»ÃÂ¸Ã‘â€ž UTC', zh: 'Ã¦Å½â€™Ã¤Â½ÂÃ¨Âµâ€º UTC', ar: 'Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â§Ã˜Âª UTC', ja: 'Ã¤ÂºË†Ã©ÂÂ¸ UTC' })}</label>
                    {!currentRace.isSprint && <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">{t({ en: 'SETS LOCK', it: 'LOCK ATTIVO', fr: 'VERROUILLE', de: 'SETZT LOCK', es: 'FIJA LOCK', ru: 'Ãâ€˜Ãâ€ºÃÅ¾ÃÅ¡ÃËœÃ ÃÂ£Ãâ€¢ÃÂ¢', zh: 'Ã¨Â®Â¾Ã§Â½Â®Ã©â€ÂÃ¥Â®Å¡', ar: 'Ã™â€šÃ™ÂÃ™â€ž Ã™â€ Ã˜Â´Ã˜Â·', ja: 'Ã£Æ’Â­Ã£Æ’Æ’Ã£â€šÂ¯Ã¨Â¨Â­Ã¥Â®Å¡' })}</span>}
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
                      {t({ en: 'SAVE', it: 'SALVA', fr: 'SAUVER', de: 'SPEICHERN', es: 'GUARDAR', ru: 'ÃÂ¡ÃÅ¾ÃÂ¥Ã ', zh: 'Ã¤Â¿ÂÃ¥Â­Ëœ', ar: 'Ã˜Â­Ã™ÂÃ˜Â¸', ja: 'Ã¤Â¿ÂÃ¥Â­Ëœ' })}
                    </button>
                  </div>
                </div>

                {currentRace.isSprint && (
                  <div className={`p-2 rounded-lg border ${currentRace.isSprint ? 'border-yellow-500 bg-yellow-900/20' : 'border-transparent'}`}>
                    <div className="flex justify-between">
                      <label className="block text-xs text-slate-400 mb-1">{t({ en: 'Sprint Quali UTC (ISO)', it: 'Sprint Quali UTC (ISO)', fr: 'Sprint Qualif UTC', de: 'Sprint Quali UTC', es: 'Sprint Clasif UTC', ru: 'ÃÂ¡ÃÂ¿Ã‘â‚¬ÃÂ¸ÃÂ½Ã‘â€š ÃÅ¡ÃÂ²ÃÂ°ÃÂ» UTC', zh: 'Ã¥â€ Â²Ã¥Ë†ÂºÃ¨Âµâ€ºÃ¦Å½â€™Ã¤Â½Â UTC', ar: 'Ã˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â±Ã˜Â¹Ã˜Â© UTC', ja: 'Ã£â€šÂ¹Ã£Æ’â€”Ã£Æ’ÂªÃ£Æ’Â³Ã£Æ’Ë†Ã¤ÂºË†Ã©ÂÂ¸ UTC' })}</label>
                      <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">{t({ en: 'SETS LOCK', it: 'LOCK ATTIVO', fr: 'VERROUILLE', de: 'SETZT LOCK', es: 'FIJA LOCK', ru: 'Ãâ€˜Ãâ€ºÃÅ¾ÃÅ¡ÃËœÃ ÃÂ£Ãâ€¢ÃÂ¢', zh: 'Ã¨Â®Â¾Ã§Â½Â®Ã©â€ÂÃ¥Â®Å¡', ar: 'Ã™â€šÃ™ÂÃ™â€ž Ã™â€ Ã˜Â´Ã˜Â·', ja: 'Ã£Æ’Â­Ã£Æ’Æ’Ã£â€šÂ¯Ã¨Â¨Â­Ã¥Â®Å¡' })}</span>
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
                        {t({ en: 'SAVE', it: 'SALVA', fr: 'SAUVER', de: 'SPEICHERN', es: 'GUARDAR', ru: 'ÃÂ¡ÃÅ¾ÃÂ¥Ã ', zh: 'Ã¤Â¿ÂÃ¥Â­Ëœ', ar: 'Ã˜Â­Ã™ÂÃ˜Â¸', ja: 'Ã¤Â¿ÂÃ¥Â­Ëœ' })}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Debug Time Tooling */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-2">{t({ en: 'Debug Time', it: 'Debug Tempo' })}</h3>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => handleTestTime(120, false)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">Quali +2h</button>
                <button onClick={() => handleTestTime(10, false)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">Quali +10m</button>
                {currentRace.isSprint && (
                  <>
                    <button onClick={() => handleTestTime(120, true)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">Sprint +2h</button>
                    <button onClick={() => handleTestTime(10, true)} className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white">Sprint +10m</button>
                  </>
                )}
              </div>
            </div>

            {/* Scoring Rules Config */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-4 border-b border-slate-700 pb-2">{t({ en: 'Scoring Rules Config', it: 'Config Punteggi', fr: 'Config Points', de: 'Punkte-Konfig', es: 'Config Puntos', ru: 'ÃÂÃÂ°Ã‘ÂÃ‘â€šÃ‘â‚¬ÃÂ¾ÃÂ¹ÃÂºÃÂ° ÃÂ¾Ã‘â€¡ÃÂºÃÂ¾ÃÂ²', zh: 'Ã¨Â®Â¡Ã¥Ë†â€ Ã¨Â§â€žÃ¥Ë†â„¢', ar: 'Ã˜ÂªÃ™Æ’Ã™Ë†Ã™Å Ã™â€  Ã˜Â§Ã™â€žÃ™â€ Ã™â€šÃ˜Â§Ã˜Â·', ja: 'Ã£â€šÂ¹Ã£â€šÂ³Ã£â€šÂ¢Ã¨Â¨Â­Ã¥Â®Å¡' })}</h3>
              <div className="grid grid-cols-2 gap-4">

                {/* Race Points - Grid of 22 */}
                <div className="col-span-2">
                  <label className="text-xs text-slate-400 block mb-2">{t({ en: 'Race Points (1-22)', it: 'Punti Gara (1-22)', fr: 'Points Course (1-22)' })}</label>
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
                <div><label className="text-xs text-slate-400">{t({ en: 'Pole Position', it: 'Pole Position', fr: 'Pole Position', de: 'Pole Position', es: 'Pole Position' })}</label><input type="number" value={data.rules.qualiPole} onChange={(e) => handleRuleChange('qualiPole', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Q3 Reached (1-10)', it: 'Accesso Q3 (1-10)', fr: 'Q3 Atteint (1-10)', de: 'Q3 Erreicht (1.-10.)', es: 'Q3 Alcanzada (1-10)' })}</label><input type="number" value={data.rules.qualiQ3Reached} onChange={(e) => handleRuleChange('qualiQ3Reached', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Q2 Reached (11-16)', it: 'Accesso Q2 (11-16)', fr: 'Q2 Atteint (11-16)', de: 'Q2 Erreicht (11.-16.)', es: 'Q2 Alcanzada (11-16)' })}</label><input type="number" value={data.rules.qualiQ2Reached} onChange={(e) => handleRuleChange('qualiQ2Reached', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Q1 Elim (17-22)', it: 'Eliminato Q1 (17-22)', fr: 'Ãƒâ€°liminÃƒÂ© Q1 (17-22)', de: 'Q1 Ausgeschieden (17.-22.)', es: 'Eliminado Q1 (17-22)' })}</label><input type="number" value={data.rules.qualiQ1Eliminated} onChange={(e) => handleRuleChange('qualiQ1Eliminated', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Grid Penalty', it: 'PenalitÃƒÂ  Griglia', fr: 'PÃƒÂ©nalitÃƒÂ© Grille', de: 'Startplatzstrafe', es: 'PenalizaciÃƒÂ³n Parrilla' })}</label><input type="number" value={data.rules.qualiGridPenalty} onChange={(e) => handleRuleChange('qualiGridPenalty', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Race Bonuses */}
                <div><label className="text-xs text-slate-400">{t({ en: 'Last Place Malus', it: 'Malus Ultimo Posto', fr: 'Malus DerniÃƒÂ¨re Place', de: 'Malus Letzter Platz', es: 'Malus ÃƒÅ¡ltimo Lugar' })}</label><input type="number" value={data.rules.raceLastPlaceMalus} onChange={(e) => handleRuleChange('raceLastPlaceMalus', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'DNF / DNS / DSQ', it: 'Ritirato / Squalificato', fr: 'Abandon / DisqualifiÃƒÂ©', de: 'DNF / DNS / DSQ', es: 'Abandono / Descalificado' })}</label><input type="number" value={data.rules.raceDNF} onChange={(e) => handleRuleChange('raceDNF', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Race Penalty', it: 'PenalitÃƒÂ  Gara', fr: 'PÃƒÂ©nalitÃƒÂ© Course', de: 'Rennstrafe', es: 'PenalizaciÃƒÂ³n Carrera' })}</label><input type="number" value={data.rules.racePenalty} onChange={(e) => handleRuleChange('racePenalty', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Pos Gained (per pos)', it: 'Pos Guadagnate (per pos)', fr: 'Pos GagnÃƒÂ©es (par pos)', de: 'Pos Gewonnen (pro Pos)', es: 'Pos Ganadas (por pos)' })}</label><input type="number" value={data.rules.positionGained} onChange={(e) => handleRuleChange('positionGained', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Pos Lost (per pos)', it: 'Pos Perse (per pos)', fr: 'Pos Perdues (par pos)', de: 'Pos Verloren (pro Pos)', es: 'Pos Perdidas (por pos)' })}</label><input type="number" value={data.rules.positionLost} onChange={(e) => handleRuleChange('positionLost', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Teammate */}
                <div><label className="text-xs text-slate-400">{t({ en: 'Beat Teammate', it: 'Batte Compagno', fr: 'Bat CoÃƒÂ©quipier', de: 'Teamkollegen geschlagen', es: 'Vence CompaÃƒÂ±ero' })}</label><input type="number" value={data.rules.teammateBeat} onChange={(e) => handleRuleChange('teammateBeat', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Lost to Teammate', it: 'Perde vs Compagno', fr: 'Perd contre CoÃƒÂ©quipier', de: 'Verliert gegen Teamk.', es: 'Pierde vs CompaÃƒÂ±ero' })}</label><input type="number" value={data.rules.teammateLost} onChange={(e) => handleRuleChange('teammateLost', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Beat TM (TM DNF)', it: 'Batte Compagno (Ritirato)', fr: 'Bat CoÃƒÂ©quipier (Abandon)', de: 'Teamk. geschlagen (DNF)', es: 'Vence Comp. (Abandono)' })}</label><input type="number" value={data.rules.teammateBeatDNF} onChange={(e) => handleRuleChange('teammateBeatDNF', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Sprint */}
                <div className="col-span-2 mt-2">
                  <label className="text-xs text-slate-400 block mb-1">{t({ en: 'Sprint Points (1st - 8th)', it: 'Punti Sprint (1Ã‚Â°-8Ã‚Â°)', fr: 'Points Sprint (1-8)', de: 'Sprintpunkte (1.-8.)', es: 'Puntos Sprint (1Ã‚Âº-8Ã‚Âº)' })}</label>
                  <input
                    type="text"
                    value={sprintPointsInput}
                    onChange={(e) => handleSprintPointsChange(e.target.value)}
                    className={`w-full bg-slate-900 border ${pointsError.sprint ? 'border-red-500' : 'border-slate-600'} rounded p-2 text-sm text-white`}
                  />
                  {pointsError.sprint && <p className="text-red-500 text-xs mt-1">{pointsError.sprint}</p>}
                </div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Sprint Quali Pole', it: 'Pole Sprint Quali', fr: 'Pole Qualif Sprint', de: 'Sprint Quali Pole', es: 'Pole Sprint Clasif' })}</label><input type="number" value={data.rules.sprintPole} onChange={(e) => handleRuleChange('sprintPole', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
              </div>
            </div>

            {/* Constructor Multipliers */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-4 border-b border-slate-700 pb-2">{t({ en: 'Constructor Multipliers', it: 'Coefficienti Scuderie', fr: 'Coefficients Ãƒâ€°quipes', de: 'Konstrukteurs-Multiplikatoren', es: 'Coeficientes Constructores', ru: 'ÃÅ¡ÃÂ¾Ã‘ÂÃ‘â€žÃ‘â€žÃÂ¸Ã‘â€ ÃÂ¸ÃÂµÃÂ½Ã‘â€šÃ‘â€¹ ÃÂºÃÂ¾ÃÂ½Ã‘ÂÃ‘â€šÃ‘â‚¬Ã‘Æ’ÃÂºÃ‘â€šÃÂ¾Ã‘â‚¬ÃÂ¾ÃÂ²', zh: 'Ã¨Â½Â¦Ã©ËœÅ¸Ã§Â³Â»Ã¦â€¢Â°', ar: 'Ã™â€¦Ã˜Â¹Ã˜Â§Ã™â€¦Ã™â€žÃ˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™ÂÃ˜Â±Ã™â€š', ja: 'Ã£â€šÂ³Ã£Æ’Â³Ã£â€šÂ¹Ã£Æ’Ë†Ã£Æ’Â©Ã£â€šÂ¯Ã£â€šÂ¿Ã£Æ’Â¼Ã¤Â¿â€šÃ¦â€¢Â°' })}</h3>
              <div className="grid grid-cols-2 gap-3">
                {data.constructors.map(c => (
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

            {/* Profile & Logout Card */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-2">{t({ en: 'User Profile', it: 'Profilo Utente', fr: 'Profil utilisateur', de: 'Benutzerprofil', es: 'Perfil usuario', ru: 'ÃÅ¸Ã‘â‚¬ÃÂ¾Ã‘â€žÃÂ¸ÃÂ»Ã‘Å’', zh: 'Ã§â€Â¨Ã¦Ë†Â·Ã¨Âµâ€žÃ¦â€“â„¢', ar: 'Ã™â€¦Ã™â€žÃ™Â Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦', ja: 'Ã£Æ’â€”Ã£Æ’Â­Ã£Æ’â€¢Ã£â€šÂ£Ã£Æ’Â¼Ã£Æ’Â«' })}</h3>
              <div className="mb-4 text-sm text-slate-300">
                <p><span className="text-slate-500">{t({ en: 'Name', it: 'Nome', fr: 'Nom', de: 'Name', es: 'Nombre', ru: 'ÃËœÃÂ¼Ã‘Â', zh: 'Ã¥ÂÂÃ¥Â­â€”', ar: 'Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â³Ã™â€¦', ja: 'Ã¥ÂÂÃ¥â€°Â' })}:</span> {data.user?.name}</p>
                <p><span className="text-slate-500">{t({ en: 'Role', it: 'Ruolo', fr: 'RÃƒÂ´le', de: 'Rolle', es: 'Rol', ru: 'Ã ÃÂ¾ÃÂ»Ã‘Å’', zh: 'Ã¨Â§â€™Ã¨â€°Â²', ar: 'Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±', ja: 'Ã¥Â½Â¹Ã¥â€°Â²' })}:</span> {data.user?.isAdmin ? 'Admin' : 'Member'}</p>
                <p><span className="text-slate-500">{t({ en: 'League Code', it: 'Codice Lega', fr: 'Code Ligue', de: 'Liga-Code', es: 'CÃƒÂ³digo Liga', ru: 'ÃÅ¡ÃÂ¾ÃÂ´ ÃÂ»ÃÂ¸ÃÂ³ÃÂ¸', zh: 'Ã¨Ââ€Ã§â€ºÅ¸Ã¤Â»Â£Ã§ Â', ar: 'Ã˜Â±Ã™â€¦Ã˜Â² Ã˜Â§Ã™â€žÃ˜Â¯Ã™Ë†Ã˜Â±Ã™Å ', ja: 'Ã£Æ’ÂªÃ£Æ’Â¼Ã£â€šÂ°Ã£â€šÂ³Ã£Æ’Â¼Ã£Æ’â€°' })}:</span> <span className="font-mono text-blue-400">{data.user?.leagueCode}</span></p>
              </div>

              <div className="flex flex-col gap-3 mt-4">
                <button
                  onClick={handleLogout}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                  {t({ en: 'Logout', it: 'Esci', fr: 'DÃƒÂ©connexion', de: 'Abmelden', es: 'Salir', ru: 'Ãâ€™Ã‘â€¹ÃÂ¹Ã‘â€šÃÂ¸', zh: 'Ã§â„¢Â»Ã¥â€¡Âº', ar: 'Ã˜Â®Ã˜Â±Ã™Ë†Ã˜Â¬', ja: 'Ã£Æ’Â­Ã£â€šÂ°Ã£â€šÂ¢Ã£â€šÂ¦Ã£Æ’Ë†' })}
                </button>
                {showResetConfirm ? (
                  <div className="bg-red-950/50 border border-red-500 p-4 rounded-lg animate-pulse">
                    <p className="text-red-200 text-center mb-3 font-bold">{t({ en: 'Delete all local data?', it: 'Eliminare i dati locali?', fr: 'Supprimer donnÃƒÂ©es locales?', de: 'Lokale Daten lÃƒÂ¶schen?', es: 'Ã‚Â¿Borrar datos locales?', ru: 'ÃÂ£ÃÂ´ÃÂ°ÃÂ»ÃÂ¸Ã‘â€šÃ‘Å’ ÃÂ´ÃÂ°ÃÂ½ÃÂ½Ã‘â€¹ÃÂµ?', zh: 'Ã¥Ë† Ã©â„¢Â¤Ã¦Å“Â¬Ã¥Å“Â°Ã¦â€¢Â°Ã¦ÂÂ®Ã¯Â¼Å¸', ar: 'Ã˜Â­Ã˜Â°Ã™Â Ã˜Â§Ã™â€žÃ˜Â¨Ã™Å Ã˜Â§Ã™â€ Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã™â€žÃ™Å Ã˜Â©Ã˜Å¸', ja: 'Ã¥â€¦Â¨Ã£Æ’â€¡Ã£Æ’Â¼Ã£â€šÂ¿Ã£â€šâ€™Ã¥â€°Å Ã©â„¢Â¤Ã£Ââ€”Ã£ÂÂ¾Ã£Ââ„¢Ã£Ââ€¹Ã¯Â¼Å¸' })}</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="flex-1 bg-slate-600 text-white py-2 rounded hover:bg-slate-500"
                      >
                        {t({ en: 'Cancel', it: 'Annulla', fr: 'Annuler', de: 'Abbrechen', es: 'Cancelar', ru: 'ÃÅ¾Ã‘â€šÃÂ¼ÃÂµÃÂ½ÃÂ°', zh: 'Ã¥Ââ€“Ã¦Â¶Ë†', ar: 'Ã˜Â¥Ã™â€žÃ˜ÂºÃ˜Â§Ã˜Â¡', ja: 'Ã£â€šÂ­Ã£Æ’Â£Ã£Æ’Â³Ã£â€šÂ»Ã£Æ’Â«' })}
                      </button>
                      <button
                        onClick={handleLogout}
                        className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-500"
                      >
                        {t({ en: 'Confirm', it: 'Conferma', fr: 'Confirmer', de: 'BestÃƒÂ¤tigen', es: 'Confirmar', ru: 'ÃÅ¸ÃÂ¾ÃÂ´Ã‘â€šÃÂ²ÃÂµÃ‘â‚¬ÃÂ´ÃÂ¸Ã‘â€šÃ‘Å’', zh: 'Ã§Â¡Â®Ã¨Â®Â¤', ar: 'Ã˜ÂªÃ˜Â£Ã™Æ’Ã™Å Ã˜Â¯', ja: 'Ã§Â¢ÂºÃ¨ÂªÂ' })}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full bg-red-900/50 hover:bg-red-800/50 text-red-200 font-bold py-2 px-4 rounded transition-colors border border-red-900"
                  >
                    {t({ en: 'Reset All Data (Logout)', it: 'Resetta Dati (Logout)', fr: 'RÃƒÂ©initialiser (DÃƒÂ©connexion)', de: 'Reset (Abmelden)', es: 'Reiniciar (Salir)', ru: 'ÃÂ¡ÃÂ±Ã‘â‚¬ÃÂ¾Ã‘Â (Ãâ€™Ã‘â€¹Ã‘â€¦ÃÂ¾ÃÂ´)', zh: 'Ã©â€¡ÂÃ§Â½Â®Ã¦â€°â‚¬Ã¦Å“â€°Ã¦â€¢Â°Ã¦ÂÂ®', ar: 'Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  (Ã˜Â®Ã˜Â±Ã™Ë†Ã˜Â¬)', ja: 'Ã£Æ’ÂªÃ£â€šÂ»Ã£Æ’Æ’Ã£Æ’Ë† (Ã£Æ’Â­Ã£â€šÂ°Ã£â€šÂ¢Ã£â€šÂ¦Ã£Æ’Ë†)' })}
                  </button>
                )}
              </div>
            </div>

            {/* Toggle Debug */}
            <div className="flex justify-center">
              <button
                onClick={() => setShowDebug(!showDebug)}
                className="text-xs text-slate-500 hover:text-slate-300 underline"
              >
                {showDebug ? t({ en: 'Hide Debug Info', it: 'Nascondi Debug', fr: 'Masquer Debug', de: 'Debug verbergen', es: 'Ocultar Debug', ru: 'ÃÂ¡ÃÂºÃ‘â‚¬Ã‘â€¹Ã‘â€šÃ‘Å’ ÃÂ¾Ã‘â€šÃÂ»ÃÂ°ÃÂ´ÃÂºÃ‘Æ’', zh: 'Ã©Å¡ÂÃ¨â€”ÂÃ¨Â°Æ’Ã¨Â¯â€¢', ar: 'Ã˜Â¥Ã˜Â®Ã™ÂÃ˜Â§Ã˜Â¡ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ˜Â­Ã™Å Ã˜Â­', ja: 'Ã£Æ’â€¡Ã£Æ’ÂÃ£Æ’Æ’Ã£â€šÂ°Ã©ÂÅ¾Ã¨Â¡Â¨Ã§Â¤Âº' }) : t({ en: 'Show Debug Info', it: 'Mostra Debug', fr: 'Afficher Debug', de: 'Debug zeigen', es: 'Mostrar Debug', ru: 'ÃÅ¸ÃÂ¾ÃÂºÃÂ°ÃÂ·ÃÂ°Ã‘â€šÃ‘Å’ ÃÂ¾Ã‘â€šÃÂ»ÃÂ°ÃÂ´ÃÂºÃ‘Æ’', zh: 'Ã¦ËœÂ¾Ã§Â¤ÂºÃ¨Â°Æ’Ã¨Â¯â€¢', ar: 'Ã˜Â¥Ã˜Â¸Ã™â€¡Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂµÃ˜Â­Ã™Å Ã˜Â­', ja: 'Ã£Æ’â€¡Ã£Æ’ÂÃ£Æ’Æ’Ã£â€šÂ°Ã¨Â¡Â¨Ã§Â¤Âº' })}
              </button>
            </div>

            {/* Debug Info (Collapsed) */}
            {showDebug && (
              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/50">
                <h3 className="font-semibold text-white mb-2">{t({ en: 'Debug', it: 'Debug', fr: 'Debug', de: 'Debug', es: 'Debug', ru: 'ÃÅ¾Ã‘â€šÃÂ»ÃÂ°ÃÂ´ÃÂºÃÂ°', zh: 'Ã¨Â°Æ’Ã¨Â¯â€¢', ar: 'Ã˜ÂªÃ˜ÂµÃ˜Â­Ã™Å Ã˜Â­', ja: 'Ã£Æ’â€¡Ã£Æ’ÂÃ£Æ’Æ’Ã£â€šÂ°' })}</h3>
                <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded mb-4 overflow-x-auto border border-slate-800">
                  {JSON.stringify(data.team, null, 2)}
                </div>

                <h3 className="font-semibold text-white mb-2 mt-4">{t({ en: 'Race Lock Debug', it: 'Debug Blocco Gara', fr: 'Debug Verrouillage', de: 'Renn-Sperre Debug', es: 'Debug Bloqueo', ru: 'ÃÅ¾Ã‘â€šÃÂ»ÃÂ°ÃÂ´ÃÂºÃÂ° ÃÂ±ÃÂ»ÃÂ¾ÃÂºÃÂ¸Ã‘â‚¬ÃÂ¾ÃÂ²ÃÂºÃÂ¸', zh: 'Ã©â€ÂÃ¥Â®Å¡Ã¨Â°Æ’Ã¨Â¯â€¢', ar: 'Ã˜ÂªÃ˜ÂµÃ˜Â­Ã™Å Ã˜Â­ Ã™â€šÃ™ÂÃ™â€ž Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â¨Ã˜Â§Ã™â€š', ja: 'Ã£Æ’Â¬Ã£Æ’Â¼Ã£â€šÂ¹Ã£Æ’Â­Ã£Æ’Æ’Ã£â€šÂ¯Ã£Æ’â€¡Ã£Æ’ÂÃ£Æ’Æ’Ã£â€šÂ°' })}</h3>
                <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded mb-4 overflow-x-auto border border-slate-800">
                  <p>Race: {currentRace.name}</p>
                  <p>Status: <span className={getStatusColor(lockState.status)}>{lockState.status}</span></p>
                  <p>Session: {currentRace.isSprint ? t({ en: 'Sprint Qualifying', it: 'Sprint Shootout', fr: 'Qualif Sprint', de: 'Sprint Quali', es: 'Sprint Clasif', ru: 'ÃÂ¡ÃÂ¿Ã‘â‚¬ÃÂ¸ÃÂ½Ã‘â€š ÃÅ¡ÃÂ²ÃÂ°ÃÂ»', zh: 'Ã¥â€ Â²Ã¥Ë†ÂºÃ¦Å½â€™Ã¤Â½Â', ar: 'Ã˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â³Ã˜Â±Ã˜Â¹Ã˜Â©', ja: 'Ã£â€šÂ¹Ã£Æ’â€”Ã£Æ’ÂªÃ£Æ’Â³Ã£Æ’Ë†Ã¤ÂºË†Ã©ÂÂ¸' }) : t({ en: 'Qualifying', it: 'Qualifiche', fr: 'Qualifications', de: 'Qualifying', es: 'ClasificaciÃƒÂ³n', ru: 'ÃÅ¡ÃÂ²ÃÂ°ÃÂ»ÃÂ¸Ã‘â€žÃÂ¸ÃÂºÃÂ°Ã‘â€ ÃÂ¸Ã‘Â', zh: 'Ã¦Å½â€™Ã¤Â½ÂÃ¨Âµâ€º', ar: 'Ã˜ÂªÃ˜ÂµÃ™ÂÃ™Å Ã˜Â§Ã˜Âª', ja: 'Ã¤ÂºË†Ã©ÂÂ¸' })}</p>
                  <p>Target UTC: {lockState.targetSessionUtc || 'N/A'}</p>
                  <p>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</p>
                  <p>Server Time: {new Date(now).toISOString()}</p>
                </div>
              </div>
            )}
          </div>
        );

      case Tab.ADMIN:
        return renderAdmin();

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

  const renderAdmin = () => {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-white">{t({ en: 'Administrator', it: 'Amministratore' })}</h1>
          <p className="text-slate-400 text-sm">{t({ en: 'Manage drivers prices and points.', it: 'Gestisci quotazioni e punteggi.' })}</p>
        </header>

        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-4">
          <div className="flex justify-between items-center border-b border-slate-700 pb-2">
             <h2 className="text-lg font-bold text-white uppercase tracking-wider">{t({ en: 'Drivers List', it: 'Lista Piloti' })}</h2>
             <button 
                onClick={saveAdminUpdates}
                disabled={Object.keys(adminUpdates).length === 0}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white text-xs font-bold py-2 px-4 rounded transition-all"
             >
                {t({ en: 'SAVE ALL', it: 'SALVA TUTTO' })}
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
                            <label className="text-[10px] uppercase text-slate-500 font-bold mb-1 block">Price ($M)</label>
                            <input 
                               type="number" 
                               step="0.1" 
                               value={price}
                               onChange={(e) => handleAdminValueChange(d.id, 'price', Number(e.target.value))}
                               className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white font-mono text-sm"
                            />
                         </div>
                         <div>
                            <label className="text-[10px] uppercase text-slate-500 font-bold mb-1 block">Total Pts</label>
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
      {activeTab === Tab.HOME && LangMenu}
      <Layout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        showAdmin={data.user.isAdmin}
        lang={language}
        t={t}
      >
        {renderContent()}
      </Layout>
    </>
  );
};

export default App;


