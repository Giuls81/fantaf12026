import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import { AppData, Tab, UserTeam, Driver, Race, User, ScoringRules } from './types';
import { DEFAULT_SCORING_RULES, RACES_2026, DRIVERS, CONSTRUCTORS } from './constants';

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
  const [language, setLanguage] = useState<LangCode>('en');
  const [showLangMenu, setShowLangMenu] = useState(false);

  // Admin Draft States
  const [qualifyingUtcDraft, setQualifyingUtcDraft] = useState('');
  const [sprintQualifyingUtcDraft, setSprintQualifyingUtcDraft] = useState('');
  
  // Admin Points Anti-NaN States
  const [sprintPointsInput, setSprintPointsInput] = useState('');
  const [pointsError, setPointsError] = useState<{sprint?: string}>({});

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

  // Load races from localStorage
  useEffect(() => {
    const storedRaces = localStorage.getItem('fantaF1Races');
    if (storedRaces) {
      try {
        setRaces(JSON.parse(storedRaces));
      } catch (e) {
        console.error("Failed to parse local races", e);
      }
    }
  }, []);

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
        if (!parsed.schemaVersion) {
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

  // Save races to localStorage
  useEffect(() => {
    localStorage.setItem('fantaF1Races', JSON.stringify(races));
  }, [races]);

  // Redirect non-admins if they try to access Admin tab
  useEffect(() => {
    if (data?.user && !data.user.isAdmin && activeTab === Tab.ADMIN) {
        setActiveTab(Tab.HOME);
    }
  }, [activeTab, data]);

  // Translation Helper
  const t = (dict: { [key: string]: string }) => {
    return dict[language] || dict['en'] || '';
  };

  const handleLogin = () => {
    if (!username.trim()) return alert(t({en:"Please enter a username.", it:"Inserisci un nome utente."}));

    let newUser: User;
    
    if (loginMode === 'create') {
        if (!leagueName.trim()) return alert(t({en:"Please enter a league name.", it:"Inserisci il nome della lega."}));
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
        if (!leagueCodeInput.trim() || leagueCodeInput.length < 6) return alert(t({en:"Please enter a valid 6-character league code.", it:"Inserisci un codice lega valido di 6 caratteri."}));
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
        alert(t({en:"Insufficient budget!", it:"Budget insufficiente!"}));
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
        alert(t({en:"Insufficient budget for this swap.", it:"Budget insufficiente per questo scambio."}));
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
      const parts = input.split(',').map(s => Number(s.trim()));
      
      if (parts.length !== 8 || parts.some(n => isNaN(n))) {
          setPointsError(prev => ({...prev, sprint: t({en:'Must be 8 numbers separated by commas', it:'Devono essere 8 numeri separati da virgole'})}));
      } else {
          setPointsError(prev => ({...prev, sprint: undefined}));
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
                        {t({en:'Create League', it:'Crea Lega', fr:'Créer ligue', de:'Liga erstellen', es:'Crear liga', ru:'Создать лигу', zh:'创建联盟', ar:'إنشاء دوري', ja:'リーグ作成'})}
                    </button>
                    <button 
                        onClick={() => setLoginMode('join')}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors ${loginMode === 'join' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        {t({en:'Join League', it:'Unisciti', fr:'Rejoindre', de:'Beitreten', es:'Unirse', ru:'Войти', zh:'加入联盟', ar:'انضمام', ja:'参加'})}
                    </button>
                </div>

                {/* Common Input */}
                <div className="mb-4">
                    <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({en:'Username', it:'Nome Utente', fr:"Nom d'utilisateur", de:'Benutzername', es:'Usuario', ru:'Имя пользователя', zh:'用户名', ar:'اسم المستخدم', ja:'ユーザー名'})}</label>
                    <input 
                        type="text" 
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={t({en:'Enter your name', it:'Inserisci nome', fr:'Entrez votre nom', de:'Name eingeben', es:'Ingresa tu nombre', ru:'Введите имя', zh:'输入名字', ar:'أدخل اسمك', ja:'名前を入力'})}
                        className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
                    />
                </div>

                {/* Create Fields */}
                {loginMode === 'create' && (
                    <div className="mb-6">
                        <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({en:'League Name', it:'Nome Lega', fr:'Nom de la ligue', de:'Liganame', es:'Nombre Liga', ru:'Название лиги', zh:'联盟名称', ar:'اسم الدوري', ja:'リーグ名'})}</label>
                        <input 
                            type="text" 
                            value={leagueName}
                            onChange={(e) => setLeagueName(e.target.value)}
                            placeholder={t({en:'e.g. Sunday Racing Club', it:'es. Racing Club', fr:'ex. Racing Club', de:'z.B. Racing Club', es:'ej. Racing Club', ru:'напр. Клуб', zh:'例如：周日赛车', ar:'مثال: نادي السباق', ja:'例: レーシングクラブ'})}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                )}

                {/* Join Fields */}
                {loginMode === 'join' && (
                    <div className="mb-6">
                        <label className="block text-xs uppercase text-slate-400 font-bold mb-1">{t({en:'League Code', it:'Codice Lega', fr:'Code Ligue', de:'Liga-Code', es:'Código Liga', ru:'Код лиги', zh:'联盟代码', ar:'رمز الدوري', ja:'リーグコード'})}</label>
                        <input 
                            type="text" 
                            value={leagueCodeInput}
                            onChange={(e) => setLeagueCodeInput(e.target.value.toUpperCase())}
                            placeholder={t({en:'6-Digit Code', it:'Codice 6 cifre', fr:'Code 6 chiffres', de:'6-stelliger Code', es:'Código 6 dígitos', ru:'6 цифр', zh:'6位代码', ar:'رمز من 6 أرقام', ja:'6桁コード'})}
                            maxLength={6}
                            className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest uppercase"
                        />
                    </div>
                )}

                <button 
                    onClick={handleLogin}
                    className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-3 px-4 rounded transition-all shadow-lg transform hover:scale-[1.02]"
                >
                    {loginMode === 'create' ? t({en:'Start Season', it:'Inizia Stagione', fr:'Démarrer saison', de:'Saison starten', es:'Iniciar temporada', ru:'Начать сезон', zh:'开始赛季', ar:'بدء الموسم', ja:'シーズン開始'}) : t({en:'Join Season', it:'Unisciti', fr:'Rejoindre saison', de:'Beitreten', es:'Unirse', ru:'Присоединиться', zh:'加入赛季', ar:'انضمام للموسم', ja:'シーズン参加'})}
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
    switch(s) {
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
              <h1 className="text-2xl font-bold text-white">{t({en:'Welcome', it:'Benvenuto', fr:'Bienvenue', de:'Willkommen', es:'Bienvenido', ru:'Добро пожаловать', zh:'欢迎', ar:'مرحباً', ja:'ようこそ'})}, {data.user?.name}</h1>
              <p className="text-slate-400">
                  {data.user?.isAdmin ? `${t({en:'Admin of', it:'Admin di', fr:'Admin de', de:'Admin von', es:'Admin de', ru:'Админ', zh:'管理员', ar:'مسؤول عن', ja:'管理者'})} ${data.user.leagueName}` : t({en:'Member', it:'Membro', fr:'Membre', de:'Mitglied', es:'Miembro', ru:'Участник', zh:'成员', ar:'عضو', ja:'メンバー'})}
              </p>
              {data.user?.isAdmin && (
                  <div className="mt-2 inline-block bg-blue-900/50 border border-blue-500/30 rounded px-3 py-1">
                      <span className="text-slate-400 text-xs mr-2">{t({en:'LEAGUE CODE', it:'CODICE LEGA', fr:'CODE LIGUE', de:'LIGA-CODE', es:'CÓDIGO LIGA', ru:'КОД ЛИГИ', zh:'联盟代码', ar:'رمز الدوري', ja:'リーグコード'})}:</span>
                      <span className="font-mono font-bold text-blue-300">{data.user.leagueCode}</span>
                  </div>
              )}
            </header>
            
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
               <h2 className="text-lg font-semibold text-blue-400 mb-2">{t({en:'Selected Race', it:'Gara Selezionata', fr:'Course sélectionnée', de:'Ausgewähltes Rennen', es:'Carrera seleccionada', ru:'Выбранная гонка', zh:'已选赛事', ar:'السباق المحدد', ja:'選択されたレース'})}</h2>
               <div className="text-3xl font-bold text-white">{currentRace.name}</div>
               <div className="text-slate-400 mt-1">{currentRace.date}</div>
               {lockState.status !== 'unconfigured' && (
                   <div className="mt-3 bg-slate-900/50 p-2 rounded text-center border border-slate-600">
                       <span className="text-xs text-slate-400 uppercase mr-2">{t({en:'Lineup Locks In', it:'Chiude tra', fr:'Verrouillage dans', de:'Sperrt in', es:'Cierra en', ru:'Закрытие через', zh:'阵容锁定于', ar:'يغلق التشكيل في', ja:'ラインナップ固定まで'})}</span>
                       <span className={`font-mono font-bold ${lockState.status === 'locked' ? 'text-red-400' : 'text-green-400'}`}>
                           {lockState.status === 'locked' ? 'LOCKED' : formatCountdown(lockState.msToLock || 0)}
                       </span>
                   </div>
               )}
            </div>

            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
               <h2 className="text-lg font-semibold text-green-400 mb-2">{t({en:'Team Status', it:'Stato Team', fr:'Statut équipe', de:'Teamstatus', es:'Estado Equipo', ru:'Статус команды', zh:'车队状态', ar:'حالة الفريق', ja:'チーム状況'})}</h2>
               <div className="flex justify-between items-center mb-2">
                 <span className="text-slate-300">{t({en:'Budget', it:'Budget', fr:'Budget', de:'Budget', es:'Presupuesto', ru:'Бюджет', zh:'预算', ar:'الميزانية', ja:'予算'})}</span>
                 <span className="font-mono text-white text-lg">${data.team.budget.toFixed(1)}M</span>
               </div>
               <div className="flex justify-between items-center">
                 <span className="text-slate-300">{t({en:'Drivers Signed', it:'Piloti', fr:'Pilotes', de:'Fahrer', es:'Pilotos', ru:'Пилоты', zh:'车手', ar:'السائقين', ja:'契約ドライバー'})}</span>
                 <span className="font-mono text-white text-lg">{data.team.driverIds.length}/5</span>
               </div>
            </div>
          </div>
        );
      case Tab.TEAM:
        return (
          <div className="space-y-4">
             <h1 className="text-2xl font-bold text-white mb-4">{t({en:'My Team', it:'Il Mio Team', fr:'Mon Équipe', de:'Mein Team', es:'Mi Equipo', ru:'Моя Команда', zh:'我的车队', ar:'فريقي', ja:'マイチーム'})}</h1>
             <div className="p-4 bg-slate-800 rounded-lg text-center border border-slate-700">
                <p className="text-slate-400 mb-2">{t({en:'Team Name', it:'Nome Team', fr:"Nom de l'équipe", de:'Teamname', es:'Nombre del Equipo', ru:'Название команды', zh:'车队名称', ar:'اسم الفريق', ja:'チーム名'})}</p>
                <h2 className="text-xl font-bold text-white">{data.team.name}</h2>
             </div>
             
             <div className="space-y-2">
                <h3 className="text-lg font-semibold text-slate-200">{t({en:'Roster', it:'Rosa', fr:'Effectif', de:'Kader', es:'Plantilla', ru:'Состав', zh:'阵容', ar:'القائمة', ja:'ロースター'})}</h3>
                {data.team.driverIds.length === 0 ? (
                    <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg text-center text-slate-500">
                        {t({en:'No drivers selected yet. Go to Market.', it:'Nessun pilota selezionato. Vai al Mercato.', fr:'Aucun pilote sélectionné. Allez au Marché.', de:'Noch keine Fahrer ausgewählt. Zum Markt gehen.', es:'Sin pilotos seleccionados. Ir al Mercado.', ru:'Пилоты не выбраны. Перейдите на рынок.', zh:'尚未选择车手。前往市场。', ar:'لم يتم اختيار سائقين بعد. اذهب إلى السوق.', ja:'ドライバー未選択。マーケットへ。'})}
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {data.team.driverIds.map(id => {
                            const d = DRIVERS.find(drv => drv.id === id);
                            const c = activeConstructors.find(con => con.id === d?.constructorId);
                            return (
                                <li key={id} className="bg-slate-800 p-3 rounded flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1 h-8 rounded-full" style={{ backgroundColor: c?.color || '#555'}}></div>
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
                        <div className="text-yellow-400 font-bold">{t({en:'Config Missing', it:'Config Mancante', fr:'Config manquante', de:'Konfig fehlt', es:'Falta config', ru:'Нет конфига', zh:'缺少配置', ar:'التكوين مفقود', ja:'設定不足'})}</div>
                        <div className="text-xs text-yellow-200">{t({en:'Admin: Set UTC times.', it:'Admin: Imposta orari UTC.', fr:'Admin: Définir heures UTC.', de:'Admin: UTC-Zeiten setzen.', es:'Admin: Fijar horas UTC.', ru:'Админ: Уст. UTC.', zh:'管理员：设置UTC时间。', ar:'المسؤول: تعيين توقيت UTC.', ja:'管理者: UTC設定'})}</div>
                    </div>
                )}
                {lockState.status === 'open' && (
                    <div className="bg-green-900/50 border border-green-600 p-3 rounded text-center">
                        <div className="text-green-400 font-bold">{t({en:'Lineup Open', it:'Formazione Aperta', fr:'Alignement ouvert', de:'Lineup offen', es:'Alineación abierta', ru:'Состав открыт', zh:'阵容开放', ar:'التشكيل مفتوح', ja:'ラインナップ変更可'})}</div>
                        {lockState.msToLock !== null && (
                             <div className="text-xs text-green-200">{t({en:'Locks in', it:'Chiude tra', fr:'Verrouille dans', de:'Sperrt in', es:'Cierra en', ru:'Закрытие через', zh:'锁定于', ar:'يغلق في', ja:'固定まで'})} {formatCountdown(lockState.msToLock)}</div>
                        )}
                        <div className="mt-2 text-[10px] font-mono text-green-200 opacity-80 border-t border-green-700/50 pt-1">
                            <div>Session UTC: {lockState.targetSessionUtc || 'N/A'}</div>
                            <div>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</div>
                        </div>
                    </div>
                )}
                {lockState.status === 'closing_soon' && (
                    <div className="bg-orange-900/50 border border-orange-600 p-3 rounded text-center animate-pulse">
                        <div className="text-orange-400 font-bold">{t({en:'Closing Soon', it:'Chiude Presto', fr:'Fermeture bientôt', de:'Schließt bald', es:'Cierra pronto', ru:'Скоро закрытие', zh:'即将关闭', ar:'يغلق قريبا', ja:'まもなく終了'})}</div>
                        {lockState.msToLock !== null && (
                            <div className="text-xs text-orange-200">{t({en:'Locks in', it:'Chiude tra', fr:'Verrouille dans', de:'Sperrt in', es:'Cierra en', ru:'Закрытие через', zh:'锁定于', ar:'يغلق في', ja:'固定まで'})} {formatCountdown(lockState.msToLock)}</div>
                        )}
                        <div className="mt-2 text-[10px] font-mono text-orange-200 opacity-80 border-t border-orange-700/50 pt-1">
                            <div>Session UTC: {lockState.targetSessionUtc || 'N/A'}</div>
                            <div>Lock UTC: {lockState.lockTimeUtc || 'N/A'}</div>
                        </div>
                    </div>
                )}
                {lockState.status === 'locked' && (
                    <div className="bg-red-900/50 border border-red-600 p-3 rounded text-center">
                        <div className="text-red-400 font-bold">{t({en:'Lineup locked.', it:'Formazione bloccata.', fr:'Alignement verrouillé.', de:'Lineup gesperrt.', es:'Alineación bloqueada.', ru:'Состав заблокирован.', zh:'阵容已锁定。', ar:'تم قفل التشكيل.', ja:'ラインナップ固定済み。'})}</div>
                        <div className="text-xs text-red-200">
                            {currentRace.isSprint 
                                ? t({en:'Sprint Qualifying is about to start.', it:'La Sprint Shootout sta per iniziare.', fr:'Qualification Sprint commence.', de:'Sprint-Quali beginnt.', es:'Sprint Quali va a comenzar.', ru:'Спринт-квалификация начинается.', zh:'冲刺排位即将开始。', ar:'تصفيات السرعة ستبدأ قريبا.', ja:'スプリント予選開始。'}) 
                                : t({en:'Qualifying is about to start.', it:'Le qualifiche stanno per iniziare.', fr:'Les qualifications vont commencer.', de:'Qualifying beginnt bald.', es:'La clasificación está por comenzar.', ru:'Квалификация начинается.', zh:'排位赛即将开始。', ar:'التصفيات ستبدأ قريبا.', ja:'予選が始まります。'})}
                        </div>
                        <div className="mt-2 text-[10px] font-mono text-red-200 opacity-80 border-t border-red-700/50 pt-1">
                            <div>{t({en:'Lock only affects Captain/Reserve selection.', it:'Il blocco riguarda solo Capitano/Riserva.'})}</div>
                        </div>
                    </div>
                )}

                <h1 className="text-2xl font-bold text-white">{t({en:'Race Lineup', it:'Formazione Gara', fr:'Alignement course', de:'Renn-Lineup', es:'Alineación Carrera', ru:'Состав на гонку', zh:'正赛阵容', ar:'تشكيل السباق', ja:'レースラインナップ'})}</h1>
                
                {data.team.driverIds.length < 5 ? (
                    <div className="p-8 border-2 border-dashed border-slate-700 rounded-lg text-center text-slate-500">
                        {t({en:'Pick 5 drivers in Market to unlock Lineup.', it:'Scegli 5 piloti nel Mercato per sbloccare la formazione.', fr:'Choisissez 5 pilotes pour débloquer.', de:'Wähle 5 Fahrer im Markt.', es:'Elige 5 pilotos para desbloquear.', ru:'Выберите 5 пилотов.', zh:'在市场选择5名车手解锁。', ar:'اختر 5 سائقين لفتح التشكيل.', ja:'マーケットで5人選んでください。'})}
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
                                        <div className="w-1 h-8 rounded-full" style={{ backgroundColor: c?.color || '#555'}}></div>
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
                                            className={`px-3 py-1 text-xs rounded font-bold uppercase ${
                                                isCaptain 
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
                                            className={`px-3 py-1 text-xs rounded font-bold uppercase ${
                                                isReserve 
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
                    <h2 className="text-xl font-bold text-white">{t({en:'Swap Driver', it:'Scambia Pilota', fr:'Échanger Pilote', de:'Fahrer tauschen', es:'Cambiar Piloto', ru:'Заменить пилота', zh:'交换车手', ar:'تبديل السائق', ja:'ドライバー交換'})}</h2>
                    <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 mb-4">
                        <p className="text-slate-400 text-sm">{t({en:'Target', it:'Obiettivo', fr:'Cible', de:'Ziel', es:'Objetivo', ru:'Цель', zh:'目标', ar:'الهدف', ja:'ターゲット'})}</p>
                        <div className="text-xl font-bold text-white">{swapCandidate.name}</div>
                        <div className="text-blue-400 font-mono">${swapCandidate.price}M</div>
                    </div>
                    
                    <h3 className="text-lg text-slate-300">{t({en:'Select a driver to release:', it:'Seleziona un pilota da rilasciare:', fr:'Sélectionnez un pilote à libérer :', de:'Wähle einen Fahrer zum Freigeben:', es:'Selecciona un piloto para liberar:', ru:'Выберите пилота для замены:', zh:'选择要释放的车手：', ar:'اختر سائقاً للاستبدال:', ja:'放出するドライバーを選択:'})}</h3>
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
                                    className={`w-full p-3 rounded flex justify-between items-center border ${
                                        canAfford 
                                        ? 'bg-slate-800 border-slate-600 hover:bg-slate-700' 
                                        : 'bg-slate-800 border-red-900 opacity-50 cursor-not-allowed'
                                    }`}
                                >
                                    <div className="text-left">
                                        <div className="text-white font-medium">{d.name}</div>
                                        <div className="text-xs text-slate-400">{t({en:'Sell for', it:'Vendi per', fr:'Vendre pour', de:'Verkaufen für', es:'Vender por', ru:'Продать за', zh:'出售价格', ar:'بيع بـ', ja:'売却額'})} ${d.price}M</div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`font-mono ${canAfford ? 'text-green-400' : 'text-red-400'}`}>
                                            {t({en:'New Budget', it:'Nuovo Budget', fr:'Nouveau Budget', de:'Neues Budget', es:'Nuevo Presupuesto', ru:'Новый бюджет', zh:'新预算', ar:'الميزانية الجديدة', ja:'新予算'})}: ${diff.toFixed(1)}M
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
                        {t({en:'Cancel Swap', it:'Annulla Scambio', fr:"Annuler l'échange", de:'Tausch abbrechen', es:'Cancelar Cambio', ru:'Отменить обмен', zh:'取消交换', ar:'إلغاء التبديل', ja:'交換キャンセル'})}
                    </button>
                </div>
            );
        }

        return (
            <div className="space-y-4">
                <div className="flex justify-between items-center bg-slate-800 p-3 rounded-lg sticky top-0 z-10 shadow-lg border-b border-slate-700">
                    <div>
                        <div className="text-xs text-slate-400 uppercase">{t({en:'Budget', it:'Budget', fr:'Budget', de:'Budget', es:'Presupuesto', ru:'Бюджет', zh:'预算', ar:'الميزانية', ja:'予算'})}</div>
                        <div className="text-xl font-mono text-white">${data.team.budget.toFixed(1)}M</div>
                    </div>
                    <div>
                        <div className="text-xs text-slate-400 uppercase text-right">{t({en:'Team', it:'Team', fr:'Équipe', de:'Team', es:'Equipo', ru:'Команда', zh:'车队', ar:'الفريق', ja:'チーム'})}</div>
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
                                    <div className="w-1.5 h-10 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.5)]" style={{ backgroundColor: constr?.color || '#555', boxShadow: `0 0 8px ${constr?.color}`}}></div>
                                    <div>
                                        <div className="text-white font-bold leading-tight">{driver.name}</div>
                                        <div className="text-xs text-slate-400">{constr?.name}</div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <div className="font-mono text-slate-200">${driver.price}M</div>
                                    {isOwned ? (
                                        <button disabled className="px-3 py-1 bg-slate-700 text-slate-400 text-xs rounded font-bold uppercase tracking-wider cursor-default">
                                            {t({en:'Owned', it:'Posseduto', fr:'Possédé', de:'Im Besitz', es:'En propiedad', ru:'Куплен', zh:'已拥有', ar:'مملوك', ja:'所有中'})}
                                        </button>
                                    ) : isTeamFull ? (
                                        <button 
                                            onClick={() => setSwapCandidate(driver)}
                                            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-bold uppercase tracking-wider transition-colors"
                                        >
                                            {t({en:'Swap', it:'Scambia', fr:'Échanger', de:'Tauschen', es:'Cambiar', ru:'Обмен', zh:'交换', ar:'تبديل', ja:'交換'})}
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={() => handleBuyDriver(driver)}
                                            disabled={!canAfford}
                                            className={`px-3 py-1 text-xs rounded font-bold uppercase tracking-wider transition-colors ${
                                                canAfford 
                                                ? 'bg-green-600 hover:bg-green-500 text-white' 
                                                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                            }`}
                                        >
                                            {t({en:'Add', it:'Aggiungi', fr:'Ajouter', de:'Hinzufügen', es:'Añadir', ru:'Добавить', zh:'添加', ar:'إضافة', ja:'追加'})}
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
            <h1 className="text-2xl font-bold text-white">{t({en:'Admin Controls', it:'Controlli Admin', fr:'Contrôles Admin', de:'Admin-Steuerung', es:'Controles Admin', ru:'Управление', zh:'管理员控制', ar:'تحكم المسؤول', ja:'管理設定'})}</h1>
            
             {/* Race Config Card */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                <h3 className="font-semibold text-white mb-2">{t({en:'Race Time Config', it:'Config Orari Gara', fr:'Config heures course', de:'Rennzeit-Konfig', es:'Config Horas Carrera', ru:'Конфиг времени гонки', zh:'赛时配置', ar:'تكوين وقت السباق', ja:'レース時間設定'})}</h3>
                {/* Navigation */}
                <div className="flex justify-between items-center mb-4">
                    <button
                        onClick={() => setData({...data, currentRaceIndex: Math.max(0, data.currentRaceIndex - 1)})}
                        disabled={data.currentRaceIndex === 0}
                        className="p-2 bg-slate-700 rounded disabled:opacity-50 text-slate-200"
                    >{t({en:'Prev', it:'Prec', fr:'Préc', de:'Zurück', es:'Ant', ru:'Пред', zh:'上一个', ar:'السابق', ja:'前へ'})}</button>
                    <div className="text-center">
                        <div className="text-xs text-slate-400">{t({en:'Index', it:'Indice', fr:'Indice', de:'Index', es:'Índice', ru:'Индекс', zh:'索引', ar:'فهرس', ja:'インデックス'})} {data.currentRaceIndex}</div>
                        <div className="font-bold text-white text-sm">{currentRace.name}</div>
                    </div>
                    <button
                        onClick={() => setData({...data, currentRaceIndex: Math.min(races.length - 1, data.currentRaceIndex + 1)})}
                        disabled={data.currentRaceIndex === races.length - 1}
                        className="p-2 bg-slate-700 rounded disabled:opacity-50 text-slate-200"
                    >{t({en:'Next', it:'Succ', fr:'Suiv', de:'Weiter', es:'Sig', ru:'След', zh:'下一个', ar:'التالي', ja:'次へ'})}</button>
                </div>

                {/* Inputs */}
                <div className="space-y-3">
                    <div className={`p-2 rounded-lg border ${!currentRace.isSprint ? 'border-yellow-500 bg-yellow-900/20' : 'border-transparent'}`}>
                        <div className="flex justify-between">
                            <label className="block text-xs text-slate-400 mb-1">{t({en:'Qualifying UTC (ISO)', it:'Qualifiche UTC (ISO)', fr:'Qualif UTC (ISO)', de:'Quali UTC (ISO)', es:'Clasif UTC (ISO)', ru:'Квалиф UTC', zh:'排位赛 UTC', ar:'التصفيات UTC', ja:'予選 UTC'})}</label>
                            {!currentRace.isSprint && <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">{t({en:'SETS LOCK', it:'LOCK ATTIVO', fr:'VERROUILLE', de:'SETZT LOCK', es:'FIJA LOCK', ru:'БЛОКИРУЕТ', zh:'设置锁定', ar:'قفل نشط', ja:'ロック設定'})}</span>}
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
                                {t({en:'SAVE', it:'SALVA', fr:'SAUVER', de:'SPEICHERN', es:'GUARDAR', ru:'СОХР', zh:'保存', ar:'حفظ', ja:'保存'})}
                            </button>
                        </div>
                    </div>

                    {currentRace.isSprint && (
                        <div className={`p-2 rounded-lg border ${currentRace.isSprint ? 'border-yellow-500 bg-yellow-900/20' : 'border-transparent'}`}>
                             <div className="flex justify-between">
                                <label className="block text-xs text-slate-400 mb-1">{t({en:'Sprint Quali UTC (ISO)', it:'Sprint Quali UTC (ISO)', fr:'Sprint Qualif UTC', de:'Sprint Quali UTC', es:'Sprint Clasif UTC', ru:'Спринт Квал UTC', zh:'冲刺赛排位 UTC', ar:'تصفيات السرعة UTC', ja:'スプリント予選 UTC'})}</label>
                                <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wider">{t({en:'SETS LOCK', it:'LOCK ATTIVO', fr:'VERROUILLE', de:'SETZT LOCK', es:'FIJA LOCK', ru:'БЛОКИРУЕТ', zh:'设置锁定', ar:'قفل نشط', ja:'ロック設定'})}</span>
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
                                    {t({en:'SAVE', it:'SALVA', fr:'SAUVER', de:'SPEICHERN', es:'GUARDAR', ru:'СОХР', zh:'保存', ar:'حفظ', ja:'保存'})}
                                </button>
                             </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Debug Time Tooling */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                <h3 className="font-semibold text-white mb-2">{t({en:'Debug Time', it:'Debug Tempo'})}</h3>
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
                <h3 className="font-semibold text-white mb-4 border-b border-slate-700 pb-2">{t({en:'Scoring Rules Config', it:'Config Punteggi', fr:'Config Points', de:'Punkte-Konfig', es:'Config Puntos', ru:'Настройка очков', zh:'计分规则', ar:'تكوين النقاط', ja:'スコア設定'})}</h3>
                <div className="grid grid-cols-2 gap-4">
                    
                    {/* Race Points - Grid of 22 */}
                    <div className="col-span-2">
                         <label className="text-xs text-slate-400 block mb-2">{t({en:'Race Points (1-22)', it:'Punti Gara (1-22)', fr:'Points Course (1-22)'})}</label>
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
                    <div><label className="text-xs text-slate-400">{t({en:'Pole Position', it:'Pole Position', fr:'Pole Position', de:'Pole Position', es:'Pole Position'})}</label><input type="number" value={data.rules.qualiPole} onChange={(e) => handleRuleChange('qualiPole', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Q3 Reached (1-10)', it:'Accesso Q3 (1-10)', fr:'Q3 Atteint (1-10)', de:'Q3 Erreicht (1.-10.)', es:'Q3 Alcanzada (1-10)'})}</label><input type="number" value={data.rules.qualiQ3Reached} onChange={(e) => handleRuleChange('qualiQ3Reached', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Q2 Reached (11-16)', it:'Accesso Q2 (11-16)', fr:'Q2 Atteint (11-16)', de:'Q2 Erreicht (11.-16.)', es:'Q2 Alcanzada (11-16)'})}</label><input type="number" value={data.rules.qualiQ2Reached} onChange={(e) => handleRuleChange('qualiQ2Reached', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Q1 Elim (17-22)', it:'Eliminato Q1 (17-22)', fr:'Éliminé Q1 (17-22)', de:'Q1 Ausgeschieden (17.-22.)', es:'Eliminado Q1 (17-22)'})}</label><input type="number" value={data.rules.qualiQ1Eliminated} onChange={(e) => handleRuleChange('qualiQ1Eliminated', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Grid Penalty', it:'Penalità Griglia', fr:'Pénalité Grille', de:'Startplatzstrafe', es:'Penalización Parrilla'})}</label><input type="number" value={data.rules.qualiGridPenalty} onChange={(e) => handleRuleChange('qualiGridPenalty', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>

                    {/* Race Bonuses */}
                    <div><label className="text-xs text-slate-400">{t({en:'Last Place Malus', it:'Malus Ultimo Posto', fr:'Malus Dernière Place', de:'Malus Letzter Platz', es:'Malus Último Lugar'})}</label><input type="number" value={data.rules.raceLastPlaceMalus} onChange={(e) => handleRuleChange('raceLastPlaceMalus', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'DNF / DNS / DSQ', it:'Ritirato / Squalificato', fr:'Abandon / Disqualifié', de:'DNF / DNS / DSQ', es:'Abandono / Descalificado'})}</label><input type="number" value={data.rules.raceDNF} onChange={(e) => handleRuleChange('raceDNF', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Race Penalty', it:'Penalità Gara', fr:'Pénalité Course', de:'Rennstrafe', es:'Penalización Carrera'})}</label><input type="number" value={data.rules.racePenalty} onChange={(e) => handleRuleChange('racePenalty', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Pos Gained (per pos)', it:'Pos Guadagnate (per pos)', fr:'Pos Gagnées (par pos)', de:'Pos Gewonnen (pro Pos)', es:'Pos Ganadas (por pos)'})}</label><input type="number" value={data.rules.positionGained} onChange={(e) => handleRuleChange('positionGained', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Pos Lost (per pos)', it:'Pos Perse (per pos)', fr:'Pos Perdues (par pos)', de:'Pos Verloren (pro Pos)', es:'Pos Perdidas (por pos)'})}</label><input type="number" value={data.rules.positionLost} onChange={(e) => handleRuleChange('positionLost', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>

                    {/* Teammate */}
                    <div><label className="text-xs text-slate-400">{t({en:'Beat Teammate', it:'Batte Compagno', fr:'Bat Coéquipier', de:'Teamkollegen geschlagen', es:'Vence Compañero'})}</label><input type="number" value={data.rules.teammateBeat} onChange={(e) => handleRuleChange('teammateBeat', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Lost to Teammate', it:'Perde vs Compagno', fr:'Perd contre Coéquipier', de:'Verliert gegen Teamk.', es:'Pierde vs Compañero'})}</label><input type="number" value={data.rules.teammateLost} onChange={(e) => handleRuleChange('teammateLost', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                    <div><label className="text-xs text-slate-400">{t({en:'Beat TM (TM DNF)', it:'Batte Compagno (Ritirato)', fr:'Bat Coéquipier (Abandon)', de:'Teamk. geschlagen (DNF)', es:'Vence Comp. (Abandono)'})}</label><input type="number" value={data.rules.teammateBeatDNF} onChange={(e) => handleRuleChange('teammateBeatDNF', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>

                     {/* Sprint */}
                     <div className="col-span-2 mt-2">
                         <label className="text-xs text-slate-400 block mb-1">{t({en:'Sprint Points (1st - 8th)', it:'Punti Sprint (1°-8°)', fr:'Points Sprint (1-8)', de:'Sprintpunkte (1.-8.)', es:'Puntos Sprint (1º-8º)'})}</label>
                         <input 
                            type="text"
                            value={sprintPointsInput}
                            onChange={(e) => handleSprintPointsChange(e.target.value)}
                            className={`w-full bg-slate-900 border ${pointsError.sprint ? 'border-red-500' : 'border-slate-600'} rounded p-2 text-sm text-white`}
                         />
                         {pointsError.sprint && <p className="text-red-500 text-xs mt-1">{pointsError.sprint}</p>}
                    </div>
                    <div><label className="text-xs text-slate-400">{t({en:'Sprint Quali Pole', it:'Pole Sprint Quali', fr:'Pole Qualif Sprint', de:'Sprint Quali Pole', es:'Pole Sprint Clasif'})}</label><input type="number" value={data.rules.sprintPole} onChange={(e) => handleRuleChange('sprintPole', Number(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded p-1 text-white"/></div>
                </div>
            </div>

            {/* Constructor Multipliers */}
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                <h3 className="font-semibold text-white mb-4 border-b border-slate-700 pb-2">{t({en:'Constructor Multipliers', it:'Coefficienti Scuderie', fr:'Coefficients Équipes', de:'Konstrukteurs-Multiplikatoren', es:'Coeficientes Constructores', ru:'Коэффициенты конструкторов', zh:'车队系数', ar:'معاملات الفرق', ja:'コンストラクター係数'})}</h3>
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
                <h3 className="font-semibold text-white mb-2">{t({en:'User Profile', it:'Profilo Utente', fr:'Profil utilisateur', de:'Benutzerprofil', es:'Perfil usuario', ru:'Профиль', zh:'用户资料', ar:'ملف المستخدم', ja:'プロフィール'})}</h3>
                <div className="mb-4 text-sm text-slate-300">
                    <p><span className="text-slate-500">{t({en:'Name', it:'Nome', fr:'Nom', de:'Name', es:'Nombre', ru:'Имя', zh:'名字', ar:'الاسم', ja:'名前'})}:</span> {data.user?.name}</p>
                    <p><span className="text-slate-500">{t({en:'Role', it:'Ruolo', fr:'Rôle', de:'Rolle', es:'Rol', ru:'Роль', zh:'角色', ar:'الدور', ja:'役割'})}:</span> {data.user?.isAdmin ? 'Admin' : 'Member'}</p>
                    <p><span className="text-slate-500">{t({en:'League Code', it:'Codice Lega', fr:'Code Ligue', de:'Liga-Code', es:'Código Liga', ru:'Код лиги', zh:'联盟代码', ar:'رمز الدوري', ja:'リーグコード'})}:</span> <span className="font-mono text-blue-400">{data.user?.leagueCode}</span></p>
                </div>
                
                <div className="flex flex-col gap-3 mt-4">
                    <button 
                        onClick={handleLogout}
                        className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded transition-colors"
                    >
                        {t({en:'Logout', it:'Esci', fr:'Déconnexion', de:'Abmelden', es:'Salir', ru:'Выйти', zh:'登出', ar:'خروج', ja:'ログアウト'})}
                    </button>
                    {showResetConfirm ? (
                         <div className="bg-red-950/50 border border-red-500 p-4 rounded-lg animate-pulse">
                            <p className="text-red-200 text-center mb-3 font-bold">{t({en:'Delete all local data?', it:'Eliminare i dati locali?', fr:'Supprimer données locales?', de:'Lokale Daten löschen?', es:'¿Borrar datos locales?', ru:'Удалить данные?', zh:'删除本地数据？', ar:'حذف البيانات المحلية؟', ja:'全データを削除しますか？'})}</p>
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setShowResetConfirm(false)}
                                    className="flex-1 bg-slate-600 text-white py-2 rounded hover:bg-slate-500"
                                >
                                    {t({en:'Cancel', it:'Annulla', fr:'Annuler', de:'Abbrechen', es:'Cancelar', ru:'Отмена', zh:'取消', ar:'إلغاء', ja:'キャンセル'})}
                                </button>
                                <button 
                                    onClick={handleLogout}
                                    className="flex-1 bg-red-600 text-white py-2 rounded hover:bg-red-500"
                                >
                                    {t({en:'Confirm', it:'Conferma', fr:'Confirmer', de:'Bestätigen', es:'Confirmar', ru:'Подтвердить', zh:'确认', ar:'تأكيد', ja:'確認'})}
                                </button>
                            </div>
                         </div>
                    ) : (
                        <button 
                            onClick={() => setShowResetConfirm(true)}
                            className="w-full bg-red-900/50 hover:bg-red-800/50 text-red-200 font-bold py-2 px-4 rounded transition-colors border border-red-900"
                        >
                            {t({en:'Reset All Data (Logout)', it:'Resetta Dati (Logout)', fr:'Réinitialiser (Déconnexion)', de:'Reset (Abmelden)', es:'Reiniciar (Salir)', ru:'Сброс (Выход)', zh:'重置所有数据', ar:'إعادة تعيين (خروج)', ja:'リセット (ログアウト)'})}
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
                    {showDebug ? t({en:'Hide Debug Info', it:'Nascondi Debug', fr:'Masquer Debug', de:'Debug verbergen', es:'Ocultar Debug', ru:'Скрыть отладку', zh:'隐藏调试', ar:'إخفاء التصحيح', ja:'デバッグ非表示'}) : t({en:'Show Debug Info', it:'Mostra Debug', fr:'Afficher Debug', de:'Debug zeigen', es:'Mostrar Debug', ru:'Показать отладку', zh:'显示调试', ar:'إظهار التصحيح', ja:'デバッグ表示'})}
                </button>
            </div>

            {/* Debug Info (Collapsed) */}
            {showDebug && (
                <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/50">
                    <h3 className="font-semibold text-white mb-2">{t({en:'Debug', it:'Debug', fr:'Debug', de:'Debug', es:'Debug', ru:'Отладка', zh:'调试', ar:'تصحيح', ja:'デバッグ'})}</h3>
                    <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded mb-4 overflow-x-auto border border-slate-800">
                        {JSON.stringify(data.team, null, 2)}
                    </div>
                    
                    <h3 className="font-semibold text-white mb-2 mt-4">{t({en:'Race Lock Debug', it:'Debug Blocco Gara', fr:'Debug Verrouillage', de:'Renn-Sperre Debug', es:'Debug Bloqueo', ru:'Отладка блокировки', zh:'锁定调试', ar:'تصحيح قفل السباق', ja:'レースロックデバッグ'})}</h3>
                    <div className="text-xs font-mono text-slate-400 bg-slate-950 p-2 rounded mb-4 overflow-x-auto border border-slate-800">
                        <p>Race: {currentRace.name}</p>
                        <p>Status: <span className={getStatusColor(lockState.status)}>{lockState.status}</span></p>
                        <p>Session: {currentRace.isSprint ? t({en:'Sprint Qualifying', it:'Sprint Shootout', fr:'Qualif Sprint', de:'Sprint Quali', es:'Sprint Clasif', ru:'Спринт Квал', zh:'冲刺排位', ar:'تصفيات السرعة', ja:'スプリント予選'}) : t({en:'Qualifying', it:'Qualifiche', fr:'Qualifications', de:'Qualifying', es:'Clasificación', ru:'Квалификация', zh:'排位赛', ar:'تصفيات', ja:'予選'})}</p>
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
        {activeTab === Tab.HOME && LangMenu}
        <Layout activeTab={activeTab} onTabChange={setActiveTab} showAdmin={data.user.isAdmin} lang={language}>
        {renderContent()}
        </Layout>
    </>
  );
};

export default App;