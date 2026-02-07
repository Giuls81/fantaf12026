import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import { AppData, Tab, UserTeam, Driver, Race, User, ScoringRules } from './types';
import { DEFAULT_SCORING_RULES, RACES_2026, DRIVERS, CONSTRUCTORS } from './constants';
import { health, getRaces } from "./api";

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
  const idx = races.findIndex(r => new Date(r.date + 'T00:00:00') >= today);
  return idx === -1 ? races.length - 1 : idx;
};

type LangCode = 'en' | 'it' | 'fr' | 'de' | 'es' | 'ru' | 'zh' | 'ar' | 'ja';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.HOME);
  const [data, setData] = useState<AppData | null>(null);
  const [swapCandidate, setSwapCandidate] = useState<Driver | null>(null);
  const [now, setNow] = useState(Date.now());
  const [races, setRaces] = useState<Race[]>(RACES_2026);
  const [racesSource, setRacesSource] = useState<"API" | "LOCAL">("LOCAL");

  // Load races from API (fallback to localStorage, then constants)
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const apiRaces = await getRaces();
        if (!alive) return;

        setRaces(apiRaces as unknown as Race[]);
        setRacesSource("API");

        // keep local cache updated
        localStorage.setItem("fantaF1Races", JSON.stringify(apiRaces));
      } catch {
        if (!alive) return;

        const storedRaces = localStorage.getItem("fantaF1Races");
        if (storedRaces) {
          try {
            setRaces(JSON.parse(storedRaces));
            setRacesSource("LOCAL");
            return;
          } catch {
            // ignore parse error
          }
        }

        setRaces(RACES_2026 as unknown as Race[]);
        setRacesSource("LOCAL");
      }
    })();

    return () => {
      alive = false;
    };
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

  // Translation Helper
  const t = (dict: { [key: string]: string }) => {
    return dict[language] || dict['en'] || '';
  };

  // NOTE: The separate useEffect for loading races from localStorage has been removed
  // to avoid overwriting the API call in the main useEffect above.

  // Load data from localStorage on mount
  useEffect(() => {
    const storedData = localStorage.getItem('fantaF1Data');
    if (storedData) {
      try {
        const parsed = JSON.parse(storedData);
        // Robustness checks
        if (typeof parsed.currentRaceIndex !== 'number') {
          parsed.currentRaceIndex = getNextRaceIndex(RACES_2026);
        } else {
          if (parsed.currentRaceIndex < 0) parsed.currentRaceIndex = 0;
          if (parsed.currentRaceIndex >= RACES_2026.length) parsed.currentRaceIndex = RACES_2026.length - 1;
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
        setData(INITIAL_DATA);
      }
    } else {
      setData(INITIAL_DATA);
    }
  }, []);

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
  useEffect(() => {
    localStorage.setItem('fantaF1Races', JSON.stringify(races));
  }, [races]);

  // Redirect non-admins if they try to access Admin tab
  useEffect(() => {
    if (data?.user && !data.user.isAdmin && activeTab === Tab.ADMIN) {
      setActiveTab(Tab.HOME);
    }
  }, [activeTab, data]);

  const handleLogin = () => {
    if (!username.trim()) return alert(t({ en: "Please enter a username.", it: "Inserisci un nome utente." }));

    let newUser: User;

    if (loginMode === 'create') {
      if (!leagueName.trim()) return alert(t({ en: "Please enter a league name.", it: "Inserisci il nome della lega." }));
      // Generate random 6 char code
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      newUser = {
        id: 'u_' + Date.now(),
        name: username.trim(),
        isAdmin: true,
        leagueName: leagueName.trim(),
        leagueCode: code
      };
    } else {
      if (!leagueCodeInput.trim() || leagueCodeInput.length < 6) return alert(t({ en: "Please enter a valid 6-character league code.", it: "Inserisci un codice lega valido di 6 caratteri." }));
      newUser = {
        id: 'u_' + Date.now(),
        name: username.trim(),
        isAdmin: false,
        leagueCode: leagueCodeInput.trim().toUpperCase()
      };
    }

    // Auto-select next race
    const nextRaceIndex = getNextRaceIndex(races);

    setData({
      ...INITIAL_DATA,
      user: newUser,
      currentRaceIndex: nextRaceIndex
    });
    setActiveTab(Tab.HOME);
  };

  const handleLogout = () => {
    localStorage.removeItem('fantaF1Data');
    localStorage.removeItem('fantaF1Races');
    setData(INITIAL_DATA);
    setRaces(RACES_2026);
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

  const handleBuyDriver = (driver: Driver) => {
    if (!data) return;
    if (data.team.budget < driver.price) {
      alert(t({ en: "Insufficient budget!", it: "Budget insufficiente!" }));
      return;
    }
    const newBudget = data.team.budget - driver.price;
    const newDriverIds = [...data.team.driverIds, driver.id];

    const newTeamRaw = {
      ...data.team,
      driverIds: newDriverIds,
      budget: newBudget,
      totalValue: calculateTotalValue(newBudget, newDriverIds)
    };

    const finalTeam = sanitizeTeamRoles(newTeamRaw);

    setData({
      ...data,
      team: finalTeam
    });
  };

  const handleSwapDriver = (driverOut: Driver, driverIn: Driver) => {
    if (!data) return;
    const newBudget = data.team.budget + driverOut.price - driverIn.price;
    if (newBudget < 0) {
      alert(t({ en: "Insufficient budget for this swap.", it: "Budget insufficiente per questo scambio." }));
      return;
    }

    const newDriverIds = data.team.driverIds.filter(id => id !== driverOut.id);
    newDriverIds.push(driverIn.id);

    const newTeamRaw = {
      ...data.team,
      driverIds: newDriverIds,
      budget: newBudget,
      totalValue: calculateTotalValue(newBudget, newDriverIds)
    };

    const finalTeam = sanitizeTeamRoles(newTeamRaw);

    setData({
      ...data,
      team: finalTeam
    });
    setSwapCandidate(null);
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

  const handleSetCaptain = (driverId: string) => {
    if (!data) return;
    const currentRace = races[data.currentRaceIndex];
    const lockState = getLockStatus(currentRace, now);
    if (lockState.status === 'locked') return;

    let newCaptainId = driverId;
    let newReserveId = data.team.reserveDriverId;
    const oldCaptainId = data.team.captainId;

    if (newReserveId === driverId) {
      newReserveId = oldCaptainId;
    }

    setData({
      ...data,
      team: {
        ...data.team,
        captainId: newCaptainId,
        reserveDriverId: newReserveId
      }
    });
  };

  const handleSetReserve = (driverId: string) => {
    if (!data) return;
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

    setData({
      ...data,
      team: {
        ...data.team,
        captainId: newCaptainId,
        reserveDriverId: newReserveId
      }
    });
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
              {t({ en: 'Create League', it: 'Crea Lega', fr: 'CrÃ©er ligue', de: 'Liga erstellen', es: 'Crear liga', ru: 'Ð¡Ð¾Ð·Ð´Ð°Ñ‚ÑŒ Ð»Ð¸Ð³Ñƒ', zh: 'åˆ›å»ºè”ç›Ÿ', ar: 'Ø¥Ù†Ø´Ø§Ø¡ Ø¯ÙˆØ±ÙŠ', ja: 'ãƒªãƒ¼ã‚°ä½œæˆ' })}
            </button>
            <button
              onClick={() => setLoginMode('join')}
              className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${loginMode === 'join' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {t({ en: 'Join League', it: 'Unisciti', fr: 'Rejoindre', de: 'Beitreten', es: 'Unirse', ru: 'Ð’Ð¾Ð¹Ñ‚Ð¸', zh: 'åŠ å…¥è”ç›Ÿ', ar: 'Ø§Ù†Ø¶Ù…Ø§Ù…', ja: 'å‚åŠ ' })}
            </button>
          </div>

          {/* Common Input */}
          <div className="mb-4">
            <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'Username', it: 'Nome Utente', fr: "Nom d'utilisateur", de: 'Benutzername', es: 'Usuario', ru: 'Ð˜Ð¼Ñ Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»Ñ', zh: 'ç”¨æˆ·å', ar: 'Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…', ja: 'ãƒ¦ãƒ¼ã‚¶ãƒ¼å' })}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t({ en: 'Enter your name', it: 'Inserisci nome', fr: 'Entrez votre nom', de: 'Name eingeben', es: 'Ingresa tu nombre', ru: 'Ð’Ð²ÐµÐ´Ð¸Ñ‚Ðµ Ð¸Ð¼Ñ', zh: 'è¾“å…¥åå­—', ar: 'Ø£Ø¯Ø®Ù„ Ø§Ø³Ù…Ùƒ', ja: 'åå‰ã‚’å…¥åŠ›' })}
              className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Create Fields */}
          {loginMode === 'create' && (
            <div className="mb-6">
              <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'League Name', it: 'Nome Lega', fr: 'Nom de la ligue', de: 'Liganame', es: 'Nombre Liga', ru: 'ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ Ð»Ð¸Ð³Ð¸', zh: 'è”ç›Ÿåç§°', ar: 'Ø§Ø³Ù… Ø§Ù„Ø¯ÙˆØ±ÙŠ', ja: 'ãƒªãƒ¼ã‚°å' })}</label>
              <input
                type="text"
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                placeholder={t({ en: 'e.g. Sunday Racing Club', it: 'es. Racing Club', fr: 'ex. Racing Club', de: 'z.B. Racing Club', es: 'ej. Racing Club', ru: 'Ð½Ð°Ð¿Ñ€. ÐšÐ»ÑƒÐ±', zh: 'ä¾‹å¦‚ï¼šå‘¨æ—¥èµ›è½¦', ar: 'Ù…Ø«Ø§Ù„: Ù†Ø§Ø¯ÙŠ Ø§Ù„Ø³Ø¨Ø§Ù‚', ja: 'ä¾‹: ãƒ¬ãƒ¼ã‚·ãƒ³ã‚°ã‚¯ãƒ©ãƒ–' })}
                className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Join Fields */}
          {loginMode === 'join' && (
            <div className="mb-6">
              <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({ en: 'League Code', it: 'Codice Lega', fr: 'Code Ligue', de: 'Liga-Code', es: 'CÃ³digo Liga', ru: 'ÐšÐ¾Ð´ Ð»Ð¸Ð³Ð¸', zh: 'è”ç›Ÿä»£ç ', ar: 'Ø±Ù…Ø² Ø§Ù„Ø¯ÙˆØ±ÙŠ', ja: 'ãƒªãƒ¼ã‚°ã‚³ãƒ¼ãƒ‰' })}</label>
              <input
                type="text"
                value={leagueCodeInput}
                onChange={(e) => setLeagueCodeInput(e.target.value.toUpperCase())}
                placeholder={t({ en: '6-Digit Code', it: 'Codice 6 cifre', fr: 'Code 6 chiffres', de: '6-stelliger Code', es: 'CÃ³digo 6 dÃ­gitos', ru: '6 Ñ†Ð¸Ñ„Ñ€', zh: '6ä½ä»£ç ', ar: 'Ø±Ù…Ø² Ù…Ù† 6 Ø£Ø±Ù‚Ø§Ù…', ja: '6æ¡ã‚³ãƒ¼ãƒ‰' })}
                maxLength={6}
                className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest uppercase"
              />
            </div>
          )}

          <button
            onClick={handleLogin}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-3 px-4 rounded transition-all shadow-lg transform hover:scale-[1.02]"
          >
            {loginMode === 'create' ? t({ en: 'Start Season', it: 'Inizia Stagione', fr: 'DÃ©marrer saison', de: 'Saison starten', es: 'Iniciar temporada', ru: 'ÐÐ°Ñ‡Ð°Ñ‚ÑŒ ÑÐµÐ·Ð¾Ð½', zh: 'å¼€å§‹èµ›å­£', ar: 'Ø¨Ø¯Ø¡ Ø§Ù„Ù…ÙˆØ³Ù…', ja: 'ã‚·ãƒ¼ã‚ºãƒ³é–‹å§‹' }) : t({ en: 'Join Season', it: 'Unisciti', fr: 'Rejoindre saison', de: 'Beitreten', es: 'Unirse', ru: 'ÐŸÑ€Ð¸ÑÐ¾ÐµÐ´Ð¸Ð½Ð¸Ñ‚ÑŒÑÑ', zh: 'åŠ å…¥èµ›å­£', ar: 'Ø§Ù†Ø¶Ù…Ø§Ù… Ù„Ù„Ù…ÙˆØ³Ù…', ja: 'ã‚·ãƒ¼ã‚ºãƒ³å‚åŠ ' })}
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
              <h1 className="text-2xl font-bold text-white">{t({ en: 'Welcome', it: 'Benvenuto', fr: 'Bienvenue', de: 'Willkommen', es: 'Bienvenido', ru: 'Ð”Ð¾Ð±Ñ€Ð¾ Ð¿Ð¾Ð¶Ð°Ð»Ð¾Ð²Ð°Ñ‚ÑŒ', zh: 'æ¬¢è¿Ž', ar: 'Ù…Ø±Ø­Ø¨Ø§Ù‹', ja: 'ã‚ˆã†ã“ã' })}, {data.user?.name}</h1>
              <p className="text-slate-400">
                {data.user?.isAdmin ? `${t({ en: 'Admin of', it: 'Admin di', fr: 'Admin de', de: 'Admin von', es: 'Admin de', ru: 'ÐÐ´Ð¼Ð¸Ð½', zh: 'ç®¡ç†å‘˜', ar: 'Ù…Ø³Ø¤ÙˆÙ„ Ø¹Ù†', ja: 'ç®¡ç†è€…' })} ${data.user.leagueName}` : t({ en: 'Member', it: 'Membro', fr: 'Membre', de: 'Mitglied', es: 'Miembro', ru: 'Ð£Ñ‡Ð°ÑÑ‚Ð½Ð¸Ðº', zh: 'æˆå‘˜', ar: 'Ø¹Ø¶Ùˆ', ja: 'ãƒ¡ãƒ³ãƒãƒ¼' })}
              </p>
              {data.user?.isAdmin && (
                <div className="mt-2 inline-block bg-blue-900/50 border border-blue-500/30 rounded px-3 py-1">
                  <span className="text-slate-400 text-xs mr-2">{t({ en: 'LEAGUE CODE', it: 'CODICE LEGA', fr: 'CODE LIGUE', de: 'LIGA-CODE', es: 'CÃ“DIGO LIGA', ru: 'ÐšÐžÐ” Ð›Ð˜Ð“Ð˜', zh: 'è”ç›Ÿä»£ç ', ar: 'Ø±Ù…Ø² Ø§Ù„Ø¯ÙˆØ±ÙŠ', ja: 'ãƒªãƒ¼ã‚°ã‚³ãƒ¼ãƒ‰' })}:</span>
                  <span className="font-mono font-bold text-blue-300">{data.user.leagueCode}</span>
                </div>
              )}
            </header>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h2 className="text-lg font-semibold text-blue-400 mb-2">{t({ en: 'Selected Race', it: 'Gara Selezionata', fr: 'Course sÃ©lectionnÃ©e', de: 'AusgewÃ¤hltes Rennen', es: 'Carrera seleccionada', ru: 'Ð’Ñ‹Ð±Ñ€Ð°Ð½Ð½Ð°Ñ Ð³Ð¾Ð½ÐºÐ°', zh: 'å·²é€‰èµ›äº‹', ar: 'Ø§Ù„Ø³Ø¨Ø§Ù‚ Ø§Ù„Ù…Ø­Ø¯Ø¯', ja: 'é¸æŠžã•ã‚ŒãŸãƒ¬ãƒ¼ã‚¹' })}</h2>
              <div className="text-3xl font-bold text-white">{currentRace.name}</div>
              <div className="text-slate-400 mt-1">{currentRace.date}</div>
              {lockState.status !== 'unconfigured' && (
                <div className="mt-3 bg-slate-900/50 p-2 rounded text-center border border-slate-600">
                  <span className="text-xs text-slate-400 uppercase mr-2">{t({ en: 'Lineup Locks In', it: 'Chiude tra', fr: 'Verrouillage dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Ð—Ð°ÐºÑ€Ñ‹Ñ‚Ð¸Ðµ Ñ‡ÐµÑ€ÐµÐ·', zh: 'é˜µå®¹é”å®šäºŽ', ar: 'ÙŠØºÙ„Ù‚ Ø§Ù„ØªØ´ÙƒÙŠÙ„ ÙÙŠ', ja: 'ãƒ©ã‚¤ãƒ³ãƒŠãƒƒãƒ—å›ºå®šã¾ã§' })}</span>
                  <span className={`font-mono font-bold ${lockState.status === 'locked' ? 'text-red-400' : 'text-green-400'}`}>
                    {lockState.status === 'locked' ? 'LOCKED' : formatCountdown(lockState.msToLock || 0)}
                  </span>
                </div>
              )}
            </div>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h2 className="text-lg font-semibold text-green-400 mb-2">{t({ en: 'Team Status', it: 'Stato Team', fr: 'Statut Ã©quipe', de: 'Teamstatus', es: 'Estado Equipo', ru: 'Ð¡Ñ‚Ð°Ñ‚ÑƒÑ ÐºÐ¾Ð¼Ð°Ð½Ð´Ñ‹', zh: 'è½¦é˜ŸçŠ¶æ€', ar: 'Ø­Ø§Ù„Ø© Ø§Ù„ÙØ±ÙŠÙ‚', ja: 'ãƒãƒ¼ãƒ çŠ¶æ³' })}</h2>
              <div className="flex justify-between items-center mb-2">
                <span className="text-slate-300">{t({ en: 'Budget', it: 'Budget', fr: 'Budget', de: 'Budget', es: 'Presupuesto', ru: 'Ð‘ÑŽÐ´Ð¶ÐµÑ‚', zh: 'é¢„ç®—', ar: 'Ø§Ù„Ù…ÙŠØ²Ø§Ù†ÙŠØ©', ja: 'äºˆç®—' })}</span>
                <span className="font-mono text-white text-lg">${data.team.budget.toFixed(1)}M</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-300">{t({ en: 'Drivers Signed', it: 'Piloti', fr: 'Pilotes', de: 'Fahrer', es: 'Pilotos', ru: 'ÐŸÐ¸Ð»Ð¾Ñ‚Ñ‹', zh: 'è½¦æ‰‹', ar: 'Ø§Ù„Ø³Ø§Ø¦Ù‚ÙŠÙ†', ja: 'å¥‘ç´„ãƒ‰ãƒ©ã‚¤ãƒãƒ¼' })}</span>
                <span className="font-mono text-white text-lg">{data.team.driverIds.length}/5</span>
              </div>
            </div>
          </div>
        );

      case Tab.TEAM:
        return (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-white mb-4">{t({ en: 'My Team', it: 'Il Mio Team', fr: 'Mon Ã‰quipe', de: 'Mein Team', es: 'Mi Equipo', ru: 'ÐœÐ¾Ñ ÐšÐ¾Ð¼Ð°Ð½Ð´Ð°', zh: 'æˆ‘çš„è½¦é˜Ÿ', ar: 'ÙØ±ÙŠÙ‚ÙŠ', ja: 'ãƒžã‚¤ãƒãƒ¼ãƒ ' })}</h1>
            <div className="p-4 bg-slate-800 rounded-lg text-center border border-slate-700">
              <p className="text-slate-400 mb-2">{t({ en: 'Team Name', it: 'Nome Team', fr: "Nom de l'Ã©quipe", de: 'Teamname', es: 'Nombre del Equipo', ru: 'ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ ÐºÐ¾Ð¼Ð°Ð½Ð´Ñ‹', zh: 'è½¦é˜Ÿåç§°', ar: 'Ø§Ø³Ù… Ø§Ù„ÙØ±ÙŠÙ‚', ja: 'ãƒãƒ¼ãƒ å' })}</p>
              <h2 className="text-xl font-bold text-white">{data.team.name}</h2>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-200">{t({ en: 'Roster', it: 'Rosa', fr: 'Effectif', de: 'Kader', es: 'Plantilla', ru: 'Ð¡Ð¾ÑÑ‚Ð°Ð²', zh: 'é˜µå®¹', ar: 'Ø§Ù„Ù‚Ø§Ø¦Ù…Ø©', ja: 'ãƒ­ãƒ¼ã‚¹ã‚¿ãƒ¼' })}</h3>
              {data.team.driverIds.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg text-center text-slate-500">
                  {t({ en: 'No drivers selected yet. Go to Market.', it: 'Nessun pilota selezionato. Vai al Mercato.', fr: 'Aucun pilote sÃ©lectionnÃ©. Allez au MarchÃ©.', de: 'Noch keine Fahrer ausgewÃ¤hlt. Zum Markt gehen.', es: 'Sin pilotos seleccionados. Ir al Mercado.', ru: 'ÐŸÐ¸Ð»Ð¾Ñ‚Ñ‹ Ð½Ðµ Ð²Ñ‹Ð±Ñ€Ð°Ð½Ñ‹. ÐŸÐµÑ€ÐµÐ¹Ð´Ð¸Ñ‚Ðµ Ð½Ð° Ñ€Ñ‹Ð½Ð¾Ðº.', zh: 'å°šæœªé€‰æ‹©è½¦æ‰‹ã€‚å‰å¾€å¸‚åœºã€‚', ar: 'Ù„Ù… ÙŠØªÙ… Ø§Ø®ØªÙŠØ§Ø± Ø³Ø§Ø¦Ù‚ÙŠÙ† Ø¨Ø¹Ø¯. Ø§Ø°Ù‡Ø¨ Ø¥Ù„Ù‰ Ø§Ù„Ø³ÙˆÙ‚.', ja: 'ãƒ‰ãƒ©ã‚¤ãƒãƒ¼æœªé¸æŠžã€‚ãƒžãƒ¼ã‚±ãƒƒãƒˆã¸ã€‚' })}
                </div>
              ) : (
                <ul className="space-y-2">
                  {data.team.driverIds.map(id => {
                    const d = DRIVERS.find(drv => drv.id === id);
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
                <div className="text-yellow-400 font-bold">{t({ en: 'Config Missing', it: 'Config Mancante', fr: 'Config manquante', de: 'Konfig fehlt', es: 'Falta config', ru: 'ÐÐµÑ‚ ÐºÐ¾Ð½Ñ„Ð¸Ð³Ð°', zh: 'ç¼ºå°‘é…ç½®', ar: 'Ø§Ù„ØªÙƒÙˆÙŠÙ† Ù…ÙÙ‚ÙˆØ¯', ja: 'è¨­å®šä¸è¶³' })}</div>
                <div className="text-xs text-yellow-200">{t({ en: 'Admin: Set UTC times.', it: 'Admin: Imposta orari UTC.', fr: 'Admin: DÃ©finir heures UTC.', de: 'Admin: UTC-Zeiten setzen.', es: 'Admin: Fijar horas UTC.', ru: 'ÐÐ´Ð¼Ð¸Ð½: Ð£ÑÑ‚. UTC.', zh: 'ç®¡ç†å‘˜ï¼šè®¾ç½®UTCæ—¶é—´ã€‚', ar: 'Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„: ØªØ¹ÙŠÙŠÙ† ØªÙˆÙ‚ÙŠØª UTC.', ja: 'ç®¡ç†è€…: UTCè¨­å®š' })}</div>
              </div>
            )}
            {lockState.status === 'open' && (
              <div className="bg-green-900/50 border border-green-600 p-3 rounded text-center">
                <div className="text-green-400 font-bold">{t({ en: 'Lineup Open', it: 'Formazione Aperta', fr: 'Alignement ouvert', de: 'Lineup offen', es: 'AlineaciÃ³n abierta', ru: 'Ð¡Ð¾ÑÑ‚Ð°Ð² Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚', zh: 'é˜µå®¹å¼€æ”¾', ar: 'Ø§Ù„ØªØ´ÙƒÙŠÙ„ Ù…ÙØªÙˆØ­', ja: 'ãƒ©ã‚¤ãƒ³ãƒŠãƒƒãƒ—å¤‰æ›´å¯' })}</div>
                {lockState.msToLock !== null && (
                  <div className="text-xs text-green-200">{t({ en: 'Locks in', it: 'Chiude tra', fr: 'Verrouille dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Ð—Ð°ÐºÑ€Ñ‹Ñ‚Ð¸Ðµ Ñ‡ÐµÑ€ÐµÐ·', zh: 'é”å®šäºŽ', ar: 'ÙŠØºÙ„Ù‚ ÙÙŠ', ja: 'å›ºå®šã¾ã§' })} {formatCountdown(lockState.msToLock)}</div>
                )}
                <div className="mt-2 text-[10px] font-mono text-green-200 opacity-80 border-t border-green-700/50 pt-1">
                  <div>Session UTC: {lockState.targetSessionUtc || 'N/A'}</div>
                  <div>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</div>
                </div>
              </div>
            )}
            {lockState.status === 'closing_soon' && (
              <div className="bg-orange-900/50 border border-orange-600 p-3 rounded text-center animate-pulse">
                <div className="text-orange-400 font-bold">{t({ en: 'Closing Soon', it: 'Chiude Presto', fr: 'Fermeture bientÃ´t', de: 'SchlieÃŸt bald', es: 'Cierra pronto', ru: 'Ð¡ÐºÐ¾Ñ€Ð¾ Ð·Ð°ÐºÑ€Ñ‹Ñ‚Ð¸Ðµ', zh: 'å³å°†å…³é—­', ar: 'ÙŠØºÙ„Ù‚ Ù‚Ø±ÙŠØ¨Ø§', ja: 'ã¾ã‚‚ãªãçµ‚äº†' })}</div>
                {lockState.msToLock !== null && (
                  <div className="text-xs text-orange-200">{t({ en: 'Locks in', it: 'Chiude tra', fr: 'Verrouille dans', de: 'Sperrt in', es: 'Cierra en', ru: 'Ð—Ð°ÐºÑ€Ñ‹Ñ‚Ð¸Ðµ Ñ‡ÐµÑ€ÐµÐ·', zh: 'é”å®šäºŽ', ar: 'ÙŠØºÙ„Ù‚ ÙÙŠ', ja: 'å›ºå®šã¾ã§' })} {formatCountdown(lockState.msToLock)}</div>
                )}
                <div className="mt-2 text-[10px] font-mono text-orange-200 opacity-80 border-t border-orange-700/50 pt-1">
                  <div>Session UTC: {lockState.targetSessionUtc || 'N/A'}</div>
                  <div>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</div>
                </div>
              </div>
            )}
            {lockState.status === 'locked' && (
              <div className="bg-red-900/50 border border-red-600 p-3 rounded text-center">
                <div className="text-red-400 font-bold">{t({ en: 'Lineup locked.', it: 'Formazione bloccata.', fr: 'Alignement verrouillÃ©.', de: 'Lineup gesperrt.', es: 'AlineaciÃ³n bloqueada.', ru: 'Ð¡Ð¾ÑÑ‚Ð°Ð² Ð·Ð°Ð±Ð»Ð¾ÐºÐ¸Ñ€Ð¾Ð²Ð°Ð½.', zh: 'é˜µå®¹å·²é”å®šã€‚', ar: 'ØªÙ… Ù‚ÙÙ„ Ø§Ù„ØªØ´ÙƒÙŠÙ„.', ja: 'ãƒ©ã‚¤ãƒ³ãƒŠãƒƒãƒ—å›ºå®šæ¸ˆã¿ã€‚' })}</div>
                <div className="text-xs text-red-200">
                  {currentRace.isSprint
                    ? t({ en: 'Sprint Qualifying is about to start.', it: 'La Sprint Shootout sta per iniziare.', fr: 'Qualification Sprint commence.', de: 'Sprint-Quali beginnt.', es: 'Sprint Quali va a comenzar.', ru: 'Ð¡Ð¿Ñ€Ð¸Ð½Ñ‚-ÐºÐ²Ð°Ð»Ð¸Ñ„Ð¸ÐºÐ°Ñ†Ð¸Ñ Ð½Ð°Ñ‡Ð¸Ð½Ð°ÐµÑ‚ÑÑ.', zh: 'å†²åˆºæŽ’ä½å³å°†å¼€å§‹ã€‚', ar: 'ØªØµÙÙŠØ§Øª Ø§Ù„Ø³Ø±Ø¹Ø© Ø³ØªØ¨Ø¯Ø£ Ù‚Ø±ÙŠØ¨Ø§.', ja: 'ã‚¹ãƒ—ãƒªãƒ³ãƒˆäºˆé¸é–‹å§‹ã€‚' })
                    : t({ en: 'Qualifying is about to start.', it: 'Le qualifiche stanno per iniziare.', fr: 'Les qualifications vont commencer.', de: 'Qualifying beginnt bald.', es: 'La clasificaciÃ³n estÃ¡ por comenzar.', ru: 'ÐšÐ²Ð°Ð»Ð¸Ñ„Ð¸ÐºÐ°Ñ†Ð¸Ñ Ð½Ð°Ñ‡Ð¸Ð½Ð°ÐµÑ‚ÑÑ.', zh: 'æŽ’ä½èµ›å³å°†å¼€å§‹ã€‚', ar: 'Ø§Ù„ØªØµÙÙŠØ§Øª Ø³ØªØ¨Ø¯Ø£ Ù‚Ø±ÙŠØ¨Ø§.', ja: 'äºˆé¸ãŒå§‹ã¾ã‚Šã¾ã™ã€‚' })}
                </div>
                <div className="mt-2 text-[10px] font-mono text-red-200 opacity-80 border-t border-red-700/50 pt-1">
                  <div>{t({ en: 'Lock only affects Captain/Reserve selection.', it: 'Il blocco riguarda solo Capitano/Riserva.' })}</div>
                  <div className="text-yellow-200 mt-1">{t({ en: 'Market is still OPEN.', it: 'Il Mercato Ã¨ ancora APERTO.' })}</div>
                </div>
              </div>
            )}

            <h1 className="text-2xl font-bold text-white">{t({ en: 'Race Lineup', it: 'Formazione Gara', fr: 'Alignement course', de: 'Renn-Lineup', es: 'AlineaciÃ³n Carrera', ru: 'Ð¡Ð¾ÑÑ‚Ð°Ð² Ð½Ð° Ð³Ð¾Ð½ÐºÑƒ', zh: 'æ­£èµ›é˜µå®¹', ar: 'ØªØ´ÙƒÙŠÙ„ Ø§Ù„Ø³Ø¨Ø§Ù‚', ja: 'ãƒ¬ãƒ¼ã‚¹ãƒ©ã‚¤ãƒ³ãƒŠãƒƒãƒ—' })}</h1>

            {data.team.driverIds.length < 5 ? (
              <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg text-center text-slate-500">
                {t({ en: 'Pick 5 drivers in Market to unlock Lineup.', it: 'Scegli 5 piloti nel Mercato per sbloccare la formazione.', fr: 'Choisissez 5 pilotes pour dÃ©bloquer.', de: 'WÃ¤hle 5 Fahrer im Markt.', es: 'Elige 5 pilotos para desbloquear.', ru: 'Ð’Ñ‹Ð±ÐµÑ€Ð¸Ñ‚Ðµ 5 Ð¿Ð¸Ð»Ð¾Ñ‚Ð¾Ð².', zh: 'åœ¨å¸‚åœºé€‰æ‹©5åè½¦æ‰‹è§£é”ã€‚', ar: 'Ø§Ø®ØªØ± 5 Ø³Ø§Ø¦Ù‚ÙŠÙ† Ù„ÙØªØ­ Ø§Ù„ØªØ´ÙƒÙŠÙ„.', ja: 'ãƒžãƒ¼ã‚±ãƒƒãƒˆã§5äººé¸ã‚“ã§ãã ã•ã„ã€‚' })}
              </div>
            ) : (
              <div className="space-y-2">
                {data.team.driverIds.map(id => {
                  const d = DRIVERS.find(drv => drv.id === id);
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
              <h2 className="text-xl font-bold text-white">{t({ en: 'Swap Driver', it: 'Scambia Pilota', fr: 'Ã‰changer Pilote', de: 'Fahrer tauschen', es: 'Cambiar Piloto', ru: 'Ð—Ð°Ð¼ÐµÐ½Ð¸Ñ‚ÑŒ Ð¿Ð¸Ð»Ð¾Ñ‚Ð°', zh: 'äº¤æ¢è½¦æ‰‹', ar: 'ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„Ø³Ø§Ø¦Ù‚', ja: 'ãƒ‰ãƒ©ã‚¤ãƒãƒ¼äº¤æ›' })}</h2>
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 mb-4">
                <p className="text-slate-400 text-sm">{t({ en: 'Target', it: 'Obiettivo', fr: 'Cible', de: 'Ziel', es: 'Objetivo', ru: 'Ð¦ÐµÐ»ÑŒ', zh: 'ç›®æ ‡', ar: 'Ø§Ù„Ù‡Ø¯Ù', ja: 'ã‚¿ãƒ¼ã‚²ãƒƒãƒˆ' })}</p>
                <div className="text-xl font-bold text-white">{swapCandidate.name}</div>
                <div className="text-blue-400 font-mono">${swapCandidate.price}M</div>
              </div>

              <h3 className="text-lg text-slate-300">{t({ en: 'Select a driver to release:', it: 'Seleziona un pilota da rilasciare:', fr: 'SÃ©lectionnez un pilote Ã  libÃ©rer :', de: 'WÃ¤hle einen Fahrer zum Freigeben:', es: 'Selecciona un piloto para liberar:', ru: 'Ð’Ð²ÐµÐ´Ð¸Ñ‚Ðµ Ð¿Ð¸Ð»Ð¾Ñ‚Ð° Ð´Ð»Ñ Ð·Ð°Ð¼ÐµÐ½Ñ‹:', zh: 'é€‰æ‹©è¦é‡Šæ”¾çš„è½¦æ‰‹ï¼š', ar: 'Ø§Ø®ØªØ± Ø³Ø§Ø¦Ù‚Ø§Ù‹ Ù„Ù„Ø§Ø³ØªØ¨Ø¯Ø§Ù„:', ja: 'æ”¾å‡ºã™ã‚‹ãƒ‰ãƒ©ã‚¤ãƒãƒ¼ã‚’é¸æŠž:' })}</h3>
              <div className="space-y-2">
                {data.team.driverIds.map(id => {
                  const d = DRIVERS.find(drv => drv.id === id);
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
                        <div className="text-xs text-slate-400">{t({ en: 'Sell for', it: 'Vendi per', fr: 'Vendre pour', de: 'Verkaufen fÃ¼r', es: 'Vender por', ru: 'ÐŸÑ€Ð¾Ð´Ð°Ñ‚ÑŒ Ð·Ð°', zh: 'å‡ºå”®ä»·æ ¼', ar: 'Ø¨ÙŠØ¹ Ø¨Ù€', ja: 'å£²å´é¡' })} ${d.price}M</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono ${canAfford ? 'text-green-400' : 'text-red-400'}`}>
                          {t({ en: 'New Budget', it: 'Nuovo Budget', fr: 'Nouveau Budget', de: 'Neues Budget', es: 'Nuevo Presupuesto', ru: 'ÐÐ¾Ð²Ñ‹Ð¹ Ð±ÑŽÐ´Ð¶ÐµÑ‚', zh: 'æ–°é¢„ç®—', ar: 'Ø§Ù„Ù…ÙŠØ²Ø§Ù†ÙŠØ© Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©', ja: 'æ–°äºˆç®—' })}: ${diff.toFixed(1)}M
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
                {t({ en: 'Cancel Swap', it: 'Annulla Scambio', fr: "Annuler l'Ã©change", de: 'Tausch abbrechen', es: 'Cancelar Cambio', ru: 'ÐžÑ‚Ð¼ÐµÐ½Ð¸Ñ‚ÑŒ Ð¾Ð±Ð¼ÐµÐ½', zh: 'å–æ¶ˆäº¤æ¢', ar: 'Ø¥Ù„ØºØ§Ø¡ Ø§Ù„ØªØ¨Ø¯ÙŠÙ„', ja: 'äº¤æ›ã‚­ãƒ£ãƒ³ã‚»ãƒ«' })}
              </button>
            </div>
          );
        }

        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-slate-800 p-3 rounded-lg sticky top-0 z-10 shadow-lg border-b border-slate-700">
              <div>
                <div className="text-xs text-slate-400 uppercase">{t({ en: 'Budget', it: 'Budget', fr: 'Budget', de: 'Budget', es: 'Presupuesto', ru: 'Ð‘ÑŽÐ´Ð¶ÐµÑ‚', zh: 'é¢„ç®—', ar: 'Ø§Ù„Ù…ÙŠØ²Ø§Ù†ÙŠØ©', ja: 'äºˆç®—' })}</div>
                <div className="text-xl font-mono text-white">${data.team.budget.toFixed(1)}M</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase text-right">{t({ en: 'Team', it: 'Team', fr: 'Ã‰quipe', de: 'Team', es: 'Equipo', ru: 'ÐšÐ¾Ð¼Ð°Ð½Ð´Ð°', zh: 'è½¦é˜Ÿ', ar: 'Ø§Ù„ÙØ±ÙŠÙ‚', ja: 'ãƒãƒ¼ãƒ ' })}</div>
                <div className="text-xl font-mono text-white text-right">{data.team.driverIds.length}/5</div>
              </div>
            </div>

            <div className="space-y-2">
              {DRIVERS.map(driver => {
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
                          {t({ en: 'Owned', it: 'Posseduto', fr: 'PossÃ©dÃ©', de: 'Im Besitz', es: 'En propiedad', ru: 'ÐšÑƒÐ¿Ð»ÐµÐ½', zh: 'å·²æ‹¥æœ‰', ar: 'Ù…Ù…Ù„ÙˆÙƒ', ja: 'æ‰€æœ‰ä¸­' })}
                        </button>
                      ) : isTeamFull ? (
                        <button
                          onClick={() => setSwapCandidate(driver)}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-bold uppercase tracking-wider transition-colors"
                        >
                          {t({ en: 'Swap', it: 'Scambia', fr: 'Ã‰changer', de: 'Tauschen', es: 'Cambiar', ru: 'ÐžÐ±Ð¼ÐµÐ½', zh: 'äº¤æ¢', ar: 'ØªØ¨Ø¯ÙŠÙ„', ja: 'äº¤æ›' })}
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
                          {t({ en: 'Add', it: 'Aggiungi', fr: 'Ajouter', de: 'HinzufÃ¼gen', es: 'AÃ±adir', ru: 'Ð”Ð¾Ð±Ð°Ð²Ð¸Ñ‚ÑŒ', zh: 'æ·»åŠ ', ar: 'Ø¥Ø¶Ø§ÙØ©', ja: 'è¿½åŠ ' })}
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
            <h1 className="text-2xl font-bold text-white">{t({ en: 'Admin Controls', it: 'Controlli Admin', fr: 'ContrÃ´les Admin', de: 'Admin-Steuerung', es: 'Controles Admin', ru: 'Ð£Ð¿Ñ€Ð°Ð²Ð»ÐµÐ½Ð¸Ðµ', zh: 'ç®¡ç†å‘˜æŽ§åˆ¶', ar: 'ØªØ­ÙƒÙ… Ø§Ù„Ù…Ø³Ø¤ÙˆÙ„', ja: 'ç®¡ç†è¨­å®š' })}</h1>

            {/* Race Config Card */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <h3 className="font-semibold text-white mb-2">{t({ en: 'Race Time Config', it: 'Config Orari Gara', fr: 'Config heures course', de: 'Rennzeit-Konfig', es: 'Config Horas Carrera', ru: 'ÐšÐ¾Ð½Ñ„Ð¸Ð³ Ð²Ñ€ÐµÐ¼ÐµÐ½Ð¸ Ð³Ð¾Ð½ÐºÐ¸', zh: 'èµ›æ—¶é…ç½®', ar: 'ØªÙƒÙˆÙŠÙ† ÙˆÙ‚Øª Ø§Ù„Ø³Ø¨Ø§Ù‚', ja: 'ãƒ¬ãƒ¼ã‚¹æ™‚é–“è¨­å®š' })}</h3>
              {/* Navigation */}
              <div className="flex justify-between items-center mb-4">
                <button
                  onClick={() => setData({ ...data, currentRaceIndex: Math.max(0, data.currentRaceIndex - 1) })}
                  disabled={data.currentRaceIndex === 0}
                  className="p-2 bg-slate-700 rounded disabled:opacity-50 text-slate-200"
                >{t({ en: 'Prev', it: 'Prec', fr: 'PrÃ©c', de: 'ZurÃ¼ck', es: 'Ant', ru: 'ÐŸÑ€ÐµÐ´', zh: 'ä¸Šä¸€ä¸ª', ar: 'Ø§Ù„Ø³Ø§Ø¨Ù‚', ja: 'å‰ã¸' })}</button>
                <div className="text-center">
                  <div className="text-xs text-slate-400">{t({ en: 'Index', it: 'Indice', fr: 'Indice', de: 'Index', es: 'Ãndice', ru: 'Ð˜Ð½Ð´ÐµÐºÑ', zh: 'ç´¢å¼•', ar: 'ÙÙ‡Ø±Ø³', ja: 'ã‚¤ãƒ³ãƒ‡ãƒƒã‚¯ã‚¹' })} {data.currentRaceIndex}</div>
                  <div className="font-bold text-white text-sm">{currentRace.name}</div>
                </div>
                <button
                  onClick={() => setData({ ...data, currentRaceIndex: Math.min(races.length - 1, data.currentRaceIndex + 1) })}
                  disabled={data.currentRaceIndex === races.length - 1}
                  className="p-2 bg-slate-700 rounded disabled:opacity-50 text-slate-200"
                >{t({ en: 'Next', it: 'Succ', fr: 'Suiv', de: 'Weiter', es: 'Sig', ru: 'Ð¡Ð»ÐµÐ´', zh: 'ä¸‹ä¸€ä¸ª', ar: 'Ø§Ù„ØªØ§Ù„ÙŠ', ja: 'æ¬¡ã¸' })}</button>
              </div>

              {/* Inputs */}
              <div className="space-y-3">
                <div className={`p-2 rounded-lg border ${!currentRace.isSprint ? 'border-yellow-500 bg-yellow-900/20' : 'border-transparent'}`}>
                  <div className="flex justify-between">
                    <label className="block text-xs text-slate-400 mb-1">{t({ en: 'Qualifying UTC (ISO)', it: 'Qualifiche UTC (ISO)', fr: 'Qualif UTC (ISO)', de: 'Quali UTC (ISO)', es: 'Clasif UTC (ISO)', ru: 'ÐšÐ²Ð°Ð»Ð¸Ñ„ UTC', zh: 'æŽ’ä½èµ› UTC', ar: 'Ø§Ù„ØªØµÙÙŠØ§Øª UTC', ja: 'äºˆé¸ UTC' })}</label>
                    {!currentRace.isSprint && <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">{t({ en: 'SETS LOCK', it: 'LOCK ATTIVO', fr: 'VERROUILLE', de: 'SETZT LOCK', es: 'FIJA LOCK', ru: 'Ð‘Ð›ÐžÐšÐ˜Ð Ð£Ð•Ð¢', zh: 'è®¾ç½®é”å®š', ar: 'Ù‚ÙÙ„ Ù†Ø´Ø·', ja: 'ãƒ­ãƒƒã‚¯è¨­å®š' })}</span>}
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
                      {t({ en: 'SAVE', it: 'SALVA', fr: 'SAUVER', de: 'SPEICHERN', es: 'GUARDAR', ru: 'Ð¡ÐžÐ¥Ð ', zh: 'ä¿å­˜', ar: 'Ø­ÙØ¸', ja: 'ä¿å­˜' })}
                    </button>
                  </div>
                </div>

                {currentRace.isSprint && (
                  <div className={`p-2 rounded-lg border ${currentRace.isSprint ? 'border-yellow-500 bg-yellow-900/20' : 'border-transparent'}`}>
                    <div className="flex justify-between">
                      <label className="block text-xs text-slate-400 mb-1">{t({ en: 'Sprint Quali UTC (ISO)', it: 'Sprint Quali UTC (ISO)', fr: 'Sprint Qualif UTC', de: 'Sprint Quali UTC', es: 'Sprint Clasif UTC', ru: 'Ð¡Ð¿Ñ€Ð¸Ð½Ñ‚ ÐšÐ²Ð°Ð» UTC', zh: 'å†²åˆºèµ›æŽ’ä½ UTC', ar: 'ØªØµÙÙŠØ§Øª Ø§Ù„Ø³Ø±Ø¹Ø© UTC', ja: 'ã‚¹ãƒ—ãƒªãƒ³ãƒˆäºˆé¸ UTC' })}</label>
                      <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">{t({ en: 'SETS LOCK', it: 'LOCK ATTIVO', fr: 'VERROUILLE', de: 'SETZT LOCK', es: 'FIJA LOCK', ru: 'Ð‘Ð›ÐžÐšÐ˜Ð Ð£Ð•Ð¢', zh: 'è®¾ç½®é”å®š', ar: 'Ù‚ÙÙ„ Ù†Ø´Ø·', ja: 'ãƒ­ãƒƒã‚¯è¨­å®š' })}</span>
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
                        {t({ en: 'SAVE', it: 'SALVA', fr: 'SAUVER', de: 'SPEICHERN', es: 'GUARDAR', ru: 'Ð¡ÐžÐ¥Ð ', zh: 'ä¿å­˜', ar: 'Ø­ÙØ¸', ja: 'ä¿å­˜' })}
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
              <h3 className="font-semibold text-white mb-4 border-b border-slate-700 pb-2">{t({ en: 'Scoring Rules Config', it: 'Config Punteggi', fr: 'Config Points', de: 'Punkte-Konfig', es: 'Config Puntos', ru: 'ÐÐ°ÑÑ‚Ñ€Ð¾Ð¹ÐºÐ° Ð¾Ñ‡ÐºÐ¾Ð²', zh: 'è®¡åˆ†è§„åˆ™', ar: 'ØªÙƒÙˆÙŠÙ† Ø§Ù„Ù†Ù‚Ø§Ø·', ja: 'ã‚¹ã‚³ã‚¢è¨­å®š' })}</h3>
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
                <div><label className="text-xs text-slate-400">{t({ en: 'Q1 Elim (17-22)', it: 'Eliminato Q1 (17-22)', fr: 'Ã‰liminÃ© Q1 (17-22)', de: 'Q1 Ausgeschieden (17.-22.)', es: 'Eliminado Q1 (17-22)' })}</label><input type="number" value={data.rules.qualiQ1Eliminated} onChange={(e) => handleRuleChange('qualiQ1Eliminated', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Grid Penalty', it: 'PenalitÃ  Griglia', fr: 'PÃ©nalitÃ© Grille', de: 'Startplatzstrafe', es: 'PenalizaciÃ³n Parrilla' })}</label><input type="number" value={data.rules.qualiGridPenalty} onChange={(e) => handleRuleChange('qualiGridPenalty', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Race Bonuses */}
                <div><label className="text-xs text-slate-400">{t({ en: 'Last Place Malus', it: 'Malus Ultimo Posto', fr: 'Malus DerniÃ¨re Place', de: 'Malus Letzter Platz', es: 'Malus Ãšltimo Lugar' })}</label><input type="number" value={data.rules.raceLastPlaceMalus} onChange={(e) => handleRuleChange('raceLastPlaceMalus', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'DNF / DNS / DSQ', it: 'Ritirato / Squalificato', fr: 'Abandon / DisqualifiÃ©', de: 'DNF / DNS / DSQ', es: 'Abandono / Descalificado' })}</label><input type="number" value={data.rules.raceDNF} onChange={(e) => handleRuleChange('raceDNF', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Race Penalty', it: 'PenalitÃ  Gara', fr: 'PÃ©nalitÃ© Course', de: 'Rennstrafe', es: 'PenalizaciÃ³n Carrera' })}</label><input type="number" value={data.rules.racePenalty} onChange={(e) => handleRuleChange('racePenalty', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Pos Gained (per pos)', it: 'Pos Guadagnate (per pos)', fr: 'Pos GagnÃ©es (par pos)', de: 'Pos Gewonnen (pro Pos)', es: 'Pos Ganadas (por pos)' })}</label><input type="number" value={data.rules.positionGained} onChange={(e) => handleRuleChange('positionGained', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Pos Lost (per pos)', it: 'Pos Perse (per pos)', fr: 'Pos Perdues (par pos)', de: 'Pos Verloren (pro Pos)', es: 'Pos Perdidas (por pos)' })}</label><input type="number" value={data.rules.positionLost} onChange={(e) => handleRuleChange('positionLost', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Teammate */}
                <div><label className="text-xs text-slate-400">{t({ en: 'Beat Teammate', it: 'Batte Compagno', fr: 'Bat CoÃ©quipier', de: 'Teamkollegen geschlagen', es: 'Vence CompaÃ±ero' })}</label><input type="number" value={data.rules.teammateBeat} onChange={(e) => handleRuleChange('teammateBeat', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Lost to Teammate', it: 'Perde vs Compagno', fr: 'Perd contre CoÃ©quipier', de: 'Verliert gegen Teamk.', es: 'Pierde vs CompaÃ±ero' })}</label><input type="number" value={data.rules.teammateLost} onChange={(e) => handleRuleChange('teammateLost', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>
                <div><label className="text-xs text-slate-400">{t({ en: 'Beat TM (TM DNF)', it: 'Batte Compagno (Ritirato)', fr: 'Bat CoÃ©quipier (Abandon)', de: 'Teamk. geschlagen (DNF)', es: 'Vence Comp. (Abandono)' })}</label><input type="number" value={data.rules.teammateBeatDNF} onChange={(e) => handleRuleChange('teammateBeatDNF', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white" /></div>

                {/* Sprint */}
                <div className="col-span-2 mt-2">
                  <label className="text-xs text-slate-400 block mb-1">{t({ en: 'Sprint Points (1st - 8th)', it: 'Punti Sprint (1Â°-8Â°)', fr: 'Points Sprint (1-8)', de: 'Sprintpunkte (1.-8.)', es: 'Puntos Sprint (1Âº-8Âº)' })}</label>
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
              <h3 className="font-semibold text-white mb-4 border-b border-slate-700 pb-2">{t({ en: 'Constructor Multipliers', it: 'Coefficienti Scuderie', fr: 'Coefficients Ã‰quipes', de: 'Konstrukteurs-Multiplikatoren', es: 'Coeficientes Constructores', ru: 'ÐšÐ¾ÑÑ„Ñ„Ð¸Ñ†Ð¸ÐµÐ½Ñ‚Ñ‹ ÐºÐ¾Ð½ÑÑ‚Ñ€ÑƒÐºÑ‚Ð¾Ñ€Ð¾Ð²', zh: 'è½¦é˜Ÿç³»æ•°', ar: 'Ù…Ø¹Ø§Ù…Ù„Ø§Øª Ø§Ù„ÙØ±Ù‚', ja: 'ã‚³ãƒ³ã‚¹ãƒˆãƒ©ã‚¯ã‚¿ãƒ¼ä¿‚æ•°' })}</h3>
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
              <h3 className="font-semibold text-white mb-2">{t({ en: 'User Profile', it: 'Profilo Utente', fr: 'Profil utilisateur', de: 'Benutzerprofil', es: 'Perfil usuario', ru: 'ÐŸÑ€Ð¾Ñ„Ð¸Ð»ÑŒ', zh: 'ç”¨æˆ·èµ„æ–™', ar: 'Ù…Ù„Ù Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…', ja: 'ãƒ—ãƒ­ãƒ•ã‚£ãƒ¼ãƒ«' })}</h3>
              <div className="mb-4 text-sm text-slate-300">
                <p><span className="text-slate-500">{t({ en: 'Name', it: 'Nome', fr: 'Nom', de: 'Name', es: 'Nombre', ru: 'Ð˜Ð¼Ñ', zh: 'åå­—', ar: 'Ø§Ù„Ø§Ø³Ù…', ja: 'åå‰' })}:</span> {data.user?.name}</p>
                <p><span className="text-slate-500">{t({ en: 'Role', it: 'Ruolo', fr: 'RÃ´le', de: 'Rolle', es: 'Rol', ru: 'Ð Ð¾Ð»ÑŒ', zh: 'è§’è‰²', ar: 'Ø§Ù„Ø¯ÙˆØ±', ja: 'å½¹å‰²' })}:</span> {data.user?.isAdmin ? 'Admin' : 'Member'}</p>
                <p><span className="text-slate-500">{t({ en: 'League Code', it: 'Codice Lega', fr: 'Code Ligue', de: 'Liga-Code', es: 'CÃ³digo Liga', ru: 'ÐšÐ¾Ð´ Ð»Ð¸Ð³Ð¸', zh: 'è”ç›Ÿä»£ç ', ar: 'Ø±Ù…Ø² Ø§Ù„Ø¯ÙˆØ±ÙŠ', ja: 'ãƒªãƒ¼ã‚°ã‚³ãƒ¼ãƒ‰' })}:</span> <span className="font-mono text-blue-400">{data.user?.leagueCode}</span></p>
              </div>

              <div className="flex flex-col gap-3 mt-4">
                <button
                  onClick={handleLogout}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                  {t({ en: 'Logout', it: 'Esci', fr: 'DÃ©connexion', de: 'Abmelden', es: 'Salir', ru: 'Ð’Ñ‹Ð¹Ñ‚Ð¸', zh: 'ç™»å‡º', ar: 'Ø®Ø±ÙˆØ¬', ja: 'ãƒ­ã‚°ã‚¢ã‚¦ãƒˆ' })}
                </button>
                {showResetConfirm ? (
                  <div className="bg-red-950/50 border border-red-500 p-4 rounded-lg animate-pulse">
                    <p className="text-red-200 text-center mb-3 font-bold">{t({ en: 'Delete all local data?', it: 'Eliminare i dati locali?', fr: 'Supprimer donnÃ©es locales?', de: 'Lokale Daten lÃ¶schen?', es: 'Â¿Borrar datos locales?', ru: 'Ð£Ð´Ð°Ð»Ð¸Ñ‚ÑŒ Ð´Ð°Ð½Ð½Ñ‹Ðµ?', zh: 'åˆ é™¤æœ¬åœ°æ•°æ®ï¼Ÿ', ar: 'Ø­Ø°Ù Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ù„ÙŠØ©ØŸ', ja: 'å…¨ãƒ‡ãƒ¼ã‚¿ã‚’å‰Šé™¤ã—ã¾ã™ã‹ï¼Ÿ' })}</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="flex-1 bg-slate-600 text-white py-2 rounded hover:bg-slate-500"
                      >
                        {t({ en: 'Cancel', it: 'Annulla', fr: 'Annuler', de: 'Abbrechen', es: 'Cancelar', ru: 'ÐžÑ‚Ð¼ÐµÐ½Ð°', zh: 'å–æ¶ˆ', ar: 'Ø¥Ù„ØºØ§Ø¡', ja: 'ã‚­ãƒ£ãƒ³ã‚»ãƒ«' })}
                      </button>
                      <button
                        onClick={handleLogout}
                        className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-500"
                      >
                        {t({ en: 'Confirm', it: 'Conferma', fr: 'Confirmer', de: 'BestÃ¤tigen', es: 'Confirmar', ru: 'ÐŸÐ¾Ð´Ñ‚Ð²ÐµÑ€Ð´Ð¸Ñ‚ÑŒ', zh: 'ç¡®è®¤', ar: 'ØªØ£ÙƒÙŠØ¯', ja: 'ç¢ºèª' })}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full bg-red-900/50 hover:bg-red-800/50 text-red-200 font-bold py-2 px-4 rounded transition-colors border border-red-900"
                  >
                    {t({ en: 'Reset All Data (Logout)', it: 'Resetta Dati (Logout)', fr: 'RÃ©initialiser (DÃ©connexion)', de: 'Reset (Abmelden)', es: 'Reiniciar (Salir)', ru: 'Ð¡Ð±Ñ€Ð¾Ñ (Ð’Ñ‹Ñ…Ð¾Ð´)', zh: 'é‡ç½®æ‰€æœ‰æ•°æ®', ar: 'Ø¥Ø¹Ø§Ø¯Ø© ØªØ¹ÙŠÙŠÙ† (Ø®Ø±ÙˆØ¬)', ja: 'ãƒªã‚»ãƒƒãƒˆ (ãƒ­ã‚°ã‚¢ã‚¦ãƒˆ)' })}
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
                {showDebug ? t({ en: 'Hide Debug Info', it: 'Nascondi Debug', fr: 'Masquer Debug', de: 'Debug verbergen', es: 'Ocultar Debug', ru: 'Ð¡ÐºÑ€Ñ‹Ñ‚ÑŒ Ð¾Ñ‚Ð»Ð°Ð´ÐºÑƒ', zh: 'éšè—è°ƒè¯•', ar: 'Ø¥Ø®ÙØ§Ø¡ Ø§Ù„ØªØµØ­ÙŠØ­', ja: 'ãƒ‡ãƒãƒƒã‚°éžè¡¨ç¤º' }) : t({ en: 'Show Debug Info', it: 'Mostra Debug', fr: 'Afficher Debug', de: 'Debug zeigen', es: 'Mostrar Debug', ru: 'ÐŸÐ¾ÐºÐ°Ð·Ð°Ñ‚ÑŒ Ð¾Ñ‚Ð»Ð°Ð´ÐºÑƒ', zh: 'æ˜¾ç¤ºè°ƒè¯•', ar: 'Ø¥Ø¸Ù‡Ø§Ø± Ø§Ù„ØªØµØ­ÙŠØ­', ja: 'ãƒ‡ãƒãƒƒã‚°è¡¨ç¤º' })}
              </button>
            </div>

            {/* Debug Info (Collapsed) */}
            {showDebug && (
              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/50">
                <h3 className="font-semibold text-white mb-2">{t({ en: 'Debug', it: 'Debug', fr: 'Debug', de: 'Debug', es: 'Debug', ru: 'ÐžÑ‚Ð»Ð°Ð´ÐºÐ°', zh: 'è°ƒè¯•', ar: 'ØªØµØ­ÙŠØ­', ja: 'ãƒ‡ãƒãƒƒã‚°' })}</h3>
                <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded mb-4 overflow-x-auto border border-slate-800">
                  {JSON.stringify(data.team, null, 2)}
                </div>

                <h3 className="font-semibold text-white mb-2 mt-4">{t({ en: 'Race Lock Debug', it: 'Debug Blocco Gara', fr: 'Debug Verrouillage', de: 'Renn-Sperre Debug', es: 'Debug Bloqueo', ru: 'ÐžÑ‚Ð»Ð°Ð´ÐºÐ° Ð±Ð»Ð¾ÐºÐ¸Ñ€Ð¾Ð²ÐºÐ¸', zh: 'é”å®šè°ƒè¯•', ar: 'ØªØµØ­ÙŠØ­ Ù‚ÙÙ„ Ø§Ù„Ø³Ø¨Ø§Ù‚', ja: 'ãƒ¬ãƒ¼ã‚¹ãƒ­ãƒƒã‚¯ãƒ‡ãƒãƒƒã‚°' })}</h3>
                <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded mb-4 overflow-x-auto border border-slate-800">
                  <p>Race: {currentRace.name}</p>
                  <p>Status: <span className={getStatusColor(lockState.status)}>{lockState.status}</span></p>
                  <p>Session: {currentRace.isSprint ? t({ en: 'Sprint Qualifying', it: 'Sprint Shootout', fr: 'Qualif Sprint', de: 'Sprint Quali', es: 'Sprint Clasif', ru: 'Ð¡Ð¿Ñ€Ð¸Ð½Ñ‚ ÐšÐ²Ð°Ð»', zh: 'å†²åˆºæŽ’ä½', ar: 'ØªØµÙÙŠØ§Øª Ø§Ù„Ø³Ø±Ø¹Ø©', ja: 'ã‚¹ãƒ—ãƒªãƒ³ãƒˆäºˆé¸' }) : t({ en: 'Qualifying', it: 'Qualifiche', fr: 'Qualifications', de: 'Qualifying', es: 'ClasificaciÃ³n', ru: 'ÐšÐ²Ð°Ð»Ð¸Ñ„Ð¸ÐºÐ°Ñ†Ð¸Ñ', zh: 'æŽ’ä½èµ›', ar: 'ØªØµÙÙŠØ§Øª', ja: 'äºˆé¸' })}</p>
                  <p>Target UTC: {lockState.targetSessionUtc || 'N/A'}</p>
                  <p>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</p>
                  <p>Server Time: {new Date(now).toISOString()}</p>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return <div>Tab not found</div>;
    }
  };

  return (
    <>
      <div className="fixed bottom-3 right-3 z-50 bg-black/60 text-white text-xs px-3 py-2 rounded-lg border border-white/10">
        Races source: {racesSource}
      </div>
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