// ============================================================================
// 筋トレNOW スタジオ v4.3 — iPad ＆ スマホ完全レスポンシブ × 出張ホテル負荷選択・セット別記録仕様
// （建設NOWニュースUI × 厳密図解 × ショウコ音声 × 5分瞑想 × 自宅枚数＆出張負荷Lvセット別記録 × 動画タイマー完全ロック）
// ============================================================================

(function () {
  'use strict';

  const DATA = window.WORKOUT_DATA;
  const STATIC_VOICES = window.SHOKO_AUDIO_MANIFEST || {};
  const RELAY_BASE_URL = 'https://workout-flow-gw-6z0fumwa.an.gateway.dev';
  const STORAGE_KEYS = {
    locationMode: 'flow40_location_mode_v2',
    durationMode: 'flow40_duration_mode_v1',
    durationModeDate: 'flow40_duration_mode_date_v1',
    plates: 'flow40_irotec_plates_v1',
    loadMap: 'flow40_bodyweight_load_v1',
    repsMap: 'flow40_reps_map_v1',
    sessionSetRepsLegacy: 'flow40_session_set_reps_v1',
    sessionSets: 'flow40_session_sets_v2',
    rpeMap: 'flow40_rpe_map_v1',
    morningCond: 'flow40_morning_cond_v1',
    customStretches: 'flow40_custom_stretches_v1',
    lastStretchId: 'flow40_last_stretch_id_v1',
    lastMeditationId: 'flow40_last_meditation_id_v1',
    logs: 'flow40_workout_logs_v1',
    voiceEnabled: 'flow40_voice_enabled_v1',
    syncKey: 'flow40_sync_key_v1',
    pendingQueue: 'flow40_sync_pending_v1',
    lastSyncedAt: 'flow40_last_synced_at_v1'
  };

  // 出張ホテル・自重種目用の5段階負荷レベル定義
  const MAX_LOAD_LV = 5;
  const DEFAULT_LOAD_LV = 3;
  const BODYWEIGHT_LOAD_LEVELS = {
    1: { short: '軽め', detail: '膝つき・浅め角度（フォーム確認）' },
    2: { short: 'やや軽', detail: '通常角度・反動なしテンポ' },
    3: { short: '標準', detail: '標準負荷・3秒スロー戻し' },
    4: { short: '強め', detail: '足上げ高角度・タオル全力張力' },
    5: { short: '最大', detail: '片側高負荷・1秒静止・ジム重量' }
  };

  function getTodayJst() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  // 自宅IROTECマシン12種目のメタ辞書
  const HOME_PLATE_EXERCISES = {};
  Object.values(DATA.homePlans || {}).forEach((plan) => {
    (plan.blocks || []).forEach((b) => {
      if (b.type === 'machine' && b.id && !b.hidePlates) {
        HOME_PLATE_EXERCISES[b.id] = {
          id: b.id,
          title: b.title,
          defaultPlates: b.defaultPlates || 5,
          sets: b.sets || 3
        };
      }
    });
  });

  function consumeSyncKeyFromUrl() {
    let foundKey = '';
    try {
      if (window.location.hash && window.location.hash.length > 1) {
        const hp = new URLSearchParams(window.location.hash.slice(1));
        foundKey = (hp.get('key') || hp.get('syncKey') || '').trim();
      }
      const sp = new URLSearchParams(window.location.search);
      if (!foundKey) {
        foundKey = (sp.get('key') || sp.get('syncKey') || '').trim();
      }
      if (foundKey) {
        localStorage.setItem(STORAGE_KEYS.syncKey, foundKey);
        sp.delete('key');
        sp.delete('syncKey');
        const qs = sp.toString();
        const cleanUrl = window.location.pathname + (qs ? '?' + qs : '');
        window.history.replaceState(null, '', cleanUrl);
      }
    } catch (_) {}
    return foundKey || (localStorage.getItem(STORAGE_KEYS.syncKey) || '').trim();
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function loadBool(key, fallback) {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  }

  function loadTodaySessionSets(initialPlateMap) {
    const todayIso = getTodayJst();
    const savedV2 = loadJson(STORAGE_KEYS.sessionSets, null);
    if (savedV2 && savedV2.date === todayIso && savedV2.sets && typeof savedV2.sets === 'object') {
      return savedV2.sets;
    }
    // v4.1 の同日セット回数データがあればシームレス引き継ぎ
    const legacy = loadJson(STORAGE_KEYS.sessionSetRepsLegacy, null);
    if (legacy && legacy.date === todayIso && legacy.sets && typeof legacy.sets === 'object') {
      const migrated = {};
      Object.entries(legacy.sets).forEach(([exId, setObj]) => {
        if (!setObj || typeof setObj !== 'object') return;
        migrated[exId] = {};
        const baseP = HOME_PLATE_EXERCISES[exId]
          ? initialPlateMap[exId] || HOME_PLATE_EXERCISES[exId].defaultPlates
          : null;
        Object.entries(setObj).forEach(([sIdx, rVal]) => {
          const rNum = Math.round(Number(rVal));
          if (Number.isFinite(rNum) && rNum > 0) {
            migrated[exId][sIdx] = { plates: baseP, reps: rNum };
          }
        });
      });
      return migrated;
    }
    return {};
  }

  function saveTodaySessionSets(setsObj) {
    saveJson(STORAGE_KEYS.sessionSets, {
      date: getTodayJst(),
      sets: setsObj || {}
    });
  }

  // -------------------- State --------------------
  const initialPlateMap = loadJson(STORAGE_KEYS.plates, {});
  const state = {
    locationMode: resolveInitialLocation(), // 'home' | 'hotel'
    durationMode: resolveInitialDurationMode(), // 'full' | 'short' | 'care'
    selectedDay: resolveInitialDay(),
    selectedStretchId: null,
    selectedMeditationId: null,
    steps: [],
    currentIndex: 0,
    remainingSec: 0,
    stepTotalSec: 0,
    isRunning: false,
    hasStartedOnce: false,
    voiceEnabled: loadBool(STORAGE_KEYS.voiceEnabled, true),
    showDemoPip: false,
    plateMap: initialPlateMap, // 自宅マシンの「次回初期セット枚数（＝最高枚数）」
    loadMap: loadJson(STORAGE_KEYS.loadMap, {}), // 出張ホテル・自重種目の「次回初期負荷Lv（＝最高Lv）」
    repsMap: loadJson(STORAGE_KEYS.repsMap, {}),
    todaySets: loadTodaySessionSets(initialPlateMap), // { [exId]: { [setIdx]: { plates, reps } } }
    editingSetOverride: null,
    editingSetExId: null,
    rpeMap: loadJson(STORAGE_KEYS.rpeMap, {}),
    morningCondition: loadJson(STORAGE_KEYS.morningCond, null),
    customStretches: loadJson(STORAGE_KEYS.customStretches, []),
    logs: loadJson(STORAGE_KEYS.logs, []),
    syncKey: consumeSyncKeyFromUrl(),
    syncStatus: 'unconfigured',
    lastSyncedAt: localStorage.getItem(STORAGE_KEYS.lastSyncedAt) || '',
    lastPullMs: 0,
    plateSyncTimers: {},
    timerHandle: null,
    demoLoopHandle: null,
    wakeLock: null,
    audioCtx: null,
    shokoAudio: new Audio(),
    ytPlayer: null,
    ytReady: false,
    ytStepFailed: false,
    videoStepSeekVerified: false,
    lastAutoAdvancedStep: null,
    pendingVideoLoad: null
  };

  state.shokoAudio.preload = 'auto';

  // -------------------- DOM Elements --------------------
  const el = {
    body: document.body,
    locHomeBtn: document.getElementById('locHomeBtn'),
    locHotelBtn: document.getElementById('locHotelBtn'),
    durFullBtn: document.getElementById('durFullBtn'),
    durShortBtn: document.getElementById('durShortBtn'),
    durCareBtn: document.getElementById('durCareBtn'),
    daySwitcher: document.getElementById('daySwitcher'),
    overallStepText: document.getElementById('overallStepText'),
    overallRemainText: document.getElementById('overallRemainText'),
    overallProgressBar: document.getElementById('overallProgressBar'),
    openTimelineBtn: document.getElementById('openTimelineBtn'),
    openSyncModalBtn: document.getElementById('openSyncModalBtn'),
    syncIconEmoji: document.getElementById('syncIconEmoji'),
    syncStatusLabel: document.getElementById('syncStatusLabel'),
    voiceToggleBtn: document.getElementById('voiceToggleBtn'),
    openPoolModalBtn: document.getElementById('openPoolModalBtn'),
    openLogModalBtn: document.getElementById('openLogModalBtn'),
    streakBadge: document.getElementById('streakBadge'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),

    stagePane: document.getElementById('stagePane'),
    ytBadge: document.getElementById('ytBadge'),
    ytSafetyTip: document.getElementById('ytSafetyTip'),
    ytUnblockBtn: document.getElementById('ytUnblockBtn'),

    dayTag: document.getElementById('dayTag'),
    workoutMainTitle: document.getElementById('workoutMainTitle'),
    toggleDemoPipBtn: document.getElementById('toggleDemoPipBtn'),
    exerciseGuideImg: document.getElementById('exerciseGuideImg'),
    hwPulley: document.getElementById('hwPulley'),
    hwAttachment: document.getElementById('hwAttachment'),
    hwPinDisplay: document.getElementById('hwPinDisplay'),
    actionStepsRow: document.getElementById('actionStepsRow'),
    setupInstruction: document.getElementById('setupInstruction'),
    replayVoiceBtn: document.getElementById('replayVoiceBtn'),
    shokoAvatar: document.querySelector('.shoko-avatar'),
    idleHeroBanner: document.getElementById('idleHeroBanner'),
    heroStartBtn: document.getElementById('heroStartBtn'),

    morningConditionBar: document.getElementById('morningConditionBar'),
    mcBadge: document.getElementById('mcBadge'),
    mcVitals: document.getElementById('mcVitals'),
    mcMessage: document.getElementById('mcMessage'),
    mcActionBtn: document.getElementById('mcActionBtn'),

    phasePill: document.getElementById('phasePill'),
    setDots: document.getElementById('setDots'),
    currentStepTitle: document.getElementById('currentStepTitle'),
    currentStepSub: document.getElementById('currentStepSub'),
    timerStateLabel: document.getElementById('timerStateLabel'),
    timerDigits: document.getElementById('timerDigits'),
    stepProgressFill: document.getElementById('stepProgressFill'),
    minus10Btn: document.getElementById('minus10Btn'),
    plus15Btn: document.getElementById('plus15Btn'),
    wakeIndicator: document.getElementById('wakeIndicator'),

    plateSelector: document.getElementById('plateSelector'),
    plateHeadingTitle: document.getElementById('plateHeadingTitle'),
    plateKgHint: document.getElementById('plateKgHint'),
    overloadBanner: document.getElementById('overloadBanner'),
    overloadText: document.getElementById('overloadText'),
    overloadAcceptBtn: document.getElementById('overloadAcceptBtn'),
    setLogStrip: document.getElementById('setLogStrip'),
    twinStepperGrid: document.getElementById('twinStepperGrid'),
    plateStepperWrap: document.getElementById('plateStepperWrap'),
    plateMinusBtn: document.getElementById('plateMinusBtn'),
    platePlusBtn: document.getElementById('platePlusBtn'),
    plateCountNum: document.getElementById('plateCountNum'),
    plateUnitLabel: document.getElementById('plateUnitLabel'),
    repsStepperWrap: document.getElementById('repsStepperWrap'),
    repsMinusBtn: document.getElementById('repsMinusBtn'),
    repsPlusBtn: document.getElementById('repsPlusBtn'),
    repsCountNum: document.getElementById('repsCountNum'),
    hotelInlineCue: document.getElementById('hotelInlineCue'),

    rpeFeedbackBox: document.getElementById('rpeFeedbackBox'),
    rpeHeadingTitle: document.getElementById('rpeHeadingTitle'),
    rpeStreakHint: document.getElementById('rpeStreakHint'),
    repQuickRow: document.getElementById('repQuickRow'),
    rpeBtnRow: document.getElementById('rpeBtnRow'),

    hotelTipBox: document.getElementById('hotelTipBox'),
    hotelTipText: document.getElementById('hotelTipText'),

    videoContextBox: document.getElementById('videoContextBox'),
    videoChannelTag: document.getElementById('videoChannelTag'),
    ytExternalLink: document.getElementById('ytExternalLink'),
    shuffleStretchBtn: document.getElementById('shuffleStretchBtn'),
    replayStepVideoBtn: document.getElementById('replayStepVideoBtn'),

    nextUpBar: document.getElementById('nextUpBar'),
    nextStepTitle: document.getElementById('nextStepTitle'),
    prevStepBtn: document.getElementById('prevStepBtn'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    nextStepBtn: document.getElementById('nextStepBtn'),

    timelineModal: document.getElementById('timelineModal'),
    timelineModalTitle: document.getElementById('timelineModalTitle'),
    timelineList: document.getElementById('timelineList'),

    poolModal: document.getElementById('poolModal'),
    meditationPoolGrid: document.getElementById('meditationPoolGrid'),
    stretchPoolGrid: document.getElementById('stretchPoolGrid'),
    addVideoForm: document.getElementById('addVideoForm'),
    customVideoUrl: document.getElementById('customVideoUrl'),
    customVideoTitle: document.getElementById('customVideoTitle'),
    customVideoStart: document.getElementById('customVideoStart'),
    customVideoMinutes: document.getElementById('customVideoMinutes'),

    logModal: document.getElementById('logModal'),
    logModalHeading: document.getElementById('logModalHeading'),
    logModalSyncBadge: document.getElementById('logModalSyncBadge'),
    hmStrength: document.getElementById('hmStrength'),
    hmCardio: document.getElementById('hmCardio'),
    hmFlex: document.getElementById('hmFlex'),
    hmMeditation: document.getElementById('hmMeditation'),
    sessionWeightsEditor: document.getElementById('sessionWeightsEditor'),
    sessionWeightsList: document.getElementById('sessionWeightsList'),
    manualSaveSessionBtn: document.getElementById('manualSaveSessionBtn'),
    manualSaveMeditationBtn: document.getElementById('manualSaveMeditationBtn'),
    logSyncFeedback: document.getElementById('logSyncFeedback'),
    weeklyStampRow: document.getElementById('weeklyStampRow'),
    splitLevelBtns: document.getElementById('splitLevelBtns'),
    splitQuickChips: document.getElementById('splitQuickChips'),
    splitMemoForm: document.getElementById('splitMemoForm'),
    splitMemoInput: document.getElementById('splitMemoInput'),
    recentLogsList: document.getElementById('recentLogsList'),

    syncModal: document.getElementById('syncModal'),
    syncModalBadge: document.getElementById('syncModalBadge'),
    syncModalDetail: document.getElementById('syncModalDetail'),
    syncNowBtn: document.getElementById('syncNowBtn'),
    syncKeyForm: document.getElementById('syncKeyForm'),
    syncKeyInput: document.getElementById('syncKeyInput')
  };

  // -------------------- Helpers --------------------
  function resolveInitialLocation() {
    const params = new URLSearchParams(window.location.search);
    const qLoc = params.get('loc');
    if (qLoc === 'hotel' || qLoc === 'home') return qLoc;
    const saved = localStorage.getItem(STORAGE_KEYS.locationMode);
    return saved === 'hotel' ? 'hotel' : 'home';
  }

  function resolveInitialDurationMode() {
    const params = new URLSearchParams(window.location.search);
    const qMode = params.get('mode') || params.get('dur');
    if (qMode === 'full' || qMode === 'short' || qMode === 'care') return qMode;
    const savedDate = localStorage.getItem(STORAGE_KEYS.durationModeDate);
    const savedMode = localStorage.getItem(STORAGE_KEYS.durationMode);
    if (savedDate === getTodayJst() && (savedMode === 'short' || savedMode === 'care')) {
      return savedMode;
    }
    return 'full';
  }

  function resolveInitialDay() {
    const params = new URLSearchParams(window.location.search);
    const qDay = params.get('day');
    if (qDay !== null && DATA.homePlans[Number(qDay)]) {
      return Number(qDay);
    }
    const jstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
    return jstDay;
  }

  function getActivePlan(dayKey) {
    if (state.locationMode === 'hotel' && DATA.hotelPlans[dayKey]) {
      return DATA.hotelPlans[dayKey];
    }
    return DATA.homePlans[dayKey];
  }

  function formatMMSS(sec) {
    const s = Math.max(0, Math.round(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function getAllStretches() {
    return [...DATA.stretchPool, ...state.customStretches];
  }

  function getAllMeditations() {
    return DATA.meditationPool || [];
  }

  // 次回初期セット用（＝最高枚数 / 最高負荷Lv）を取得
  function getPresetPlatesForExercise(exId, defaultPlates) {
    if (exId && typeof state.plateMap[exId] === 'number' && state.plateMap[exId] > 0) {
      return state.plateMap[exId];
    }
    return defaultPlates || HOME_PLATE_EXERCISES[exId]?.defaultPlates || 5;
  }

  function getPresetLoadLevelForExercise(exId) {
    const v = Number(state.loadMap[exId] || state.rpeMap[exId]?.lastLoadLv || 0);
    if (exId && Number.isFinite(v) && v >= 1 && v <= MAX_LOAD_LV) {
      return Math.round(v);
    }
    return DEFAULT_LOAD_LV;
  }

  function formatLoadLevelDetail(lv) {
    const cleanLv = Math.max(1, Math.min(MAX_LOAD_LV, Math.round(Number(lv) || DEFAULT_LOAD_LV)));
    const meta = BODYWEIGHT_LOAD_LEVELS[cleanLv] || BODYWEIGHT_LOAD_LEVELS[DEFAULT_LOAD_LV];
    return { lv: cleanLv, short: meta.short, detail: meta.detail };
  }

  function formatPlateDetail(plates) {
    const lbs = plates * DATA.plateStepLbs;
    const kg = (plates * DATA.plateStepKg).toFixed(1).replace(/\.0$/, '');
    return { lbs, kg, text: `${lbs} lbs / 約${kg} kg` };
  }

  function getDefaultRepsForExercise(exId, fallbackReps = 10) {
    if (exId && Number.isFinite(Number(state.repsMap[exId])) && Number(state.repsMap[exId]) > 0) {
      return Math.round(Number(state.repsMap[exId]));
    }
    const rpeReps = Number(state.rpeMap[exId]?.lastReps);
    if (Number.isFinite(rpeReps) && rpeReps > 0) {
      return Math.round(rpeReps);
    }
    return fallbackReps;
  }

  // -------------------- セット別「重量(負荷Lv)×回数」データヘルパー --------------------
  function getTodaySetEntry(exId, setIndex) {
    if (!exId || !setIndex) return null;
    const entry = state.todaySets[exId]?.[setIndex];
    return entry && typeof entry === 'object' ? entry : null;
  }

  function getEffectivePlatesForSet(exId, setIndex, defaultPlates) {
    const cur = getTodaySetEntry(exId, setIndex);
    if (cur && Number.isFinite(Number(cur.plates)) && Number(cur.plates) > 0) {
      return Math.round(Number(cur.plates));
    }
    for (let s = (setIndex || 1) - 1; s >= 1; s--) {
      const prev = getTodaySetEntry(exId, s);
      if (prev && Number.isFinite(Number(prev.plates)) && Number(prev.plates) > 0) {
        return Math.round(Number(prev.plates));
      }
    }
    return getPresetPlatesForExercise(exId, defaultPlates);
  }

  function getEffectiveLoadLevelForSet(exId, setIndex) {
    const cur = getTodaySetEntry(exId, setIndex);
    if (cur && Number.isFinite(Number(cur.loadLv)) && Number(cur.loadLv) > 0) {
      return Math.round(Number(cur.loadLv));
    }
    for (let s = (setIndex || 1) - 1; s >= 1; s--) {
      const prev = getTodaySetEntry(exId, s);
      if (prev && Number.isFinite(Number(prev.loadLv)) && Number(prev.loadLv) > 0) {
        return Math.round(Number(prev.loadLv));
      }
    }
    return getPresetLoadLevelForExercise(exId);
  }

  function getEffectiveRepsForSet(exId, setIndex, fallbackReps = 10) {
    const cur = getTodaySetEntry(exId, setIndex);
    if (cur && Number.isFinite(Number(cur.reps)) && Number(cur.reps) > 0) {
      return Math.round(Number(cur.reps));
    }
    for (let s = (setIndex || 1) - 1; s >= 1; s--) {
      const prev = getTodaySetEntry(exId, s);
      if (prev && Number.isFinite(Number(prev.reps)) && Number(prev.reps) > 0) {
        return Math.round(Number(prev.reps));
      }
    }
    return getDefaultRepsForExercise(exId, fallbackReps);
  }

  function upsertTodaySetEntry(exId, setIndex, patch, defaultPlates, isWeightEx = true) {
    if (!exId || !setIndex) return;
    if (!state.todaySets[exId] || typeof state.todaySets[exId] !== 'object') {
      state.todaySets[exId] = {};
    }
    const existing = state.todaySets[exId][setIndex] || {};
    const basePlates = isWeightEx
      ? existing.plates || getEffectivePlatesForSet(exId, setIndex, defaultPlates)
      : null;
    const baseLoadLv = !isWeightEx
      ? existing.loadLv || getEffectiveLoadLevelForSet(exId, setIndex)
      : null;

    const nextEntry = {
      plates:
        patch.plates !== undefined
          ? patch.plates !== null
            ? Math.max(1, Math.min(DATA.maxPlates, Math.round(Number(patch.plates))))
            : null
          : basePlates,
      loadLv:
        patch.loadLv !== undefined
          ? patch.loadLv !== null
            ? Math.max(1, Math.min(MAX_LOAD_LV, Math.round(Number(patch.loadLv))))
            : null
          : baseLoadLv,
      reps:
        patch.reps !== undefined
          ? patch.reps !== null
            ? Math.max(1, Math.min(60, Math.round(Number(patch.reps))))
            : null
          : existing.reps ?? null
    };
    state.todaySets[exId][setIndex] = nextEntry;
    saveTodaySessionSets(state.todaySets);
  }

  function ensureSetLoadInitialized(exId, setIndex, defaultPlates, isWeightEx = true) {
    if (!exId || !setIndex) return;
    const cur = getTodaySetEntry(exId, setIndex);
    if (isWeightEx && HOME_PLATE_EXERCISES[exId]) {
      if (!cur || !cur.plates) {
        const inherited = getEffectivePlatesForSet(exId, setIndex, defaultPlates);
        upsertTodaySetEntry(exId, setIndex, { plates: inherited }, defaultPlates, true);
      }
    } else if (!isWeightEx) {
      if (!cur || !cur.loadLv) {
        const inheritedLv = getEffectiveLoadLevelForSet(exId, setIndex);
        upsertTodaySetEntry(exId, setIndex, { loadLv: inheritedLv }, defaultPlates, false);
      }
    }
  }

  function getTodayCleanSetsList(exId) {
    if (!exId || !state.todaySets[exId] || typeof state.todaySets[exId] !== 'object') {
      return [];
    }
    return Object.entries(state.todaySets[exId])
      .map(([k, v]) => {
        const setNum = Number(k);
        if (!Number.isFinite(setNum) || setNum < 1 || !v || typeof v !== 'object') return null;
        const p = Number.isFinite(Number(v.plates)) && Number(v.plates) > 0 ? Math.round(Number(v.plates)) : null;
        const lv = Number.isFinite(Number(v.loadLv)) && Number(v.loadLv) > 0 ? Math.round(Number(v.loadLv)) : null;
        const r = Number.isFinite(Number(v.reps)) && Number(v.reps) > 0 ? Math.round(Number(v.reps)) : null;
        if (p === null && lv === null && r === null) return null;
        return {
          set: setNum,
          plates: p,
          kg: p !== null ? Number((p * DATA.plateStepKg).toFixed(1)) : null,
          loadLv: lv,
          reps: r
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.set - b.set);
  }

  function computeMaxPlatesForExercise(exId, defaultPlates) {
    const sets = getTodayCleanSetsList(exId);
    const pVals = sets.map((s) => s.plates).filter((p) => typeof p === 'number' && p > 0);
    if (pVals.length > 0) {
      return Math.max(...pVals);
    }
    return getPresetPlatesForExercise(exId, defaultPlates);
  }

  function computeMaxLoadLevelForExercise(exId) {
    const sets = getTodayCleanSetsList(exId);
    const lvVals = sets.map((s) => s.loadLv).filter((lv) => typeof lv === 'number' && lv > 0);
    if (lvVals.length > 0) {
      return Math.max(...lvVals);
    }
    return getPresetLoadLevelForExercise(exId);
  }

  function formatExerciseSetsSummary(exId, { includeKg = false, defaultPlates = 5, defaultReps = 10, isWeightEx = true } = {}) {
    const sets = getTodayCleanSetsList(exId);
    const recordedWithReps = sets.filter((s) => s.reps !== null);

    if (isWeightEx) {
      if (sets.length > 0) {
        const pVals = sets.map((s) => s.plates || getPresetPlatesForExercise(exId, defaultPlates));
        const firstP = pVals[0];
        const allSameP = pVals.every((p) => p === firstP);

        if (allSameP) {
          const det = formatPlateDetail(firstP);
          const kgPart = includeKg ? `(${det.kg}kg)` : '';
          if (recordedWithReps.length >= 2) {
            return `${firstP}枚${kgPart}×${recordedWithReps.map((s) => s.reps).join('/')}回`;
          }
          const singleRep = recordedWithReps[0]?.reps || getDefaultRepsForExercise(exId, defaultReps);
          return `${firstP}枚${kgPart}×${singleRep}回`;
        }

        const groups = [];
        sets.forEach((s) => {
          const p = s.plates || firstP;
          const repLabel = s.reps !== null ? String(s.reps) : `${getDefaultRepsForExercise(exId, defaultReps)}`;
          const prev = groups[groups.length - 1];
          if (prev && prev.plates === p) {
            prev.repsList.push(repLabel);
          } else {
            groups.push({ plates: p, repsList: [repLabel] });
          }
        });
        return groups
          .map((g) => {
            const det = formatPlateDetail(g.plates);
            const kgPart = includeKg ? `(${det.kg}kg)` : '';
            return `${g.plates}枚${kgPart}×${g.repsList.join('/')}回`;
          })
          .join('→');
      }

      const presetP = getPresetPlatesForExercise(exId, defaultPlates);
      const det = formatPlateDetail(presetP);
      const kgPart = includeKg ? `(${det.kg}kg)` : '';
      const prevSetTxt = String(state.rpeMap[exId]?.setRepsText || '').trim();
      if (prevSetTxt && prevSetTxt.includes('→')) {
        return includeKg ? `最高${presetP}枚(${det.kg}kg) [前回 ${prevSetTxt}]` : prevSetTxt;
      }
      if (prevSetTxt && prevSetTxt.includes('/')) {
        const core = prevSetTxt.replace(/回$/u, '');
        return `${presetP}枚${kgPart}×${core}回`;
      }
      return `${presetP}枚${kgPart}×${getDefaultRepsForExercise(exId, defaultReps)}回`;
    }

    // 出張ホテル・自重種目（負荷Lv.1〜5 × 回数）
    if (sets.length > 0) {
      const lvVals = sets.map((s) => s.loadLv || getPresetLoadLevelForExercise(exId));
      const firstLv = lvVals[0];
      const allSameLv = lvVals.every((lv) => lv === firstLv);

      if (allSameLv) {
        const lvMeta = formatLoadLevelDetail(firstLv);
        const descPart = includeKg ? `(${lvMeta.short})` : '';
        if (recordedWithReps.length >= 2) {
          return `Lv.${firstLv}${descPart}×${recordedWithReps.map((s) => s.reps).join('/')}回`;
        }
        const singleRep = recordedWithReps[0]?.reps || getDefaultRepsForExercise(exId, defaultReps);
        return `Lv.${firstLv}${descPart}×${singleRep}回`;
      }

      const groups = [];
      sets.forEach((s) => {
        const lv = s.loadLv || firstLv;
        const repLabel = s.reps !== null ? String(s.reps) : `${getDefaultRepsForExercise(exId, defaultReps)}`;
        const prev = groups[groups.length - 1];
        if (prev && prev.lv === lv) {
          prev.repsList.push(repLabel);
        } else {
          groups.push({ lv, repsList: [repLabel] });
        }
      });
      return groups
        .map((g) => {
          const lvMeta = formatLoadLevelDetail(g.lv);
          const descPart = includeKg ? `(${lvMeta.short})` : '';
          return `Lv.${g.lv}${descPart}×${g.repsList.join('/')}回`;
        })
        .join('→');
    }

    const presetLv = getPresetLoadLevelForExercise(exId);
    const lvMeta = formatLoadLevelDetail(presetLv);
    const descPart = includeKg ? `(${lvMeta.short})` : '';
    return `Lv.${presetLv}${descPart}×${getDefaultRepsForExercise(exId, defaultReps)}回`;
  }

  function hasSubTenOrDroppedWeight(exId, isWeightEx = true) {
    if (!exId) return false;
    const sets = getTodayCleanSetsList(exId);
    if (sets.length > 0) {
      const loadVals = sets
        .map((s) => (isWeightEx ? s.plates : s.loadLv))
        .filter((v) => typeof v === 'number' && v > 0);
      const maxL = loadVals.length ? Math.max(...loadVals) : 0;
      if (loadVals.some((v) => v < maxL)) return true;
      if (sets.some((s) => s.reps !== null && s.reps < 10)) return true;
      if (sets.some((s) => s.reps !== null)) return false;
    }

    const prevLastSets = state.rpeMap[exId]?.lastSets;
    if (Array.isArray(prevLastSets) && prevLastSets.length > 0) {
      const loadVals = prevLastSets
        .map((s) => Number(isWeightEx ? s.plates : s.loadLv))
        .filter((n) => n > 0);
      const maxL = loadVals.length ? Math.max(...loadVals) : 0;
      if (loadVals.some((v) => v < maxL)) return true;
      if (prevLastSets.some((s) => Number(s.reps) > 0 && Number(s.reps) < 10)) return true;
    }

    const prevTxt = String(state.rpeMap[exId]?.setRepsText || '');
    if (prevTxt.includes('→')) return true;
    if (prevTxt.includes('/')) {
      const nums = prevTxt
        .replace(/回$/u, '')
        .split('/')
        .map((x) => Number(x.replace(/^.*×/, '').trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (nums.some((n) => n < 10)) return true;
    }

    return getDefaultRepsForExercise(exId, isWeightEx ? 10 : 12) < 10;
  }

  function cleanExerciseShortTitle(title) {
    return String(title || '').replace(/^[①②③④⑤]\s*/, '');
  }

  function resolveVideoTiming(srcObj, { allowShortCut = false } = {}) {
    const startSec = Math.max(0, Math.round(Number(srcObj.startSeconds) || 0));
    const fullEnd =
      Number(srcObj.endSeconds) > startSec
        ? Math.round(Number(srcObj.endSeconds))
        : startSec + Math.max(30, Math.round(Number(srcObj.durationSeconds) || 300));
    const chosenEnd =
      allowShortCut && Number(srcObj.shortEndSeconds) > startSec
        ? Math.min(fullEnd, Math.round(Number(srcObj.shortEndSeconds)))
        : fullEnd;
    const durationSec = Math.max(20, chosenEnd - startSec);
    return {
      startSeconds: startSec,
      endSeconds: chosenEnd,
      durationSeconds: durationSec
    };
  }

  // -------------------- 日替わり股割り ＆ 5分瞑想ローテーション選出 --------------------
  function pickSmartStretch(dayKey) {
    const pool = getAllStretches();
    if (!pool.length) return null;
    const plan = getActivePlan(dayKey);
    const lastId = localStorage.getItem(STORAGE_KEYS.lastStretchId);
    const todaySeed = Math.floor(Date.now() / 86400000) + dayKey;
    let candidate = pool.find((s) => s.id === plan.defaultStretchId) || pool[todaySeed % pool.length];

    if (pool.length > 1 && candidate.id === lastId) {
      const idx = pool.findIndex((s) => s.id === candidate.id);
      candidate = pool[(idx + 1) % pool.length];
    }
    return candidate.id;
  }

  function pickSmartMeditation(dayKey) {
    const pool = getAllMeditations();
    if (!pool.length) return null;
    const plan = getActivePlan(dayKey);
    const lastId = localStorage.getItem(STORAGE_KEYS.lastMeditationId);
    const todaySeed = Math.floor(Date.now() / 86400000) + dayKey;
    let candidate = pool.find((m) => m.id === plan.defaultMeditationId) || pool[todaySeed % pool.length];

    if (pool.length > 1 && candidate.id === lastId) {
      const idx = pool.findIndex((m) => m.id === candidate.id);
      candidate = pool[(idx + 1) % pool.length];
    }
    return candidate.id;
  }

  // -------------------- タイムライン構築（通常40分 / 時短20分 / ケア15分 対応） --------------------
  function buildSessionSteps(dayKey, stretchIdOverride, meditationIdOverride) {
    const plan = getActivePlan(dayKey);
    const stretchPool = getAllStretches();
    const medPool = getAllMeditations();

    const chosenStretchId = stretchIdOverride || state.selectedStretchId || pickSmartStretch(dayKey);
    state.selectedStretchId = chosenStretchId;
    const stretchObj = stretchPool.find((s) => s.id === chosenStretchId) || stretchPool[0];

    const chosenMedId = meditationIdOverride || state.selectedMeditationId || pickSmartMeditation(dayKey);
    state.selectedMeditationId = chosenMedId;
    const medObj = medPool.find((m) => m.id === chosenMedId) || medPool[0];

    const durMode = state.durationMode || 'full';

    // ① 🧘 ケア＆瞑想 15分編成
    if (durMode === 'care') {
      const careSteps = [
        {
          kind: 'warmup',
          themePhase: 'PREP',
          phaseLabel: 'MORNING CARE PREP',
          title: '🌅 朝一リカバリー深呼吸 ＆ 肩・骨盤ゆらし',
          image: './images/exercises/warmup_shoulder_roll.jpg',
          actionSteps: ['① 鼻から4秒かけて深く吸う', '② 口から6秒かけて脱力しながら吐く', '③ 肩と股関節をやさしく揺らす'],
          subtitle: '無理に追い込まず、朝の関節ケアと自律神経リセットに特化したケア編成です。',
          setupNote: '今朝は身体を労わる15分ケア編成です。深い呼吸で全身に酸素を巡らせましょう。',
          durationSeconds: 35,
          pulley: 'ヨガマット / ベッド可',
          attachment: 'リカバリー・ケア編成',
          cues: ['疲労がある朝でも「ゼロにしない」ことが最大の継続力になります'],
          speechText: 'おはようございます！今朝は身体をいたわる15分ケア編成ですね。まずは深く息を吸って、肩と骨盤まわりをゆったりほぐしていきましょう。'
        }
      ];

      if (stretchObj) {
        const vt = resolveVideoTiming(stretchObj, { allowShortCut: false });
        careSteps.push({
          kind: 'video',
          isDailyStretch: true,
          isDailyMeditation: false,
          stretchId: stretchObj.id,
          themePhase: 'STRETCH',
          phaseLabel: 'PHASE 1: SPLIT & CARE',
          badge: `${stretchObj.badge}（朝一ケア編成）`,
          title: stretchObj.title,
          subtitle: `${stretchObj.channel}｜${stretchObj.focus}`,
          channel: stretchObj.channel,
          videoId: stretchObj.videoId,
          startSeconds: vt.startSeconds,
          endSeconds: vt.endSeconds,
          durationSeconds: vt.durationSeconds,
          safetyTip: '🤸 朝はまだ筋肉が硬めなので、痛気持ちいい6〜7割の伸びで呼吸を続けます',
          speechText:
            'それでは股割り・柔軟ケアに入りましょう。朝一番の身体をやさしく目覚めさせるように、息を吐きながら伸ばしていきますよ。'
        });
      }

      careSteps.push({
        kind: 'transition',
        themePhase: 'SETUP',
        phaseLabel: 'TRANSITION',
        title: 'ストレッチ完了！姿勢を整えて仕上げの5分間瞑想へ',
        image: './images/exercises/meditation_prep.jpg',
        actionSteps: ['① あぐら（または仰向け）で楽にする', '② 肩の力を抜き目を軽く閉じる', '③ 自然な鼻呼吸へ切り替える'],
        subtitle: '最後は5分間の瞑想で自律神経を整えて1日をスタートします。',
        setupNote: '最後は5分間の瞑想で頭をクリアに整えて朝のルーティン完了です。',
        durationSeconds: 20,
        pulley: 'ヨガマット（あぐら or 仰向け）',
        attachment: '5分間マインドフルネス瞑想',
        cues: ['膝が気になる場合は足を伸ばすか仰向けでもOKです'],
        speechText: 'ストレッチお疲れ様でした！最後は5分間の瞑想で、頭と自律神経をスッキリ整えていきましょう。'
      });

      if (medObj) {
        const mt = resolveVideoTiming(medObj, { allowShortCut: false });
        careSteps.push({
          kind: 'video',
          isDailyStretch: false,
          isDailyMeditation: true,
          meditationId: medObj.id,
          themePhase: 'MEDITATION',
          phaseLabel: 'PHASE 2: 5min MEDITATION',
          badge: `${medObj.badge}`,
          title: medObj.title,
          subtitle: `${medObj.channel}｜${medObj.focus}`,
          channel: medObj.channel,
          videoId: medObj.videoId,
          startSeconds: mt.startSeconds,
          endSeconds: mt.endSeconds,
          durationSeconds: mt.durationSeconds,
          safetyTip: '🧘 5分間瞑想：目を閉じて肩の力を抜き、ゆっくりと自然な呼吸に意識を向けます',
          speechText:
            medObj.speech ||
            '仕上げの5分間は、マイ瞑想音楽、の時間です。ゆっくりと深い呼吸を続けながら、穏やかな時間をお過ごしください。'
        });
      }
      return careSteps;
    }

    // ② ⏱️ 通常フル(40分) または ⚡ 時短ショート(20分)
    const isShort = durMode === 'short';
    const hasMachineBlocks = plan.blocks.some((b) => b.type === 'machine');

    const steps = [];
    const restVoices = [
      '休憩しましょう！深く息を吸って、ゆっくり吐いてくださいね。',
      'インターバルです。肩の力を抜いてリラックスしましょうね。',
      'いいペースですよ！呼吸を整えて、次のセットに備えましょう。'
    ];
    const setStartVoices = {
      2: 'セット2、いきましょう！イラストの矢印を意識して丁寧に動かしますよ。スタート！',
      3: 'セット3です！きつくなってきたところからが一番効きますよ、一緒に頑張りましょう！',
      4: 'ラスト、セット4です！反動を使わずに最後まで絞り切っていきましょう。スタートです！'
    };

    let lastFinishedMachine = null;
    let shortNonMachineVideoCount = 0;

    plan.blocks.forEach((block, blockIdx) => {
      if (isShort) {
        if (hasMachineBlocks) {
          if (block.type === 'video') return;
          const nextBlock = plan.blocks[blockIdx + 1];
          if (block.type === 'transition' && nextBlock && nextBlock.type === 'video') return;
        } else {
          if (block.type === 'video') {
            shortNonMachineVideoCount += 1;
            if (shortNonMachineVideoCount > 1 && plan.blocks.some((b) => b.type === 'daily_stretch')) {
              return;
            }
            if (shortNonMachineVideoCount > 2) return;
          }
        }
      }

      if (block.type === 'warmup' || block.type === 'setup' || block.type === 'transition') {
        const themePhase = block.type === 'warmup' ? 'PREP' : 'SETUP';
        const durSec = isShort ? Math.min(block.durationSeconds, block.type === 'transition' ? 22 : 30) : block.durationSeconds;
        const stepObj = {
          kind: block.type,
          themePhase,
          phaseLabel: block.phase,
          title: block.title,
          image: block.image || './images/exercises/warmup_shoulder_roll.jpg',
          actionSteps: block.actionSteps || [],
          subtitle: block.setupNote,
          setupNote: block.setupNote,
          durationSeconds: durSec,
          pulley: block.pulley || 'マット / 準備',
          attachment: block.attachment || '準備・移動',
          cues: block.cues || [],
          speechText: block.speech || `${block.title}。${block.setupNote || ''}`
        };
        if (lastFinishedMachine) {
          stepObj.prevExerciseId = lastFinishedMachine.id;
          stepObj.prevExerciseTitle = lastFinishedMachine.title;
          stepObj.prevDefaultPlates = lastFinishedMachine.defaultPlates;
          stepObj.prevHidePlates = Boolean(lastFinishedMachine.hidePlates);
          stepObj.prevTotalSets = lastFinishedMachine.totalSets || lastFinishedMachine.sets || 3;
        }
        lastFinishedMachine = null;
        steps.push(stepObj);
      } else if (block.type === 'machine') {
        const switchHalfway = block.title.includes('前半右・後半左');
        const totalSets = isShort ? Math.min(2, block.sets) : block.sets;
        const workSec = isShort ? Math.min(40, block.workSeconds) : block.workSeconds;
        const restSec = isShort ? Math.min(35, block.restSeconds) : block.restSeconds;

        for (let s = 1; s <= totalSets; s++) {
          steps.push({
            kind: 'work',
            themePhase: 'WORK',
            phaseLabel: isShort ? `${block.phase} (時短2Set)` : block.phase,
            exerciseId: block.id,
            hidePlates: Boolean(block.hidePlates),
            switchHalfway,
            title: block.title,
            image: block.image || './images/exercises/irotec_chest_wide.jpg',
            actionSteps: block.actionSteps || [],
            subtitle: `${block.targetMuscle}｜セット ${s} / ${totalSets}`,
            setIndex: s,
            totalSets,
            durationSeconds: workSec,
            defaultPlates: block.defaultPlates,
            pulley: block.pulley,
            attachment: block.attachment,
            demoRange: block.demoRange || [122, 132],
            setupNote: block.setupNote,
            cues: block.cues || [],
            speechText:
              s === 1
                ? block.speechIntro || `${block.title}、スタートです！`
                : setStartVoices[s] || `セット${s}、スタートです！`
          });

          if (s < totalSets) {
            steps.push({
              kind: 'rest',
              themePhase: 'REST',
              phaseLabel: 'REST / インターバル',
              exerciseId: block.id,
              hidePlates: Boolean(block.hidePlates),
              title: `${block.title}（休憩）`,
              image: block.image || './images/exercises/irotec_chest_wide.jpg',
              actionSteps: ['① 深い呼吸で酸素を送る', `② 次は セット ${s + 1} / ${totalSets}`, '③ セット別の重量・回数も記録OK'],
              subtitle: `次は セット ${s + 1} / ${totalSets}`,
              setIndex: s,
              totalSets,
              durationSeconds: restSec,
              defaultPlates: block.defaultPlates,
              pulley: block.pulley,
              attachment: block.attachment,
              demoRange: block.demoRange || [122, 132],
              setupNote: restVoices[(s - 1) % restVoices.length],
              cues: block.cues || [],
              speechText: restVoices[(s - 1) % restVoices.length]
            });
          }
        }
        lastFinishedMachine = { ...block, totalSets };
      } else if (block.type === 'video') {
        lastFinishedMachine = null;
        const isRelaxOrStretch =
          block.phase.includes('YOGA') ||
          block.phase.includes('STRETCH') ||
          block.phase.includes('MOBILITY') ||
          block.phase.includes('RELEASE') ||
          block.phase.includes('RESET') ||
          block.phase.includes('SPLIT') ||
          block.phase.includes('HIP');
        const vt = resolveVideoTiming(block, { allowShortCut: isShort });
        steps.push({
          kind: 'video',
          isDailyStretch: false,
          isDailyMeditation: false,
          themePhase: isRelaxOrStretch ? 'STRETCH' : 'HIIT',
          phaseLabel: block.phase,
          badge: block.badge || block.phase,
          title: block.title,
          subtitle: `${block.channel}｜${block.note || ''}`,
          channel: block.channel,
          videoId: block.videoId,
          startSeconds: vt.startSeconds,
          endSeconds: vt.endSeconds,
          durationSeconds: vt.durationSeconds,
          safetyTip: isRelaxOrStretch
            ? '🧘 呼吸を止めず、膝に違和感がある角度は無理せず緩めてキープ'
            : '🛡️ 膝保護：スクワット・ジャンプが出たら上半身パンチやツイストに置換OK',
          speechText: block.speech || `${block.title}、スタートです！`
        });
      } else if (block.type === 'daily_stretch' && stretchObj) {
        lastFinishedMachine = null;
        const vt = resolveVideoTiming(stretchObj, { allowShortCut: isShort });
        const shortLabel =
          isShort && vt.durationSeconds < stretchObj.durationSeconds
            ? `（時短約${Math.round(vt.durationSeconds / 60)}分）`
            : '（日替わり選出）';
        steps.push({
          kind: 'video',
          isDailyStretch: true,
          isDailyMeditation: false,
          stretchId: stretchObj.id,
          themePhase: 'STRETCH',
          phaseLabel: block.phase,
          badge: `${stretchObj.badge}${shortLabel}`,
          title: stretchObj.title,
          subtitle: `${stretchObj.channel}｜${stretchObj.focus}`,
          channel: stretchObj.channel,
          videoId: stretchObj.videoId,
          startSeconds: vt.startSeconds,
          endSeconds: vt.endSeconds,
          durationSeconds: vt.durationSeconds,
          safetyTip: '🤸 股割りタイム：痛気持ちいい7割の伸びで、吐く息ごとに力を抜きます',
          speechText: `本日の股割りストレッチは、${stretchObj.category}、のメニューです！息をふーっと吐きながら、気持ちよく伸ばしていきましょうね。`
        });
      } else if (block.type === 'daily_meditation' && medObj) {
        lastFinishedMachine = null;
        const mt = resolveVideoTiming(medObj, { allowShortCut: false });
        steps.push({
          kind: 'video',
          isDailyStretch: false,
          isDailyMeditation: true,
          meditationId: medObj.id,
          themePhase: 'MEDITATION',
          phaseLabel: block.phase,
          badge: `${medObj.badge}`,
          title: medObj.title,
          subtitle: `${medObj.channel}｜${medObj.focus}`,
          channel: medObj.channel,
          videoId: medObj.videoId,
          startSeconds: mt.startSeconds,
          endSeconds: mt.endSeconds,
          durationSeconds: mt.durationSeconds,
          safetyTip: '🧘 5分間瞑想：目を閉じて肩の力を抜き、ゆっくりと自然な呼吸に意識を向けます',
          speechText:
            medObj.speech ||
            '仕上げの5分間は、マイ瞑想音楽、の時間です。ゆっくりと深い呼吸を続けながら、穏やかな時間をお過ごしください。'
        });
      }
    });

    return steps;
  }

  // -------------------- ショウコさん音声 --------------------
  function ensureAudioUnlocked() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !state.audioCtx) {
        state.audioCtx = new AC();
      }
      if (state.audioCtx && state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }
      state.shokoAudio.muted = false;
    } catch (_) {}
  }

  function playBeep(freq = 880, durationMs = 110, gainVal = 0.12) {
    if (!state.voiceEnabled || !state.audioCtx) return;
    try {
      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainVal, state.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(state.audioCtx.destination);
      osc.start();
      osc.stop(state.audioCtx.currentTime + durationMs / 1000);
    } catch (_) {}
  }

  function playCalmChime() {
    if (!state.voiceEnabled || !state.audioCtx) return;
    [528, 660, 792].forEach((f, idx) => {
      setTimeout(() => playBeep(f, 420, 0.09), idx * 240);
    });
  }

  function speakShoko(text) {
    if (!state.voiceEnabled || !text) return;
    const clean = text.trim();
    if (!clean) return;

    try {
      state.shokoAudio.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();

      const staticMp3 = STATIC_VOICES[clean];
      const isStaticHost = window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:';
      const audioSrc = staticMp3 || (!isStaticHost ? `/api/tts?text=${encodeURIComponent(clean)}` : null);

      if (!audioSrc) {
        fallbackBrowserSpeech(clean);
        return;
      }

      state.shokoAudio.src = audioSrc;
      el.shokoAvatar?.classList.add('speaking');

      state.shokoAudio.onended = () => {
        el.shokoAvatar?.classList.remove('speaking');
      };
      state.shokoAudio.onerror = () => {
        el.shokoAvatar?.classList.remove('speaking');
        fallbackBrowserSpeech(clean);
      };

      const p = state.shokoAudio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          el.shokoAvatar?.classList.remove('speaking');
        });
      }
    } catch (_) {
      fallbackBrowserSpeech(clean);
    }
  }

  function fallbackBrowserSpeech(text) {
    if (!state.voiceEnabled || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  function prefetchSessionVoices() {
    if (
      !window.location.protocol.startsWith('http') ||
      window.location.hostname.endsWith('github.io')
    ) {
      return;
    }

    const unmapped = [];
    const seen = new Set();
    const checkTxt = (t) => {
      const clean = (t || '').trim();
      if (clean && !STATIC_VOICES[clean] && !seen.has(clean)) {
        seen.add(clean);
        unmapped.push(clean);
      }
    };

    state.steps.forEach((s) => {
      checkTxt(s.speechText);
      if (s.switchHalfway) {
        checkTxt('はい、ここで左右の手を入れ替えましょう！反対側も丁寧に効かせていきますよ！');
      }
    });
    checkTxt('瞑想まで含めたフルセッション完走、本当にお疲れ様でした！体も心もスッキリ整いましたね。最後に今日の記録も残しておきましょう！');

    if (!unmapped.length) return;

    fetch('/api/tts/prefetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: unmapped })
    }).catch(() => {});
  }

  // -------------------- Screen Wake Lock --------------------
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      el.wakeIndicator.textContent = '📱 常時表示推奨';
      return;
    }
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      el.wakeIndicator.textContent = '💡 画面スリープ防止 ON';
    } catch (_) {
      el.wakeIndicator.textContent = '📱 スリープ防止待機';
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.isRunning) {
      requestWakeLock();
    }
  });

  // -------------------- YouTube IFrame API & Locked Timer Sync --------------------
  function initYouTubeApi() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  function autoAdvanceFromVideo(stepRef) {
    if (!state.isRunning) return;
    if (state.steps[state.currentIndex] !== stepRef) return;
    if (state.lastAutoAdvancedStep === stepRef) return;
    state.lastAutoAdvancedStep = stepRef;
    advanceStep(1);
  }

  window.onYouTubeIframeAPIReady = function () {
    const vars = {
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      controls: 1,
      enablejsapi: 1
    };
    if (window.location.protocol.startsWith('http')) {
      vars.origin = window.location.origin;
    }

    state.ytPlayer = new window.YT.Player('ytPlayer', {
      videoId: DATA.irotecDemoVideoId,
      playerVars: vars,
      events: {
        onReady: () => {
          state.ytReady = true;
          state.ytPlayer.mute();
          if (state.pendingVideoLoad) {
            const fn = state.pendingVideoLoad;
            state.pendingVideoLoad = null;
            fn();
          }
        },
        onStateChange: (ev) => {
          const step = state.steps[state.currentIndex];
          if (!step) return;

          if (ev.data === window.YT.PlayerState.PLAYING) {
            el.ytUnblockBtn.classList.add('hidden');
            state.ytStepFailed = false;

            if (step.kind === 'video' && !state.videoStepSeekVerified) {
              state.videoStepSeekVerified = true;
              const expectedStart = step.startSeconds || 0;
              const cur = state.ytPlayer.getCurrentTime ? state.ytPlayer.getCurrentTime() : expectedStart;
              if (cur < expectedStart - 1.5 || cur > expectedStart + 6) {
                try {
                  state.ytPlayer.seekTo(expectedStart, true);
                } catch (_) {}
              }
            }
          }

          if (ev.data === window.YT.PlayerState.ENDED && step.kind === 'video' && state.isRunning) {
            autoAdvanceFromVideo(step);
          }
        },
        onError: () => {
          state.ytStepFailed = true;
          el.ytUnblockBtn.classList.add('hidden');
        }
      }
    });
  };

  function syncYouTubeForStep(step, autoPlayNow) {
    clearInterval(state.demoLoopHandle);
    el.ytUnblockBtn.classList.add('hidden');
    state.ytStepFailed = false;
    state.videoStepSeekVerified = false;

    const run = () => {
      if (!state.ytPlayer || typeof state.ytPlayer.loadVideoById !== 'function') return;

      if (step.kind === 'video') {
        const startSec = step.startSeconds || 0;
        const endSec = step.endSeconds || startSec + step.durationSeconds;
        if (autoPlayNow) {
          state.ytPlayer.loadVideoById({
            videoId: step.videoId,
            startSeconds: startSec,
            endSeconds: endSec
          });
          state.ytPlayer.unMute();
          state.ytPlayer.setVolume(step.themePhase === 'MEDITATION' ? 85 : 100);
          state.ytPlayer.playVideo();

          setTimeout(() => {
            if (!state.isRunning || state.steps[state.currentIndex] !== step) return;
            const pState = state.ytPlayer.getPlayerState ? state.ytPlayer.getPlayerState() : -1;
            if (pState !== window.YT.PlayerState.PLAYING && pState !== window.YT.PlayerState.BUFFERING) {
              el.ytUnblockBtn.classList.remove('hidden');
            }
          }, 2400);
        } else {
          state.ytPlayer.cueVideoById({
            videoId: step.videoId,
            startSeconds: startSec,
            endSeconds: endSec
          });
        }
      } else {
        const [dStart, dEnd] = step.demoRange || [122, 132];
        if (state.showDemoPip && state.locationMode === 'home') {
          state.ytPlayer.mute();
          state.ytPlayer.loadVideoById({
            videoId: DATA.irotecDemoVideoId,
            startSeconds: dStart
          });
          state.ytPlayer.playVideo();
          state.demoLoopHandle = setInterval(() => {
            if (!state.ytPlayer || !state.showDemoPip) return;
            const cur = state.ytPlayer.getCurrentTime ? state.ytPlayer.getCurrentTime() : 0;
            if (cur >= dEnd - 0.2 || cur < dStart - 1.5) {
              state.ytPlayer.seekTo(dStart, true);
            }
          }, 500);
        } else {
          try {
            state.ytPlayer.mute();
            state.ytPlayer.pauseVideo();
          } catch (_) {}
        }
      }
    };

    if (state.ytReady) {
      run();
    } else {
      state.pendingVideoLoad = run;
    }
  }

  // -------------------- UI Rendering --------------------
  function renderLocationToggle() {
    el.locHomeBtn.classList.toggle('active', state.locationMode === 'home');
    el.locHotelBtn.classList.toggle('active', state.locationMode === 'hotel');
  }

  function renderDurationToggle() {
    if (!el.durFullBtn) return;
    el.durFullBtn.classList.toggle('active', state.durationMode === 'full');
    el.durShortBtn.classList.toggle('active', state.durationMode === 'short');
    el.durCareBtn.classList.toggle('active', state.durationMode === 'care');

    if (el.heroStartBtn) {
      if (state.durationMode === 'short') {
        el.heroStartBtn.textContent = '▶ 朝一スタート（⚡時短20分：2Set＋股割り＋5分瞑想）';
      } else if (state.durationMode === 'care') {
        el.heroStartBtn.textContent = '▶ 朝一スタート（🧘ケア15分：股割り＋5分瞑想）';
      } else {
        el.heroStartBtn.textContent = '▶ 朝一セッション開始（筋トレ・股割り・5分瞑想）';
      }
    }
  }

  function renderMorningCondition() {
    if (!el.morningConditionBar) return;
    const mc = state.morningCondition;
    if (!mc || !mc.badge) {
      el.morningConditionBar.classList.add('hidden');
      return;
    }

    el.morningConditionBar.classList.remove('hidden', 'tier-boost', 'tier-recovery');
    if (mc.tier === 'boost') el.morningConditionBar.classList.add('tier-boost');
    if (mc.tier === 'recovery') el.morningConditionBar.classList.add('tier-recovery');

    el.mcBadge.textContent = mc.badge;
    el.mcVitals.textContent = mc.vitalsSummary || '';
    el.mcMessage.textContent = mc.message || '';

    if (mc.tier === 'recovery' && state.durationMode === 'full') {
      el.mcActionBtn.classList.remove('hidden');
      el.mcActionBtn.textContent = mc.recommendedMode === 'care' ? '🧘 ケア15mへ切替' : '⚡ 時短20mへ切替';
      el.mcActionBtn.dataset.targetMode = mc.recommendedMode || 'short';
    } else if (state.durationMode !== 'full') {
      el.mcActionBtn.classList.remove('hidden');
      el.mcActionBtn.textContent =
        state.durationMode === 'short' ? '✓ 時短20m中 (通常へ)' : '✓ ケア15m中 (通常へ)';
      el.mcActionBtn.dataset.targetMode = 'full';
    } else {
      el.mcActionBtn.classList.add('hidden');
      el.mcActionBtn.dataset.targetMode = '';
    }
  }

  function renderDaySwitcher() {
    const order = [1, 2, 3, 4, 5, 6, 0];
    el.daySwitcher.innerHTML = '';
    order.forEach((dKey) => {
      const p = getActivePlan(dKey);
      const btn = document.createElement('button');
      btn.className = 'day-pill' + (dKey === state.selectedDay ? ' active' : '');
      const cleanShort = p.shortTheme.replace('(ホテル)', '').replace(' 集中', '');
      btn.textContent = `${p.dayLabel.replace('曜', '')}:${cleanShort.slice(0, 4)}`;
      btn.title = `${p.dayLabel}｜${p.title}`;
      btn.addEventListener('click', () => {
        if (state.selectedDay === dKey) return;
        selectDay(dKey);
      });
      el.daySwitcher.appendChild(btn);
    });
    requestAnimationFrame(() => {
      const act = el.daySwitcher.querySelector('.day-pill.active');
      if (act && typeof act.scrollIntoView === 'function') {
        act.scrollIntoView({ block: 'nearest', inline: 'center' });
      }
    });
  }

  function renderOverallProgress() {
    const totalRemaining =
      state.steps.slice(state.currentIndex + 1).reduce((acc, s) => acc + s.durationSeconds, 0) +
      state.remainingSec;

    el.overallStepText.textContent = `STEP ${state.currentIndex + 1} / ${state.steps.length}`;
    el.overallRemainText.textContent = `残り ${formatMMSS(totalRemaining)}`;

    el.overallProgressBar.innerHTML = '';
    const totalAll = state.steps.reduce((a, s) => a + s.durationSeconds, 0) || 1;
    const colMap = {
      WORK: 'var(--col-work)',
      REST: 'var(--col-rest)',
      SETUP: 'var(--col-setup)',
      PREP: 'var(--col-setup)',
      HIIT: 'var(--col-hiit)',
      STRETCH: 'var(--col-stretch)',
      MEDITATION: 'var(--col-meditation)'
    };

    state.steps.forEach((s, idx) => {
      const seg = document.createElement('div');
      seg.className =
        'seg-item' +
        (idx < state.currentIndex ? ' done' : '') +
        (idx === state.currentIndex ? ' current' : '');
      seg.style.width = `${Math.max(1.2, (s.durationSeconds / totalAll) * 100)}%`;
      seg.style.background = colMap[s.themePhase] || 'var(--col-work)';
      el.overallProgressBar.appendChild(seg);
    });
  }

  function resolveActiveExerciseTarget(step) {
    if (!step || step.kind === 'video') return null;

    if (step.exerciseId) {
      return {
        exerciseId: step.exerciseId,
        title: step.title.replace(/（休憩）$/, ''),
        defaultPlates: step.defaultPlates || 5,
        hidePlates: Boolean(step.hidePlates || state.locationMode === 'hotel'),
        setIndex: step.setIndex || 1,
        totalSets: step.totalSets || 3,
        cues: step.cues || [],
        isLiveSet: true
      };
    }

    if ((step.kind === 'setup' || step.kind === 'transition') && step.prevExerciseId) {
      return {
        exerciseId: step.prevExerciseId,
        title: step.prevExerciseTitle || step.prevExerciseId,
        defaultPlates: step.prevDefaultPlates || 5,
        hidePlates: Boolean(step.prevHidePlates || state.locationMode === 'hotel'),
        setIndex: step.prevTotalSets || 3,
        totalSets: step.prevTotalSets || 3,
        cues: step.cues || [],
        isLiveSet: true,
        isPostExercise: true
      };
    }

    // 自宅でも出張ホテルでも、スタート前・ウォームアップ時から最初の種目の負荷＆回数を事前確認・調整可能にする
    const upcoming = state.steps
      .slice(state.currentIndex + 1)
      .find((s) => Boolean(s.exerciseId));
    if (upcoming) {
      return {
        exerciseId: upcoming.exerciseId,
        title: upcoming.title,
        defaultPlates: upcoming.defaultPlates || 5,
        hidePlates: Boolean(upcoming.hidePlates || state.locationMode === 'hotel'),
        setIndex: 1,
        totalSets: upcoming.totalSets || 3,
        cues: upcoming.cues || step.cues || [],
        isLiveSet: false
      };
    }
    return null;
  }

  function getActiveEditingSetIndex(target) {
    if (!target) return 1;
    if (
      state.editingSetExId === target.exerciseId &&
      Number.isFinite(state.editingSetOverride) &&
      state.editingSetOverride >= 1 &&
      state.editingSetOverride <= target.totalSets
    ) {
      return state.editingSetOverride;
    }
    return target.setIndex || 1;
  }

  function resolveRpeTargetForStep(step) {
    if (!step) return null;
    if (step.kind === 'rest' && step.exerciseId) {
      return {
        exerciseId: step.exerciseId,
        title: step.title.replace(/（休憩）$/, ''),
        defaultPlates: step.defaultPlates || 5,
        hidePlates: Boolean(step.hidePlates || state.locationMode === 'hotel'),
        setIndex: step.setIndex || 1,
        totalSets: step.totalSets || 3
      };
    }
    if (step.kind === 'work' && step.exerciseId && step.setIndex === step.totalSets) {
      return {
        exerciseId: step.exerciseId,
        title: step.title,
        defaultPlates: step.defaultPlates || 5,
        hidePlates: Boolean(step.hidePlates || state.locationMode === 'hotel'),
        setIndex: step.setIndex || 1,
        totalSets: step.totalSets || 3
      };
    }
    if ((step.kind === 'setup' || step.kind === 'transition') && step.prevExerciseId) {
      return {
        exerciseId: step.prevExerciseId,
        title: step.prevExerciseTitle || step.prevExerciseId,
        defaultPlates: step.prevDefaultPlates || 5,
        hidePlates: Boolean(step.prevHidePlates || state.locationMode === 'hotel'),
        setIndex: step.prevTotalSets || 3,
        totalSets: step.prevTotalSets || 3
      };
    }
    return null;
  }

  function renderSetLogStrip(activeTarget) {
    if (!el.setLogStrip) return;
    if (!activeTarget || activeTarget.totalSets < 1) {
      el.setLogStrip.classList.add('hidden');
      el.setLogStrip.innerHTML = '';
      return;
    }

    const total = activeTarget.totalSets;
    const editingSet = getActiveEditingSetIndex(activeTarget);
    el.setLogStrip.classList.remove('hidden');
    el.setLogStrip.style.setProperty('--set-cols', String(total));
    el.setLogStrip.innerHTML = '';

    for (let s = 1; s <= total; s++) {
      const entry = getTodaySetEntry(activeTarget.exerciseId, s);
      const hasRep = entry && entry.reps !== null;
      const isEditing = s === editingSet;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'set-log-chip' +
        (hasRep ? ' recorded' : '') +
        (isEditing ? ' editing' : '');

      if (activeTarget.hidePlates) {
        const effLv = getEffectiveLoadLevelForSet(activeTarget.exerciseId, s);
        btn.textContent = hasRep ? `S${s} Lv${effLv}×${entry.reps}` : `S${s} Lv${effLv}`;
        btn.title = `タップして Set ${s} の負荷Lv・回数を編集`;
      } else {
        const effP = getEffectivePlatesForSet(activeTarget.exerciseId, s, activeTarget.defaultPlates);
        btn.textContent = hasRep ? `S${s} ${effP}枚×${entry.reps}` : `S${s} ${effP}枚`;
        btn.title = `タップして Set ${s} の重量・回数を編集`;
      }
      btn.addEventListener('click', () => {
        state.editingSetExId = activeTarget.exerciseId;
        state.editingSetOverride = s;
        renderCurrentStep();
      });
      el.setLogStrip.appendChild(btn);
    }
  }

  function renderOverloadAndRpe(step, activeTarget) {
    // 1. 漸進性過負荷（ピン＋1枚 / ホテル負荷＋1Lv提案）バナー
    if (el.overloadBanner) {
      el.overloadBanner.classList.add('hidden');
      if (activeTarget && !activeTarget.isPostExercise) {
        const exId = activeTarget.exerciseId;
        const isWeightEx = !activeTarget.hidePlates && Boolean(HOME_PLATE_EXERCISES[exId]);
        const rpe = state.rpeMap[exId] || {};
        const todayIso = getTodayJst();

        if (isWeightEx) {
          const curMaxPlates = computeMaxPlatesForExercise(exId, activeTarget.defaultPlates);
          if (
            Number(rpe.easyStreak || 0) >= 2 &&
            !hasSubTenOrDroppedWeight(exId, true) &&
            rpe.lastUpgradeDate !== todayIso &&
            curMaxPlates < DATA.maxPlates
          ) {
            const nextPlates = curMaxPlates + 1;
            const nextDet = formatPlateDetail(nextPlates);
            el.overloadBanner.classList.remove('hidden');
            el.overloadBanner.dataset.exerciseId = exId;
            el.overloadBanner.dataset.nextPlates = String(nextPlates);
            el.overloadBanner.dataset.isWeightEx = '1';
            el.overloadBanner.dataset.exerciseName = activeTarget.title;
            el.overloadText.textContent = `🚀 全Set10回＆${rpe.easyStreak}連続「余裕😊」！${curMaxPlates}→${nextPlates}枚目(${nextDet.kg}kg)へ上げますか？`;
          }
        } else {
          const curMaxLv = computeMaxLoadLevelForExercise(exId);
          if (
            Number(rpe.easyStreak || 0) >= 2 &&
            !hasSubTenOrDroppedWeight(exId, false) &&
            rpe.lastUpgradeDate !== todayIso &&
            curMaxLv < MAX_LOAD_LV
          ) {
            const nextLv = curMaxLv + 1;
            const nextMeta = formatLoadLevelDetail(nextLv);
            el.overloadBanner.classList.remove('hidden');
            el.overloadBanner.dataset.exerciseId = exId;
            el.overloadBanner.dataset.nextPlates = String(nextLv);
            el.overloadBanner.dataset.isWeightEx = '0';
            el.overloadBanner.dataset.exerciseName = activeTarget.title;
            el.overloadText.textContent = `🚀 全Setクリア＆${rpe.easyStreak}連続「余裕😊」！Lv.${curMaxLv}→Lv.${nextLv}(${nextMeta.short})へ上げますか？`;
          }
        }
      }
    }

    // 2. セット別回数1タップ ＆ 手応えワンタップ（自宅・ホテル両対応）
    if (el.rpeFeedbackBox) {
      const target = resolveRpeTargetForStep(step);
      if (!target) {
        el.rpeFeedbackBox.classList.add('hidden');
      } else {
        const targetSetIdx =
          state.editingSetExId === target.exerciseId &&
          Number.isFinite(state.editingSetOverride) &&
          state.editingSetOverride >= 1 &&
          state.editingSetOverride <= target.totalSets
            ? state.editingSetOverride
            : target.setIndex || 1;

        el.rpeFeedbackBox.classList.remove('hidden');
        el.rpeFeedbackBox.dataset.exerciseId = target.exerciseId;
        el.rpeFeedbackBox.dataset.exerciseName = target.title;
        el.rpeFeedbackBox.dataset.defaultPlates = String(target.defaultPlates || 5);
        el.rpeFeedbackBox.dataset.setIndex = String(targetSetIdx);
        el.rpeFeedbackBox.dataset.hidePlates = target.hidePlates ? '1' : '0';

        const shortName = cleanExerciseShortTitle(target.title);
        if (step.kind === 'setup' || step.kind === 'transition') {
          el.rpeHeadingTitle.textContent = `直前「${shortName}」Set ${targetSetIdx}`;
        } else {
          el.rpeHeadingTitle.textContent = `Set ${targetSetIdx} 回数 ＆ 手応え`;
        }

        const setEntry = getTodaySetEntry(target.exerciseId, targetSetIdx);
        const setRepVal = setEntry ? setEntry.reps : null;
        if (el.repQuickRow) {
          el.repQuickRow.querySelectorAll('.rep-pill').forEach((pill) => {
            pill.classList.toggle('selected', setRepVal !== null && Number(pill.dataset.reps) === setRepVal);
          });
        }

        const isHomeWeightEx = !target.hidePlates && Boolean(HOME_PLATE_EXERCISES[target.exerciseId]);
        if (el.rpeBtnRow) {
          el.rpeBtnRow.classList.remove('hidden');
        }

        const rpeInfo = state.rpeMap[target.exerciseId] || {};
        const todayIso = getTodayJst();
        const ratedToday = rpeInfo.lastRatedDate === todayIso ? rpeInfo.lastRpe : null;

        el.rpeBtnRow.querySelectorAll('.rpe-btn').forEach((btn) => {
          btn.classList.toggle('selected', Boolean(ratedToday && btn.dataset.rpe === ratedToday));
        });

        const streak = Number(rpeInfo.easyStreak || 0);
        const maxLabel = isHomeWeightEx
          ? `最高${computeMaxPlatesForExercise(target.exerciseId, target.defaultPlates)}枚`
          : `最高Lv.${computeMaxLoadLevelForExercise(target.exerciseId)}`;
        const upUnit = isHomeWeightEx ? '＋1枚' : '＋1Lv';

        if (hasSubTenOrDroppedWeight(target.exerciseId, isHomeWeightEx)) {
          el.rpeStreakHint.textContent = `🎯 次回初期: ${maxLabel}`;
        } else if (streak >= 2) {
          el.rpeStreakHint.textContent = `🔥 次回${upUnit}提案ON！`;
        } else if (streak === 1) {
          el.rpeStreakHint.textContent = `✨ あと1回「余裕」で${upUnit}提案`;
        } else if (ratedToday) {
          el.rpeStreakHint.textContent = `✓ 次回初期: ${maxLabel}`;
        } else {
          el.rpeStreakHint.textContent = `10回×余裕2連続で${upUnit}提案`;
        }
      }
    }
  }

  function renderCurrentStep() {
    const plan = getActivePlan(state.selectedDay);
    const step = state.steps[state.currentIndex];
    if (!step) return;

    el.body.dataset.phase = state.hasStartedOnce ? step.themePhase : 'IDLE';

    const locBadge =
      state.locationMode === 'hotel' && state.selectedDay >= 1 && state.selectedDay <= 5
        ? '🏨 ホテル｜'
        : '🏠 自宅｜';
    const durSuffix =
      state.durationMode === 'short' ? ' [⚡時短20m]' : state.durationMode === 'care' ? ' [🧘ケア15m]' : '';
    el.dayTag.textContent = `${locBadge}${plan.dayLabel}・${plan.shortTheme}${durSuffix}`;
    el.workoutMainTitle.textContent = step.title;
    el.idleHeroBanner.classList.toggle('hidden', state.hasStartedOnce);

    const canShowIrotecDemo =
      state.locationMode === 'home' &&
      state.durationMode !== 'care' &&
      state.selectedDay !== 3 &&
      state.selectedDay !== 6 &&
      state.selectedDay !== 0;
    el.toggleDemoPipBtn.classList.toggle('hidden', !canShowIrotecDemo);

    const isVideoStep = step.kind === 'video';
    el.stagePane.classList.toggle('mode-video', isVideoStep);
    el.stagePane.classList.toggle('show-demo-pip', !isVideoStep && state.showDemoPip && canShowIrotecDemo);
    el.toggleDemoPipBtn.classList.toggle('active', state.showDemoPip && canShowIrotecDemo);

    if (isVideoStep) {
      el.ytBadge.textContent = step.badge || step.phaseLabel;
      el.ytSafetyTip.textContent = step.safetyTip || '';
    } else {
      if (step.image && el.exerciseGuideImg.getAttribute('src') !== step.image) {
        el.exerciseGuideImg.src = step.image;
      }
      el.hwPulley.textContent = step.pulley || 'マット / 準備';
      el.hwAttachment.textContent = step.attachment || '--';

      if (step.exerciseId && !step.hidePlates && state.locationMode === 'home') {
        const sIdx = step.setIndex || 1;
        const curPlates = getEffectivePlatesForSet(step.exerciseId, sIdx, step.defaultPlates);
        const maxPlates = computeMaxPlatesForExercise(step.exerciseId, step.defaultPlates);
        const detail = formatPlateDetail(curPlates);
        const curReps = getEffectiveRepsForSet(step.exerciseId, sIdx, 10);
        const maxNote = maxPlates > curPlates ? ` [最高${maxPlates}枚]` : '';
        el.hwPinDisplay.classList.remove('hidden');
        el.hwPinDisplay.textContent = `Set${sIdx} ピン：${curPlates}枚目 (約${detail.kg}kg) × ${curReps}回${maxNote}`;
      } else if (step.exerciseId) {
        const sIdx = step.setIndex || 1;
        const curLv = getEffectiveLoadLevelForSet(step.exerciseId, sIdx);
        const maxLv = computeMaxLoadLevelForExercise(step.exerciseId);
        const lvMeta = formatLoadLevelDetail(curLv);
        const curReps = getEffectiveRepsForSet(step.exerciseId, sIdx, 12);
        const maxNote = maxLv > curLv ? ` [最高Lv.${maxLv}]` : '';
        el.hwPinDisplay.classList.remove('hidden');
        el.hwPinDisplay.textContent = `Set${sIdx} 負荷：Lv.${curLv}(${lvMeta.short}) × ${curReps}回${maxNote}`;
      } else {
        const upcomingEx = state.steps
          .slice(state.currentIndex + 1)
          .find((s) => Boolean(s.exerciseId));
        if (upcomingEx && !upcomingEx.hidePlates && state.locationMode === 'home') {
          const maxPreset = getPresetPlatesForExercise(upcomingEx.exerciseId, upcomingEx.defaultPlates);
          const detail = formatPlateDetail(maxPreset);
          el.hwPinDisplay.classList.remove('hidden');
          el.hwPinDisplay.textContent = `次種目初期ピン（最高）：${maxPreset}枚目 (約${detail.kg}kg)`;
        } else if (upcomingEx) {
          const maxLv = getPresetLoadLevelForExercise(upcomingEx.exerciseId);
          const lvMeta = formatLoadLevelDetail(maxLv);
          el.hwPinDisplay.classList.remove('hidden');
          el.hwPinDisplay.textContent = `次種目初期負荷：Lv.${maxLv} (${lvMeta.short})`;
        } else {
          el.hwPinDisplay.classList.add('hidden');
        }
      }

      el.actionStepsRow.innerHTML = '';
      const chips = step.actionSteps && step.actionSteps.length ? step.actionSteps : (step.cues || []).slice(0, 3);
      chips.slice(0, 3).forEach((txt) => {
        const div = document.createElement('div');
        div.className = 'action-step-chip';
        div.textContent = txt;
        el.actionStepsRow.appendChild(div);
      });

      el.setupInstruction.textContent = step.speechText || step.setupNote || '';
    }

    el.phasePill.textContent = step.phaseLabel;
    el.currentStepTitle.textContent = step.title;
    el.currentStepSub.textContent = step.subtitle || '';

    el.setDots.innerHTML = '';
    if (step.totalSets) {
      for (let i = 1; i <= step.totalSets; i++) {
        const dot = document.createElement('span');
        dot.className = 'set-dot' + (i < step.setIndex ? ' done' : '') + (i === step.setIndex ? ' active' : '');
        el.setDots.appendChild(dot);
      }
      const txt = document.createElement('span');
      txt.textContent = `${step.setIndex}/${step.totalSets}`;
      el.setDots.appendChild(txt);
    }

    if (!state.isRunning) {
      el.timerStateLabel.textContent = state.hasStartedOnce
        ? '\\ PAUSED・一時停止中 /'
        : '\\ READY・朝一スタート待機中 /';
    } else if (step.totalSets) {
      el.timerStateLabel.textContent =
        step.kind === 'rest'
          ? `\\ 休憩中・次はセット ${step.setIndex + 1}/${step.totalSets} /`
          : `\\ セット ${step.setIndex}/${step.totalSets}・残り時間 /`;
    } else {
      const microMap = {
        WORK: '\\ 本番セット・残り時間 /',
        REST: '\\ インターバル休憩 /',
        SETUP: '\\ フォーム＆器具セット /',
        PREP: '\\ ウォームアップ準備 /',
        HIIT: '\\ 動画と一緒に燃焼中！ /',
        STRETCH: '\\ 股割り・深呼吸キープ /',
        MEDITATION: '\\ 仕上げ5分間・静かな瞑想 /'
      };
      el.timerStateLabel.textContent = microMap[step.themePhase] || '\\ ACTIVE /';
    }

    if (el.minus10Btn && el.plus15Btn) {
      el.minus10Btn.title = isVideoStep ? '動画を10秒先へ進める' : '残り時間を10秒減らす';
      el.plus15Btn.title = isVideoStep ? '動画を15秒巻き戻す' : '時間を15秒延長する';
    }

    updateTimerUI();

    const activeTarget = resolveActiveExerciseTarget(step);

    el.plateSelector.classList.add('hidden');
    el.hotelTipBox.classList.add('hidden');
    el.videoContextBox.classList.add('hidden');

    if (isVideoStep) {
      el.videoContextBox.classList.remove('hidden');
      el.videoChannelTag.textContent = `📺 ${step.channel || 'YouTube'}`;
      el.ytExternalLink.href = `https://www.youtube.com/watch?v=${step.videoId}&t=${step.startSeconds || 0}s`;
      const canShuffle = step.isDailyStretch || step.isDailyMeditation;
      el.shuffleStretchBtn.classList.toggle('hidden', !canShuffle);
      if (step.isDailyMeditation) {
        el.shuffleStretchBtn.textContent = '🎲 もう一方の瞑想音楽へ';
      } else {
        el.shuffleStretchBtn.textContent = '🎲 別の股割り動画へ';
      }
      if (el.rpeFeedbackBox) el.rpeFeedbackBox.classList.add('hidden');
    } else if (activeTarget) {
      el.plateSelector.classList.remove('hidden');
      renderSetLogStrip(activeTarget);

      const editSet = getActiveEditingSetIndex(activeTarget);
      const defReps = activeTarget.hidePlates ? 12 : 10;
      const shownReps = getEffectiveRepsForSet(activeTarget.exerciseId, editSet, defReps);
      if (el.repsCountNum) el.repsCountNum.textContent = String(shownReps);

      const shortExTitle = cleanExerciseShortTitle(activeTarget.title);
      el.plateStepperWrap?.classList.remove('hidden');
      el.twinStepperGrid?.classList.remove('reps-only');

      if (activeTarget.hidePlates) {
        const setLv = getEffectiveLoadLevelForSet(activeTarget.exerciseId, editSet);
        const maxLv = computeMaxLoadLevelForExercise(activeTarget.exerciseId);
        const lvMeta = formatLoadLevelDetail(setLv);
        el.plateCountNum.textContent = `Lv.${setLv}`;
        if (el.plateUnitLabel) el.plateUnitLabel.textContent = lvMeta.short;

        if (el.plateHeadingTitle) {
          if (activeTarget.isPostExercise) {
            el.plateHeadingTitle.textContent = `直前「${shortExTitle}」Set ${editSet}`;
          } else if (activeTarget.isLiveSet) {
            el.plateHeadingTitle.textContent = `Set ${editSet}/${activeTarget.totalSets} 負荷Lv ＆ 回数`;
          } else {
            el.plateHeadingTitle.textContent = `初期負荷「${shortExTitle}」Set ${editSet}`;
          }
        }
        const maxHint = maxLv > setLv ? ` ｜次回:最高Lv.${maxLv}` : '';
        el.plateKgHint.textContent = `${lvMeta.detail}${maxHint}`;

        if (el.hotelInlineCue) {
          const cueTxt = (activeTarget.cues && activeTarget.cues[0]) || (step.cues && step.cues[0]) || '';
          if (cueTxt) {
            el.hotelInlineCue.classList.remove('hidden');
            el.hotelInlineCue.textContent = `💡 ${cueTxt}`;
          } else {
            el.hotelInlineCue.classList.add('hidden');
          }
        }
      } else {
        const setPlates = getEffectivePlatesForSet(activeTarget.exerciseId, editSet, activeTarget.defaultPlates);
        const maxPlates = computeMaxPlatesForExercise(activeTarget.exerciseId, activeTarget.defaultPlates);
        const pDetail = formatPlateDetail(setPlates);
        el.plateCountNum.textContent = String(setPlates);
        if (el.plateUnitLabel) el.plateUnitLabel.textContent = '枚目';
        if (el.hotelInlineCue) el.hotelInlineCue.classList.add('hidden');

        if (el.plateHeadingTitle) {
          if (activeTarget.isPostExercise) {
            el.plateHeadingTitle.textContent = `直前「${shortExTitle}」Set ${editSet}`;
          } else if (activeTarget.isLiveSet) {
            el.plateHeadingTitle.textContent = `Set ${editSet}/${activeTarget.totalSets} 重量 ＆ 回数`;
          } else {
            el.plateHeadingTitle.textContent = `次回初期ピン（最高枚数）Set ${editSet}`;
          }
        }
        const maxHint = maxPlates > setPlates ? ` ｜次回初期:最高${maxPlates}枚` : '';
        el.plateKgHint.textContent = `約${pDetail.kg} kg${maxHint}`;
      }

      renderOverloadAndRpe(step, activeTarget);
    } else {
      const rpeTarget = resolveRpeTargetForStep(step);
      if (rpeTarget) {
        renderOverloadAndRpe(step, null);
      } else {
        if (el.rpeFeedbackBox) el.rpeFeedbackBox.classList.add('hidden');
        el.hotelTipBox.classList.remove('hidden');
        el.hotelTipText.textContent =
          (step.cues && step.cues[0]) || '反動を使わずゆっくり動かすことで、器具なしでもしっかり筋肉に効きます。';
      }
    }

    const nextStep = state.steps[state.currentIndex + 1];
    el.nextStepTitle.textContent = nextStep
      ? `${nextStep.title} (${formatMMSS(nextStep.durationSeconds)})`
      : '🏆 フルセッション完了';

    el.playPauseBtn.textContent = state.isRunning
      ? '⏸ 一時停止'
      : state.hasStartedOnce
      ? '▶ 再開'
      : '▶ スタート';

    renderMorningCondition();
    renderOverallProgress();
  }

  function updateTimerUI() {
    el.timerDigits.textContent = formatMMSS(state.remainingSec);
    const pct = state.stepTotalSec > 0 ? (state.remainingSec / state.stepTotalSec) * 100 : 0;
    el.stepProgressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;

    const totalRemaining =
      state.steps.slice(state.currentIndex + 1).reduce((acc, s) => acc + s.durationSeconds, 0) +
      state.remainingSec;
    el.overallRemainText.textContent = `残り ${formatMMSS(totalRemaining)}`;
  }

  // -------------------- Session Flow Control --------------------
  function setLocationMode(mode) {
    if (state.locationMode === mode) return;
    pauseSession();
    state.locationMode = mode;
    localStorage.setItem(STORAGE_KEYS.locationMode, mode);
    state.hasStartedOnce = false;
    state.editingSetOverride = null;
    state.editingSetExId = null;
    state.steps = buildSessionSteps(state.selectedDay);
    state.currentIndex = 0;
    state.stepTotalSec = state.steps[0].durationSeconds;
    state.remainingSec = state.stepTotalSec;
    renderLocationToggle();
    renderDurationToggle();
    renderDaySwitcher();
    renderCurrentStep();
    syncYouTubeForStep(state.steps[0], false);
    prefetchSessionVoices();
  }

  function setDurationMode(mode) {
    if (!['full', 'short', 'care'].includes(mode) || state.durationMode === mode) return;
    pauseSession();
    state.durationMode = mode;
    localStorage.setItem(STORAGE_KEYS.durationMode, mode);
    localStorage.setItem(STORAGE_KEYS.durationModeDate, getTodayJst());
    state.hasStartedOnce = false;
    state.editingSetOverride = null;
    state.editingSetExId = null;
    state.steps = buildSessionSteps(state.selectedDay, state.selectedStretchId, state.selectedMeditationId);
    state.currentIndex = 0;
    state.stepTotalSec = state.steps[0].durationSeconds;
    state.remainingSec = state.stepTotalSec;
    renderDurationToggle();
    renderMorningCondition();
    renderCurrentStep();
    syncYouTubeForStep(state.steps[0], false);
    prefetchSessionVoices();
  }

  function selectDay(dayKey, keepSelections = false) {
    pauseSession();
    state.selectedDay = dayKey;
    state.hasStartedOnce = false;
    state.editingSetOverride = null;
    state.editingSetExId = null;
    if (!keepSelections) {
      state.selectedStretchId = null;
      state.selectedMeditationId = null;
    }
    state.steps = buildSessionSteps(dayKey);
    state.currentIndex = 0;
    state.stepTotalSec = state.steps[0].durationSeconds;
    state.remainingSec = state.stepTotalSec;
    renderLocationToggle();
    renderDurationToggle();
    renderDaySwitcher();
    renderCurrentStep();
    syncYouTubeForStep(state.steps[0], false);
    prefetchSessionVoices();
  }

  function loadStep(index, autoPlay) {
    if (index < 0 || index >= state.steps.length) return;
    state.currentIndex = index;
    state.editingSetOverride = null;
    state.editingSetExId = null;

    const step = state.steps[index];
    state.stepTotalSec = step.durationSeconds;
    state.remainingSec = step.durationSeconds;

    // 本番セット突入時：直前セットの枚数/負荷Lvを自動引き継ぎ（Set1は前回の最高値から開始）
    if (step.kind === 'work' && step.exerciseId) {
      const isWeightEx = !step.hidePlates && state.locationMode === 'home' && Boolean(HOME_PLATE_EXERCISES[step.exerciseId]);
      ensureSetLoadInitialized(step.exerciseId, step.setIndex || 1, step.defaultPlates, isWeightEx);
    }

    if (step.isDailyStretch && step.stretchId) {
      localStorage.setItem(STORAGE_KEYS.lastStretchId, step.stretchId);
    }
    if (step.isDailyMeditation && step.meditationId) {
      localStorage.setItem(STORAGE_KEYS.lastMeditationId, step.meditationId);
    }

    renderCurrentStep();
    syncYouTubeForStep(step, autoPlay);

    if (autoPlay) {
      if (step.themePhase === 'MEDITATION') {
        playBeep(528, 300, 0.08);
      } else {
        playBeep(1174.66, 140, 0.12);
      }
      speakShoko(step.speechText);
    }
  }

  function startSession() {
    ensureAudioUnlocked();
    requestWakeLock();

    const firstLaunch = !state.hasStartedOnce;
    state.hasStartedOnce = true;
    state.isRunning = true;

    const step = state.steps[state.currentIndex];
    if (step && step.kind === 'work' && step.exerciseId) {
      const isWeightEx = !step.hidePlates && state.locationMode === 'home' && Boolean(HOME_PLATE_EXERCISES[step.exerciseId]);
      ensureSetLoadInitialized(step.exerciseId, step.setIndex || 1, step.defaultPlates, isWeightEx);
    }
    renderCurrentStep();

    if (firstLaunch) {
      playBeep(1046.5, 140, 0.12);
      speakShoko(step.speechText);
      syncYouTubeForStep(step, true);
      prefetchSessionVoices();
    } else if (step.kind === 'video' && state.ytReady && state.ytPlayer) {
      const pState = state.ytPlayer.getPlayerState ? state.ytPlayer.getPlayerState() : -1;
      if (pState === window.YT.PlayerState.PAUSED || pState === window.YT.PlayerState.BUFFERING) {
        state.ytPlayer.unMute();
        state.ytPlayer.playVideo();
      } else {
        syncYouTubeForStep(step, true);
      }
    } else {
      syncYouTubeForStep(step, true);
    }

    clearInterval(state.timerHandle);
    state.timerHandle = setInterval(tick, 1000);
  }

  function pauseSession() {
    state.isRunning = false;
    clearInterval(state.timerHandle);
    state.shokoAudio.pause();
    el.shokoAvatar?.classList.remove('speaking');
    if (state.ytPlayer && state.ytPlayer.pauseVideo) {
      try {
        state.ytPlayer.pauseVideo();
      } catch (_) {}
    }
    renderCurrentStep();
  }

  function tick() {
    if (!state.isRunning) return;
    const step = state.steps[state.currentIndex];
    if (!step) return;

    if (
      step.kind === 'video' &&
      state.ytReady &&
      state.ytPlayer &&
      !state.ytStepFailed &&
      window.YT &&
      window.YT.PlayerState &&
      typeof state.ytPlayer.getPlayerState === 'function'
    ) {
      const pState = state.ytPlayer.getPlayerState();
      const startSec = step.startSeconds || 0;
      const endSec = step.endSeconds || startSec + step.durationSeconds;

      if (pState === window.YT.PlayerState.PLAYING) {
        const cur = typeof state.ytPlayer.getCurrentTime === 'function' ? state.ytPlayer.getCurrentTime() : startSec;
        if (cur >= endSec - 0.3) {
          autoAdvanceFromVideo(step);
          return;
        }
        const nextRemain = Math.max(1, Math.ceil(endSec - cur));
        if (
          step.themePhase !== 'MEDITATION' &&
          nextRemain !== state.remainingSec &&
          nextRemain > 0 &&
          nextRemain <= 3
        ) {
          playBeep(880, 95, 0.07);
        }
        state.remainingSec = nextRemain;
        state.stepTotalSec = Math.max(state.stepTotalSec, endSec - startSec);
        updateTimerUI();
        return;
      }

      if (pState === window.YT.PlayerState.ENDED) {
        autoAdvanceFromVideo(step);
        return;
      }

      updateTimerUI();
      return;
    }

    state.remainingSec -= 1;

    if (step.switchHalfway && state.remainingSec === Math.floor(state.stepTotalSec / 2)) {
      playBeep(987.77, 130, 0.14);
      speakShoko('はい、ここで左右の手を入れ替えましょう！反対側も丁寧に効かせていきますよ！');
    }

    if (step.themePhase !== 'MEDITATION' && state.remainingSec > 0 && state.remainingSec <= 3) {
      playBeep(880, 95, step.kind === 'video' ? 0.07 : 0.13);
    }

    if (state.remainingSec <= 0) {
      advanceStep(1);
      return;
    }
    updateTimerUI();
  }

  function advanceStep(delta) {
    const nextIdx = state.currentIndex + delta;
    if (nextIdx < 0) {
      loadStep(0, state.isRunning);
      return;
    }
    if (nextIdx >= state.steps.length) {
      completeWorkoutSession();
      return;
    }
    loadStep(nextIdx, state.isRunning);
  }

  // -------------------- Notion Cloud Sync & Multi-Device State --------------------
  function computeCurrentSessionMetrics() {
    const plan = getActivePlan(state.selectedDay);
    const hasWorkStep = state.steps.some((s) => s.themePhase === 'WORK');
    let secStrength = 0;
    let secCardio = 0;
    let secFlex = 0;
    let secMeditation = 0;

    state.steps.forEach((s) => {
      if (s.themePhase === 'WORK' || s.themePhase === 'REST') {
        secStrength += s.durationSeconds;
      } else if (s.themePhase === 'SETUP' || s.themePhase === 'PREP') {
        if (hasWorkStep) secStrength += s.durationSeconds;
        else secFlex += s.durationSeconds;
      } else if (s.themePhase === 'HIIT') {
        secCardio += s.durationSeconds;
      } else if (s.themePhase === 'STRETCH') {
        secFlex += s.durationSeconds;
      } else if (s.themePhase === 'MEDITATION') {
        secMeditation += s.durationSeconds;
      }
    });

    const weightsMap = {};
    const weightParts = [];
    if (state.durationMode !== 'care' && Array.isArray(plan.blocks)) {
      plan.blocks.forEach((b) => {
        if (b.type !== 'machine' || !b.id) return;
        const shortTitle = b.title.replace(/（.*?）/g, (m) =>
          m.includes('横') ? '(横)' : m.includes('縦') ? '(縦)' : ''
        );

        if (state.locationMode === 'home' && !b.hidePlates) {
          const maxP = computeMaxPlatesForExercise(b.id, b.defaultPlates);
          const maxDet = formatPlateDetail(maxP);
          const cleanSets = getTodayCleanSetsList(b.id);
          const reps = getDefaultRepsForExercise(b.id, 10);
          const summaryCore = formatExerciseSetsSummary(b.id, {
            includeKg: true,
            defaultPlates: b.defaultPlates,
            defaultReps: 10,
            isWeightEx: true
          });
          const compactSetRepsTxt = formatExerciseSetsSummary(b.id, {
            includeKg: false,
            defaultPlates: b.defaultPlates,
            defaultReps: 10,
            isWeightEx: true
          });

          const rpeObj = state.rpeMap[b.id] || {};
          const todayRpe = rpeObj.lastRatedDate === getTodayJst() ? rpeObj.lastRpe : undefined;
          weightsMap[b.id] = {
            title: b.title,
            plates: maxP,
            kg: Number(maxDet.kg),
            reps,
            sets: cleanSets.length ? cleanSets : undefined,
            setReps: cleanSets.filter((s) => s.reps !== null).map((s) => s.reps),
            setRepsText: compactSetRepsTxt,
            rpe: todayRpe,
            rpeInfo: {
              ...rpeObj,
              lastReps: reps,
              lastSets: cleanSets.length ? cleanSets : rpeObj.lastSets,
              setRepsText: compactSetRepsTxt
            }
          };
          const rpeIcon =
            todayRpe === 'easy' ? '😊' : todayRpe === 'good' ? '👍' : todayRpe === 'hard' ? '🔥' : '';
          weightParts.push(`${shortTitle}: ${summaryCore}${rpeIcon}`);
        } else {
          // 出張ホテル種目・自重種目もセット別「負荷Lv×回数」を保存・同期
          const maxLv = computeMaxLoadLevelForExercise(b.id);
          const cleanSets = getTodayCleanSetsList(b.id);
          const reps = getDefaultRepsForExercise(b.id, 12);
          const rpeObj = state.rpeMap[b.id] || {};
          const todayRpe = rpeObj.lastRatedDate === getTodayJst() ? rpeObj.lastRpe : undefined;
          const shouldRecord =
            state.locationMode === 'hotel' ||
            state.loadMap[b.id] !== undefined ||
            state.repsMap[b.id] !== undefined ||
            cleanSets.length > 0 ||
            Boolean(todayRpe);

          if (shouldRecord) {
            const summaryCore = formatExerciseSetsSummary(b.id, {
              includeKg: true,
              defaultReps: 12,
              isWeightEx: false
            });
            const compactSetTxt = formatExerciseSetsSummary(b.id, {
              includeKg: false,
              defaultReps: 12,
              isWeightEx: false
            });
            weightsMap[b.id] = {
              title: b.title,
              loadLv: maxLv,
              reps,
              sets: cleanSets.length ? cleanSets : undefined,
              setReps: cleanSets.filter((s) => s.reps !== null).map((s) => s.reps),
              setRepsText: compactSetTxt,
              rpe: todayRpe,
              rpeInfo: {
                ...rpeObj,
                lastLoadLv: maxLv,
                lastReps: reps,
                lastSets: cleanSets.length ? cleanSets : rpeObj.lastSets,
                setRepsText: compactSetTxt
              }
            };
            const rpeIcon =
              todayRpe === 'easy' ? '😊' : todayRpe === 'good' ? '👍' : todayRpe === 'hard' ? '🔥' : '';
            weightParts.push(`${shortTitle}: ${summaryCore}${rpeIcon}`);
          }
        }
      });
    }

    const medObj = getAllMeditations().find((m) => m.id === state.selectedMeditationId);
    return {
      strengthMin: Math.round(secStrength / 60),
      cardioMin: Math.round(secCardio / 60),
      flexMin: Math.round(secFlex / 60),
      meditationMin: Math.max(5, Math.round(secMeditation / 60) || 5),
      weightsMap,
      weightsSummary: weightParts.join(' / '),
      meditationTitle: medObj ? medObj.title : '5分間の瞑想'
    };
  }

  function updateSyncUI(feedbackMessage) {
    if (!el.openSyncModalBtn) return;

    el.openSyncModalBtn.classList.remove('sync-on', 'sync-busy', 'sync-err');
    const badges = [el.logModalSyncBadge, el.syncModalBadge].filter(Boolean);
    badges.forEach((b) => b.classList.remove('connected', 'syncing', 'error'));

    const hasKey = Boolean(state.syncKey);
    if (!hasKey) {
      state.syncStatus = 'unconfigured';
      el.syncIconEmoji.textContent = '☁️';
      el.syncStatusLabel.textContent = '未連携';
      badges.forEach((b) => {
        b.textContent = '端末ローカル保存のみ（未連携）';
      });
      if (el.syncModalDetail) {
        el.syncModalDetail.textContent =
          'Notion「🏃 健康ダッシュボード」上部の専用ワンクリックリンクから開くと、スマホ・PC・タブレット間で自動同期が有効になります。';
      }
    } else if (state.syncStatus === 'syncing') {
      el.openSyncModalBtn.classList.add('sync-busy');
      el.syncIconEmoji.textContent = '🔄';
      el.syncStatusLabel.textContent = '同期中';
      badges.forEach((b) => {
        b.textContent = '🔄 Notion同期中...';
        b.classList.add('syncing');
      });
    } else if (state.syncStatus === 'unauthorized') {
      el.openSyncModalBtn.classList.add('sync-err');
      el.syncIconEmoji.textContent = '⚠️';
      el.syncStatusLabel.textContent = '要再設定';
      badges.forEach((b) => {
        b.textContent = '⚠️ 同期キー不一致';
        b.classList.add('error');
      });
      if (el.syncModalDetail) {
        el.syncModalDetail.textContent =
          '同期キーが一致しません。Notion「🏃 健康ダッシュボード」の専用リンクから再度開くか、正しいキーを入力してください。';
      }
    } else if (state.syncStatus === 'offline') {
      el.openSyncModalBtn.classList.add('sync-busy');
      el.syncIconEmoji.textContent = '📡';
      el.syncStatusLabel.textContent = '待機中';
      badges.forEach((b) => {
        b.textContent = '📡 オフライン保留中（復帰時自動送信）';
        b.classList.add('syncing');
      });
    } else {
      state.syncStatus = 'connected';
      el.openSyncModalBtn.classList.add('sync-on');
      el.syncIconEmoji.textContent = '☁️';
      el.syncStatusLabel.textContent = '同期ON';
      badges.forEach((b) => {
        b.textContent = '✅ Notion クラウド同期ON';
        b.classList.add('connected');
      });
      if (el.syncModalDetail) {
        const lastTxt = state.lastSyncedAt ? `（最終同期: ${state.lastSyncedAt}）` : '';
        el.syncModalDetail.textContent = `Notion「🏃 健康ダッシュボード」および全端末と自動同期中です${lastTxt}。`;
      }
    }

    if (feedbackMessage && el.logSyncFeedback) {
      el.logSyncFeedback.textContent = feedbackMessage;
    }
  }

  function enqueuePendingSync(endpoint, payload) {
    const queue = loadJson(STORAGE_KEYS.pendingQueue, []);
    const deduped = queue.filter((item) => {
      if (item.endpoint !== endpoint) return true;
      if (endpoint === '/api/plates' && item.payload?.exerciseId === payload?.exerciseId) return false;
      if (endpoint === '/api/session' && item.payload?.date === payload?.date) return false;
      if (endpoint === '/api/split-level' && item.payload?.date === payload?.date) return false;
      return true;
    });
    deduped.push({ endpoint, payload, queuedAt: Date.now() });
    saveJson(STORAGE_KEYS.pendingQueue, deduped.slice(-25));
  }

  async function relayRequest(endpoint, method = 'GET', payload = null, { allowQueue = true } = {}) {
    if (!state.syncKey || !RELAY_BASE_URL || RELAY_BASE_URL.includes('placeholder')) {
      return null;
    }

    state.syncStatus = 'syncing';
    updateSyncUI();

    try {
      const resp = await fetch(RELAY_BASE_URL + endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Workout-Key': state.syncKey
        },
        body: payload ? JSON.stringify(payload) : undefined
      });

      if (resp.status === 401) {
        state.syncStatus = 'unauthorized';
        updateSyncUI('⚠️ 同期キーが無効です。右上の「☁️」から同期キーを確認してください。');
        return null;
      }

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }

      const nowStr = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      state.lastSyncedAt = nowStr;
      localStorage.setItem(STORAGE_KEYS.lastSyncedAt, nowStr);
      state.syncStatus = 'connected';
      updateSyncUI();
      return data;
    } catch (_) {
      if (method === 'POST' && allowQueue) {
        enqueuePendingSync(endpoint, payload);
      }
      state.syncStatus = 'offline';
      updateSyncUI('📡 通信待機中：この端末に保存しました（オンライン復帰時に自動でNotionへ送信されます）。');
      return null;
    }
  }

  async function flushPendingSyncQueue() {
    if (!state.syncKey) return;
    const queue = loadJson(STORAGE_KEYS.pendingQueue, []);
    if (!queue.length) return;

    const remain = [];
    for (const item of queue) {
      const res = await relayRequest(item.endpoint, 'POST', item.payload, { allowQueue: false });
      if (!res) {
        remain.push(item);
      }
    }
    saveJson(STORAGE_KEYS.pendingQueue, remain);
  }

  async function pullCloudState({ silent = false } = {}) {
    if (!state.syncKey) {
      updateSyncUI();
      return;
    }

    await flushPendingSyncQueue();
    const data = await relayRequest('/api/state', 'GET', null, { allowQueue: false });
    if (!data) return;

    state.lastPullMs = Date.now();
    const todayIso = getTodayJst();

    if (data.morningCondition) {
      state.morningCondition = data.morningCondition;
      saveJson(STORAGE_KEYS.morningCond, data.morningCondition);
    }

    if (data.plates && typeof data.plates === 'object') {
      state.plateMap = { ...state.plateMap, ...data.plates };
      saveJson(STORAGE_KEYS.plates, state.plateMap);
    }
    if (data.repsMap && typeof data.repsMap === 'object') {
      state.repsMap = { ...state.repsMap, ...data.repsMap };
      saveJson(STORAGE_KEYS.repsMap, state.repsMap);
    }
    if (data.rpeMap && typeof data.rpeMap === 'object') {
      state.rpeMap = { ...state.rpeMap, ...data.rpeMap };
      Object.entries(data.rpeMap).forEach(([exId, info]) => {
        if (!info) return;
        if (Number.isFinite(Number(info.lastReps)) && Number(info.lastReps) > 0 && !state.repsMap[exId]) {
          state.repsMap[exId] = Math.round(Number(info.lastReps));
        }
        // 当日他の端末で記録したセット別重量×回数があればマージ
        if (info.lastSetDate === todayIso && Array.isArray(info.lastSets) && !state.todaySets[exId]) {
          state.todaySets[exId] = {};
          info.lastSets.forEach((s) => {
            if (s && s.set) {
              state.todaySets[exId][s.set] = { plates: s.plates || null, reps: s.reps || null };
            }
          });
          saveTodaySessionSets(state.todaySets);
        }
      });
      saveJson(STORAGE_KEYS.repsMap, state.repsMap);
      saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);
    }

    if (Array.isArray(data.customStretches) && data.customStretches.length > 0) {
      const byVid = new Map();
      [...state.customStretches, ...data.customStretches].forEach((c) => {
        if (c && c.videoId) byVid.set(c.videoId, c);
      });
      state.customStretches = [...byVid.values()];
      saveJson(STORAGE_KEYS.customStretches, state.customStretches);
    }

    if (Array.isArray(data.logs)) {
      const logMap = new Map();
      state.logs.forEach((l) => {
        if (l && l.date) logMap.set(l.date, { ...l });
      });
      data.logs.forEach((cl) => {
        if (!cl || !cl.date) return;
        const prev = logMap.get(cl.date) || {};
        logMap.set(cl.date, {
          ...prev,
          ...cl,
          splitLevel: cl.splitLevel || prev.splitLevel || null,
          splitMemo: cl.splitMemo || prev.splitMemo || '',
          meditationDone: Boolean(cl.meditationDone || prev.meditationDone)
        });
        // 当日のセッションログ内にsets配列があれば補完し、過去ホテルログからも負荷Lv初期値を復元
        if (cl.weightsMap && typeof cl.weightsMap === 'object') {
          Object.entries(cl.weightsMap).forEach(([exId, wItem]) => {
            if (!wItem || typeof wItem !== 'object') return;
            if (typeof wItem.loadLv === 'number' && wItem.loadLv >= 1 && !state.loadMap[exId]) {
              state.loadMap[exId] = Math.round(wItem.loadLv);
            }
            if (typeof wItem.reps === 'number' && wItem.reps >= 1 && !state.repsMap[exId]) {
              state.repsMap[exId] = Math.round(wItem.reps);
            }
            if (wItem.rpeInfo && typeof wItem.rpeInfo === 'object' && !state.rpeMap[exId]) {
              state.rpeMap[exId] = wItem.rpeInfo;
            }
            if (cl.date === todayIso && Array.isArray(wItem.sets) && !state.todaySets[exId]) {
              state.todaySets[exId] = {};
              wItem.sets.forEach((s) => {
                if (s && s.set) {
                  state.todaySets[exId][s.set] = {
                    plates: s.plates || null,
                    loadLv: s.loadLv || null,
                    reps: s.reps || null
                  };
                }
              });
              saveTodaySessionSets(state.todaySets);
            }
          });
          saveJson(STORAGE_KEYS.loadMap, state.loadMap);
          saveJson(STORAGE_KEYS.repsMap, state.repsMap);
          saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);
        }
      });
      state.logs = [...logMap.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      saveJson(STORAGE_KEYS.logs, state.logs);
    }

    updateStreakBadge();
    renderMorningCondition();
    renderCurrentStep();
    if (!el.logModal.classList.contains('hidden')) {
      renderSessionWeightsEditor();
      renderWeeklyStamps();
      renderSplitHistory();
    }
    if (!silent) {
      updateSyncUI('✅ Notion「健康ダッシュボード」＆Pixel Watch体調データを最新同期しました！');
    }
  }

  function upsertLocalLog(dateStr, patch) {
    const idx = state.logs.findIndex((l) => l.date === dateStr);
    if (idx >= 0) {
      state.logs[idx] = { ...state.logs[idx], ...patch };
    } else {
      state.logs.unshift({ date: dateStr, splitLevel: null, splitMemo: '', ...patch });
    }
    state.logs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    saveJson(STORAGE_KEYS.logs, state.logs);
  }

  async function syncFullSessionToCloud({ fromManualBtn = false } = {}) {
    const todayIso = getTodayJst();
    const plan = getActivePlan(state.selectedDay);
    const metrics = computeCurrentSessionMetrics();
    const existing = state.logs.find((l) => l.date === todayIso);

    upsertLocalLog(todayIso, {
      dayKey: state.selectedDay,
      locationMode: state.locationMode,
      durationMode: state.durationMode,
      theme: plan.shortTheme,
      strengthMin: metrics.strengthMin,
      cardioMin: metrics.cardioMin,
      flexMin: metrics.flexMin,
      meditationMin: metrics.meditationMin,
      meditationDone: true,
      weightsSummary: metrics.weightsSummary,
      weightsMap: metrics.weightsMap,
      splitLevel: existing?.splitLevel || null,
      splitMemo: existing?.splitMemo || ''
    });
    updateStreakBadge();
    renderWeeklyStamps();
    renderSplitHistory();

    const res = await relayRequest('/api/session', 'POST', {
      date: todayIso,
      locationMode: state.locationMode,
      durationMode: state.durationMode,
      dayKey: state.selectedDay,
      dayLabel: plan.dayLabel,
      theme: plan.shortTheme,
      strengthMin: metrics.strengthMin,
      cardioMin: metrics.cardioMin,
      flexMin: metrics.flexMin,
      meditationMin: metrics.meditationMin,
      meditationDone: true,
      splitLevel: existing?.splitLevel || undefined,
      splitMemo: existing?.splitMemo || undefined,
      weightsMap: metrics.weightsMap,
      weightsSummary: metrics.weightsSummary,
      meditationTitle: metrics.meditationTitle
    });

    if (res) {
      updateSyncUI(
        fromManualBtn
          ? '✅ セット別の重量×回数（次回初期＝最高枚数）＆5分瞑想をNotionへ記録しました！'
          : '🎉 Notionへ自動保存しました！下のセット別「重量×回数」や開脚レベルも微調整できます。'
      );
    }
  }

  async function syncStandaloneMeditationToCloud() {
    const todayIso = getTodayJst();
    const plan = getActivePlan(state.selectedDay);
    const medObj = getAllMeditations().find((m) => m.id === state.selectedMeditationId);
    const existing = state.logs.find((l) => l.date === todayIso);

    upsertLocalLog(todayIso, {
      dayKey: existing?.dayKey ?? state.selectedDay,
      locationMode: existing?.locationMode || state.locationMode,
      durationMode: existing?.durationMode || state.durationMode,
      theme: existing?.theme || '5分間の瞑想',
      meditationMin: Math.max(5, existing?.meditationMin || 5),
      meditationDone: true
    });
    updateStreakBadge();
    renderWeeklyStamps();

    const res = await relayRequest('/api/meditation', 'POST', {
      date: todayIso,
      locationMode: state.locationMode,
      durationMode: existing?.durationMode || state.durationMode,
      dayKey: state.selectedDay,
      dayLabel: plan.dayLabel,
      meditationMin: 5,
      meditationDone: true,
      meditationOnly: !existing,
      meditationTitle: medObj ? medObj.title : '5分間の瞑想'
    });

    if (res) {
      updateSyncUI('🧘 本日の「5分間の瞑想」をNotion（健康ダッシュボード＆マインドフルネスログ）へ記録しました！');
    } else if (!state.syncKey) {
      updateSyncUI('📝 この端末に瞑想を記録しました（Notion連携は右上の「☁️」から有効化できます）。');
    }
  }

  function completeWorkoutSession() {
    pauseSession();
    playCalmChime();
    speakShoko('瞑想まで含めたフルセッション完走、本当にお疲れ様でした！体も心もスッキリ整いましたね。最後に今日の記録も残しておきましょう！');

    openLogModal(true);
    syncFullSessionToCloud({ fromManualBtn: false });
  }

  // -------------------- セット別「重量(負荷Lv)×回数」更新 ＆ 次回最高値プリセット同期 --------------------
  function recomputeMaxAndSyncExercise(exId, exName, defaultPlates, { immediate = false, isWeightEx = true } = {}) {
    if (!exId) return;

    const cleanSets = getTodayCleanSetsList(exId);
    const recordedWithReps = cleanSets.filter((s) => s.reps !== null);

    if (!isWeightEx || !HOME_PLATE_EXERCISES[exId]) {
      // 出張ホテル・自重種目：最高負荷Lvと代表回数を保存
      const maxLv = computeMaxLoadLevelForExercise(exId);
      state.loadMap[exId] = maxLv;
      saveJson(STORAGE_KEYS.loadMap, state.loadMap);

      if (recordedWithReps.length > 0) {
        const lvVals = cleanSets.map((s) => s.loadLv).filter(Boolean);
        const allSameLv = lvVals.every((lv) => lv === maxLv);
        let repAtMax;
        if (allSameLv) {
          repAtMax = recordedWithReps[recordedWithReps.length - 1].reps;
        } else {
          const atMax = recordedWithReps.filter((s) => s.loadLv === maxLv);
          repAtMax = atMax.length > 0 ? Math.max(...atMax.map((s) => s.reps)) : recordedWithReps[0].reps;
        }
        state.repsMap[exId] = repAtMax;
        saveJson(STORAGE_KEYS.repsMap, state.repsMap);
      }

      const curReps = getDefaultRepsForExercise(exId, 12);
      const setSummaryTxt = formatExerciseSetsSummary(exId, {
        includeKg: false,
        defaultReps: 12,
        isWeightEx: false
      });
      const prevRpe = state.rpeMap[exId] || {};
      const holdLoad = hasSubTenOrDroppedWeight(exId, false);
      state.rpeMap[exId] = {
        ...prevRpe,
        lastLoadLv: maxLv,
        lastReps: curReps,
        lastSets: cleanSets.length ? cleanSets : prevRpe.lastSets,
        lastSetDate: cleanSets.length ? getTodayJst() : prevRpe.lastSetDate,
        setRepsText: setSummaryTxt,
        easyStreak: holdLoad ? 0 : Number(prevRpe.easyStreak || 0)
      };
      saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);
      return;
    }

    const maxPlates = computeMaxPlatesForExercise(exId, defaultPlates || HOME_PLATE_EXERCISES[exId].defaultPlates);

    // 次回初期セット枚数は常に「全セット中の最高枚数」を保存
    state.plateMap[exId] = maxPlates;
    saveJson(STORAGE_KEYS.plates, state.plateMap);

    if (recordedWithReps.length > 0) {
      const pVals = cleanSets.map((s) => s.plates).filter(Boolean);
      const allSameP = pVals.every((p) => p === maxPlates);
      let repAtMax;
      if (allSameP) {
        repAtMax = recordedWithReps[recordedWithReps.length - 1].reps;
      } else {
        const atMax = recordedWithReps.filter((s) => s.plates === maxPlates);
        repAtMax = atMax.length > 0 ? Math.max(...atMax.map((s) => s.reps)) : recordedWithReps[0].reps;
      }
      state.repsMap[exId] = repAtMax;
      saveJson(STORAGE_KEYS.repsMap, state.repsMap);
    }

    const curReps = getDefaultRepsForExercise(exId, 10);
    const setSummaryTxt = formatExerciseSetsSummary(exId, {
      includeKg: false,
      defaultPlates,
      defaultReps: 10,
      isWeightEx: true
    });

    const prevRpe = state.rpeMap[exId] || {};
    const holdWeight = hasSubTenOrDroppedWeight(exId, true);
    const updatedRpe = {
      ...prevRpe,
      lastReps: curReps,
      lastSets: cleanSets.length ? cleanSets : prevRpe.lastSets,
      lastSetDate: cleanSets.length ? getTodayJst() : prevRpe.lastSetDate,
      setRepsText: setSummaryTxt,
      easyStreak: holdWeight ? 0 : Number(prevRpe.easyStreak || 0)
    };
    state.rpeMap[exId] = updatedRpe;
    saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);

    if (!state.syncKey) return;

    const sendFn = () => {
      relayRequest('/api/plates', 'POST', {
        exerciseId: exId,
        plates: maxPlates,
        reps: curReps,
        sets: cleanSets.length ? cleanSets : undefined,
        setRepsText: setSummaryTxt,
        exerciseName: exName || HOME_PLATE_EXERCISES[exId].title,
        rpeInfo: updatedRpe
      });
    };

    clearTimeout(state.plateSyncTimers[exId]);
    if (immediate) {
      sendFn();
    } else {
      state.plateSyncTimers[exId] = setTimeout(sendFn, 500);
    }
  }

  function adjustPlates(delta) {
    const step = state.steps[state.currentIndex];
    const target = resolveActiveExerciseTarget(step);
    if (!target) return;

    const exId = target.exerciseId;
    const editSet = getActiveEditingSetIndex(target);
    const isWeightEx = !target.hidePlates && Boolean(HOME_PLATE_EXERCISES[exId]);

    if (isWeightEx) {
      const curSetPlates = getEffectivePlatesForSet(exId, editSet, target.defaultPlates);
      const nextPlates = Math.max(1, Math.min(DATA.maxPlates, curSetPlates + delta));
      for (let s = 1; s < editSet; s++) {
        ensureSetLoadInitialized(exId, s, target.defaultPlates, true);
      }
      upsertTodaySetEntry(exId, editSet, { plates: nextPlates }, target.defaultPlates, true);
      recomputeMaxAndSyncExercise(exId, target.title, target.defaultPlates, { isWeightEx: true });
    } else {
      const curLv = getEffectiveLoadLevelForSet(exId, editSet);
      const nextLv = Math.max(1, Math.min(MAX_LOAD_LV, curLv + delta));
      for (let s = 1; s < editSet; s++) {
        ensureSetLoadInitialized(exId, s, target.defaultPlates, false);
      }
      upsertTodaySetEntry(exId, editSet, { loadLv: nextLv }, target.defaultPlates, false);
      recomputeMaxAndSyncExercise(exId, target.title, target.defaultPlates, { isWeightEx: false });
    }
    renderCurrentStep();
  }

  function adjustReps(delta) {
    const step = state.steps[state.currentIndex];
    const target = resolveActiveExerciseTarget(step);
    if (!target) return;

    const exId = target.exerciseId;
    const editSet = getActiveEditingSetIndex(target);
    const isWeightEx = !target.hidePlates && Boolean(HOME_PLATE_EXERCISES[exId]);
    const defReps = isWeightEx ? 10 : 12;
    const curReps = getEffectiveRepsForSet(exId, editSet, defReps);
    const nextReps = Math.max(1, Math.min(60, curReps + delta));

    for (let s = 1; s <= editSet; s++) {
      ensureSetLoadInitialized(exId, s, target.defaultPlates, isWeightEx);
    }
    upsertTodaySetEntry(exId, editSet, { reps: nextReps }, target.defaultPlates, isWeightEx);
    state.repsMap[exId] = nextReps;
    saveJson(STORAGE_KEYS.repsMap, state.repsMap);

    recomputeMaxAndSyncExercise(exId, target.title, target.defaultPlates, { isWeightEx });
    renderCurrentStep();
  }

  function recordQuickSetReps(repsNum) {
    if (!el.rpeFeedbackBox) return;
    const exId = el.rpeFeedbackBox.dataset.exerciseId;
    const exName = el.rpeFeedbackBox.dataset.exerciseName || exId;
    const defPlates = Number(el.rpeFeedbackBox.dataset.defaultPlates || 5);
    const setIndex = Number(el.rpeFeedbackBox.dataset.setIndex || 1);
    const hidePlates = el.rpeFeedbackBox.dataset.hidePlates === '1';
    const isWeightEx = !hidePlates && Boolean(HOME_PLATE_EXERCISES[exId]);
    const cleanReps = Math.max(1, Math.min(60, Math.round(Number(repsNum) || 10)));
    if (!exId) return;

    for (let s = 1; s <= setIndex; s++) {
      ensureSetLoadInitialized(exId, s, defPlates, isWeightEx);
    }
    upsertTodaySetEntry(exId, setIndex, { reps: cleanReps }, defPlates, isWeightEx);
    recomputeMaxAndSyncExercise(exId, exName, defPlates, { isWeightEx });

    playBeep(cleanReps >= 10 ? 987.77 : 783.99, 75, 0.08);
    renderCurrentStep();
  }

  function acceptOverloadUpgrade() {
    if (!el.overloadBanner) return;
    const exId = el.overloadBanner.dataset.exerciseId;
    const nextVal = Number(el.overloadBanner.dataset.nextPlates);
    const isWeightEx = el.overloadBanner.dataset.isWeightEx !== '0';
    const exName = el.overloadBanner.dataset.exerciseName || exId;
    if (!exId || !nextVal) return;

    const todayIso = getTodayJst();
    const defReps = isWeightEx ? 10 : 12;

    if (isWeightEx) {
      state.plateMap[exId] = nextVal;
      saveJson(STORAGE_KEYS.plates, state.plateMap);
      state.todaySets[exId] = { 1: { plates: nextVal, loadLv: null, reps: null } };
    } else {
      state.loadMap[exId] = nextVal;
      saveJson(STORAGE_KEYS.loadMap, state.loadMap);
      state.todaySets[exId] = { 1: { plates: null, loadLv: nextVal, reps: null } };
    }
    state.repsMap[exId] = defReps;
    saveTodaySessionSets(state.todaySets);

    const updatedRpe = {
      ...(state.rpeMap[exId] || {}),
      easyStreak: 0,
      lastUpgradeDate: todayIso,
      lastRpe: 'good',
      lastReps: defReps,
      lastSets: [],
      setRepsText: ''
    };
    state.rpeMap[exId] = updatedRpe;
    saveJson(STORAGE_KEYS.repsMap, state.repsMap);
    saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);

    ensureAudioUnlocked();
    playBeep(1046.5, 130, 0.12);
    if (isWeightEx) {
      speakShoko('ナイスチャレンジです！ピンを1枚上げて、丁寧なフォームで効かせていきましょう！');
    }
    renderCurrentStep();

    recomputeMaxAndSyncExercise(exId, exName, nextVal, { immediate: true, isWeightEx });
  }

  function recordExerciseRpe(rpeValue) {
    if (!el.rpeFeedbackBox || !['easy', 'good', 'hard'].includes(rpeValue)) return;
    const exId = el.rpeFeedbackBox.dataset.exerciseId;
    const exName = el.rpeFeedbackBox.dataset.exerciseName || exId;
    const defPlates = Number(el.rpeFeedbackBox.dataset.defaultPlates || 5);
    const hidePlates = el.rpeFeedbackBox.dataset.hidePlates === '1';
    const isWeightEx = !hidePlates && Boolean(HOME_PLATE_EXERCISES[exId]);
    if (!exId) return;

    const todayIso = getTodayJst();
    const prev = state.rpeMap[exId] || {};
    const baseStreak =
      prev.baseStreakDate === todayIso ? Number(prev.baseStreak || 0) : Number(prev.easyStreak || 0);
    const canCountEasy = rpeValue === 'easy' && !hasSubTenOrDroppedWeight(exId, isWeightEx);
    const nextEasyStreak = canCountEasy ? baseStreak + 1 : 0;

    state.rpeMap[exId] = {
      ...prev,
      lastRpe: rpeValue,
      easyStreak: nextEasyStreak,
      baseStreak,
      baseStreakDate: todayIso,
      lastRatedDate: todayIso
    };
    saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);

    playBeep(rpeValue === 'easy' ? 1046.5 : 880, 80, 0.08);
    recomputeMaxAndSyncExercise(exId, exName, defPlates, { isWeightEx });
    renderCurrentStep();
  }

  // -------------------- Shuffle Daily Stretch / Meditation --------------------
  function shuffleCurrentPoolVideo() {
    const curStep = state.steps[state.currentIndex];
    if (curStep && curStep.isDailyMeditation) {
      const medPool = getAllMeditations();
      if (medPool.length <= 1) return;
      const idx = medPool.findIndex((m) => m.id === state.selectedMeditationId);
      const nextMed = medPool[(idx + 1) % medPool.length];
      applySelectedMeditation(nextMed.id);
      return;
    }

    const pool = getAllStretches();
    if (pool.length <= 1) return;
    const idx = pool.findIndex((s) => s.id === state.selectedStretchId);
    const nextStretch = pool[(idx + 1) % pool.length];
    applySelectedStretch(nextStretch.id);
  }

  function applySelectedStretch(stretchId) {
    state.selectedStretchId = stretchId;
    const wasDaily = state.steps[state.currentIndex] && state.steps[state.currentIndex].isDailyStretch;
    const savedIndex = state.currentIndex;
    const savedRemain = state.remainingSec;

    state.steps = buildSessionSteps(state.selectedDay, stretchId, state.selectedMeditationId);
    state.currentIndex = Math.min(savedIndex, state.steps.length - 1);

    if (wasDaily) {
      loadStep(state.currentIndex, state.isRunning);
    } else {
      state.remainingSec = savedRemain;
      renderCurrentStep();
      prefetchSessionVoices();
    }
    renderPoolModal();
  }

  function applySelectedMeditation(meditationId) {
    state.selectedMeditationId = meditationId;
    const wasMed = state.steps[state.currentIndex] && state.steps[state.currentIndex].isDailyMeditation;
    const savedIndex = state.currentIndex;
    const savedRemain = state.remainingSec;

    state.steps = buildSessionSteps(state.selectedDay, state.selectedStretchId, meditationId);
    state.currentIndex = Math.min(savedIndex, state.steps.length - 1);

    if (wasMed) {
      loadStep(state.currentIndex, state.isRunning);
    } else {
      state.remainingSec = savedRemain;
      renderCurrentStep();
      prefetchSessionVoices();
    }
    renderPoolModal();
  }

  // -------------------- Modals --------------------
  function openTimelineModal() {
    const plan = getActivePlan(state.selectedDay);
    const durTag =
      state.durationMode === 'short' ? '（⚡時短20分）' : state.durationMode === 'care' ? '（🧘ケア15分）' : '';
    el.timelineModalTitle.textContent = `${plan.dayLabel}｜${plan.title}${durTag}`;
    el.timelineList.innerHTML = '';

    state.steps.forEach((s, idx) => {
      const row = document.createElement('div');
      row.className = 'timeline-item' + (idx === state.currentIndex ? ' active' : '');
      row.innerHTML = `
        <span class="tl-idx">#${idx + 1}</span>
        <span class="tl-badge">${s.themePhase}</span>
        <span class="tl-main">${s.title}${s.setIndex ? ` (Set ${s.setIndex}/${s.totalSets})` : ''}</span>
        <span class="tl-dur">${formatMMSS(s.durationSeconds)}</span>
      `;
      row.addEventListener('click', () => {
        el.timelineModal.classList.add('hidden');
        ensureAudioUnlocked();
        state.hasStartedOnce = true;
        state.isRunning = true;
        requestWakeLock();
        clearInterval(state.timerHandle);
        state.timerHandle = setInterval(tick, 1000);
        loadStep(idx, true);
      });
      el.timelineList.appendChild(row);
    });

    el.timelineModal.classList.remove('hidden');
  }

  function renderPoolModal() {
    const medPool = getAllMeditations();
    el.meditationPoolGrid.innerHTML = '';
    medPool.forEach((item) => {
      const selected = item.id === state.selectedMeditationId;
      const card = document.createElement('div');
      card.className = 'pool-card meditation-card' + (selected ? ' selected' : '');
      card.innerHTML = `
        <div>
          <div class="pool-card-cat">${item.category}</div>
          <div class="pool-card-title">${item.title}</div>
          <div class="pool-card-meta">${item.channel} ・ ${Math.round(item.durationSeconds / 60)}分</div>
        </div>
        <button class="pool-select-btn" type="button">
          ${selected ? '✓ 本日の瞑想に選択中' : '今日の仕上げ瞑想にセット'}
        </button>
      `;
      card.querySelector('button').addEventListener('click', () => {
        applySelectedMeditation(item.id);
      });
      el.meditationPoolGrid.appendChild(card);
    });

    const pool = getAllStretches();
    el.stretchPoolGrid.innerHTML = '';
    pool.forEach((item) => {
      const selected = item.id === state.selectedStretchId;
      const card = document.createElement('div');
      card.className = 'pool-card' + (selected ? ' selected' : '');
      card.innerHTML = `
        <div>
          <div class="pool-card-cat">${item.category}</div>
          <div class="pool-card-title">${item.title}</div>
          <div class="pool-card-meta">${item.channel} ・ 約${Math.round(item.durationSeconds / 60)}分</div>
        </div>
        <button class="pool-select-btn" type="button">
          ${selected ? '✓ 本日のストレッチに選択中' : '今日のメニューにセット'}
        </button>
      `;
      card.querySelector('button').addEventListener('click', () => {
        applySelectedStretch(item.id);
      });
      el.stretchPoolGrid.appendChild(card);
    });
  }

  function extractYoutubeId(input) {
    const trimmed = input.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const m = trimmed.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function renderWeeklyStamps() {
    const dayNames = ['月', '火', '水', '木', '金', '土', '日'];
    const todayStr = getTodayJst();
    const todayUtc = new Date(todayStr + 'T00:00:00Z');
    const dowFromMon = (todayUtc.getUTCDay() + 6) % 7;
    const monUtc = new Date(todayUtc);
    monUtc.setUTCDate(todayUtc.getUTCDate() - dowFromMon);

    const logDates = new Set(state.logs.map((l) => l.date));
    el.weeklyStampRow.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(monUtc);
      d.setUTCDate(monUtc.getUTCDate() + i);
      const dIso = d.toISOString().slice(0, 10);
      const done = logDates.has(dIso);
      const cell = document.createElement('div');
      cell.className = 'stamp-cell' + (done ? ' done' : '');
      cell.title = dIso;
      cell.innerHTML = `<div>${dayNames[i]}</div><div>${done ? '✅' : '・'}</div>`;
      el.weeklyStampRow.appendChild(cell);
    }
  }

  function syncSplitQuickChipsUI(memoStr) {
    if (!el.splitQuickChips) return;
    const current = String(memoStr || '');
    el.splitQuickChips.querySelectorAll('.split-chip').forEach((chip) => {
      chip.classList.toggle('active', current.includes(chip.dataset.memo));
    });
  }

  // 🏆 記録モーダル内：種目別・全セット別（Set1〜Set4）の重量×回数インラインエディタ
  function renderSessionWeightsEditor() {
    if (!el.sessionWeightsEditor || !el.sessionWeightsList) return;
    const plan = getActivePlan(state.selectedDay);
    const machineBlocks =
      state.durationMode !== 'care' && Array.isArray(plan.blocks)
        ? plan.blocks.filter((b) => b.type === 'machine' && b.id)
        : [];

    if (!machineBlocks.length) {
      el.sessionWeightsEditor.classList.add('hidden');
      el.sessionWeightsList.innerHTML = '';
      return;
    }

    el.sessionWeightsEditor.classList.remove('hidden');
    el.sessionWeightsList.innerHTML = '';

    machineBlocks.forEach((b) => {
      const isWeightEx = state.locationMode === 'home' && !b.hidePlates;
      const numSets = state.durationMode === 'short' ? Math.min(2, b.sets || 3) : b.sets || 3;
      const defReps = isWeightEx ? 10 : 12;
      const maxP = isWeightEx ? computeMaxPlatesForExercise(b.id, b.defaultPlates) : null;
      const maxDet = isWeightEx ? formatPlateDetail(maxP) : null;
      const maxLv = !isWeightEx ? computeMaxLoadLevelForExercise(b.id) : null;
      const maxLvMeta = !isWeightEx ? formatLoadLevelDetail(maxLv) : null;
      const holdWeight = hasSubTenOrDroppedWeight(b.id, isWeightEx);

      const exCard = document.createElement('div');
      exCard.className = 'swe-ex-card';

      const topBar = document.createElement('div');
      topBar.className = 'swe-ex-top';

      const titleSpan = document.createElement('div');
      titleSpan.className = 'swe-title';
      titleSpan.textContent = b.title;
      if (holdWeight) {
        const hBadge = document.createElement('span');
        hBadge.className = 'swe-badge-hold';
        hBadge.textContent = '🎯 10回挑戦中';
        titleSpan.appendChild(hBadge);
      }
      topBar.appendChild(titleSpan);

      const maxBadge = document.createElement('span');
      maxBadge.className = 'swe-badge-max';
      maxBadge.textContent = isWeightEx
        ? `次回初期: 最高 ${maxP}枚 (${maxDet.kg}kg)`
        : `次回初期: 最高 Lv.${maxLv} (${maxLvMeta.short})`;
      topBar.appendChild(maxBadge);
      exCard.appendChild(topBar);

      const setsGrid = document.createElement('div');
      setsGrid.className = 'swe-sets-grid';

      const materializeAllSetsIfNeeded = () => {
        for (let idx = 1; idx <= numSets; idx++) {
          const cur = getTodaySetEntry(b.id, idx);
          if (!cur) {
            upsertTodaySetEntry(
              b.id,
              idx,
              {
                plates: isWeightEx ? getEffectivePlatesForSet(b.id, idx, b.defaultPlates) : null,
                loadLv: !isWeightEx ? getEffectiveLoadLevelForSet(b.id, idx) : null,
                reps: getEffectiveRepsForSet(b.id, idx, defReps)
              },
              b.defaultPlates,
              isWeightEx
            );
          }
        }
      };

      for (let sIdx = 1; sIdx <= numSets; sIdx++) {
        const sPlates = isWeightEx ? getEffectivePlatesForSet(b.id, sIdx, b.defaultPlates) : null;
        const sLv = !isWeightEx ? getEffectiveLoadLevelForSet(b.id, sIdx) : null;
        const sReps = getEffectiveRepsForSet(b.id, sIdx, defReps);

        const sCard = document.createElement('div');
        sCard.className = 'swe-set-card';

        const lbl = document.createElement('span');
        lbl.className = 'swe-set-lbl';
        lbl.textContent = `Set ${sIdx}`;
        sCard.appendChild(lbl);

        const ctrls = document.createElement('div');
        ctrls.className = 'swe-set-ctrls';

        const wStep = document.createElement('div');
        wStep.className = 'swe-mini-step';
        if (isWeightEx) {
          wStep.innerHTML = `
            <button type="button" class="swe-mini-btn" data-act="p-minus" aria-label="Set${sIdx}を1枚減らす">－</button>
            <span class="swe-mini-val">${sPlates}枚</span>
            <button type="button" class="swe-mini-btn" data-act="p-plus" aria-label="Set${sIdx}を1枚増やす">＋</button>
          `;
          wStep.querySelector('[data-act="p-minus"]').addEventListener('click', () => {
            materializeAllSetsIfNeeded();
            upsertTodaySetEntry(b.id, sIdx, { plates: Math.max(1, sPlates - 1) }, b.defaultPlates, true);
            recomputeMaxAndSyncExercise(b.id, b.title, b.defaultPlates, { isWeightEx: true });
            renderCurrentStep();
            renderSessionWeightsEditor();
          });
          wStep.querySelector('[data-act="p-plus"]').addEventListener('click', () => {
            materializeAllSetsIfNeeded();
            upsertTodaySetEntry(b.id, sIdx, { plates: Math.min(DATA.maxPlates, sPlates + 1) }, b.defaultPlates, true);
            recomputeMaxAndSyncExercise(b.id, b.title, b.defaultPlates, { isWeightEx: true });
            renderCurrentStep();
            renderSessionWeightsEditor();
          });
        } else {
          wStep.innerHTML = `
            <button type="button" class="swe-mini-btn" data-act="lv-minus" aria-label="Set${sIdx}の負荷Lvを下げる">－</button>
            <span class="swe-mini-val">Lv.${sLv}</span>
            <button type="button" class="swe-mini-btn" data-act="lv-plus" aria-label="Set${sIdx}の負荷Lvを上げる">＋</button>
          `;
          wStep.querySelector('[data-act="lv-minus"]').addEventListener('click', () => {
            materializeAllSetsIfNeeded();
            upsertTodaySetEntry(b.id, sIdx, { loadLv: Math.max(1, sLv - 1) }, b.defaultPlates, false);
            recomputeMaxAndSyncExercise(b.id, b.title, b.defaultPlates, { isWeightEx: false });
            renderCurrentStep();
            renderSessionWeightsEditor();
          });
          wStep.querySelector('[data-act="lv-plus"]').addEventListener('click', () => {
            materializeAllSetsIfNeeded();
            upsertTodaySetEntry(b.id, sIdx, { loadLv: Math.min(MAX_LOAD_LV, sLv + 1) }, b.defaultPlates, false);
            recomputeMaxAndSyncExercise(b.id, b.title, b.defaultPlates, { isWeightEx: false });
            renderCurrentStep();
            renderSessionWeightsEditor();
          });
        }
        ctrls.appendChild(wStep);

        const rStep = document.createElement('div');
        rStep.className = 'swe-mini-step';
        rStep.innerHTML = `
          <button type="button" class="swe-mini-btn" data-act="r-minus" aria-label="Set${sIdx}の回数を1減らす">－</button>
          <span class="swe-mini-val reps-val">${sReps}回</span>
          <button type="button" class="swe-mini-btn" data-act="r-plus" aria-label="Set${sIdx}の回数を1増やす">＋</button>
        `;
        rStep.querySelector('[data-act="r-minus"]').addEventListener('click', () => {
          materializeAllSetsIfNeeded();
          upsertTodaySetEntry(b.id, sIdx, { reps: Math.max(1, sReps - 1) }, b.defaultPlates, isWeightEx);
          recomputeMaxAndSyncExercise(b.id, b.title, b.defaultPlates, { isWeightEx });
          renderCurrentStep();
          renderSessionWeightsEditor();
        });
        rStep.querySelector('[data-act="r-plus"]').addEventListener('click', () => {
          materializeAllSetsIfNeeded();
          upsertTodaySetEntry(b.id, sIdx, { reps: Math.min(60, sReps + 1) }, b.defaultPlates, isWeightEx);
          recomputeMaxAndSyncExercise(b.id, b.title, b.defaultPlates, { isWeightEx });
          renderCurrentStep();
          renderSessionWeightsEditor();
        });
        ctrls.appendChild(rStep);

        sCard.appendChild(ctrls);
        setsGrid.appendChild(sCard);
      }

      exCard.appendChild(setsGrid);
      el.sessionWeightsList.appendChild(exCard);
    });
  }

  function openLogModal(justFinished = false) {
    el.logModalHeading.textContent = justFinished
      ? '🎉 朝一ルーティン完走！お疲れ様でした！'
      : '🏆 ワークアウト記録 ＆ 股割りトラッカー';

    const m = computeCurrentSessionMetrics();
    el.hmStrength.textContent = `${m.strengthMin} 分`;
    el.hmCardio.textContent = `${m.cardioMin} 分`;
    el.hmFlex.textContent = `${m.flexMin} 分`;
    el.hmMeditation.textContent = `${m.meditationMin} 分`;

    renderSessionWeightsEditor();

    const todayRec = state.logs.find((l) => l.date === getTodayJst());
    el.splitLevelBtns.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('saved', Boolean(todayRec && Number(b.dataset.level) === Number(todayRec.splitLevel)));
    });

    const curMemo = todayRec?.splitMemo || '';
    if (el.splitMemoInput) el.splitMemoInput.value = curMemo;
    syncSplitQuickChipsUI(curMemo);

    updateSyncUI();
    renderWeeklyStamps();
    renderSplitHistory();
    el.logModal.classList.remove('hidden');
  }

  function saveSplitProgress({ splitLevel, splitMemo }) {
    const todayIso = getTodayJst();
    const plan = getActivePlan(state.selectedDay);
    const existing = state.logs.find((l) => l.date === todayIso);
    const nextLv = splitLevel !== undefined ? splitLevel : existing?.splitLevel || null;
    const nextMemo = splitMemo !== undefined ? splitMemo : existing?.splitMemo || '';

    upsertLocalLog(todayIso, {
      dayKey: existing?.dayKey ?? state.selectedDay,
      locationMode: existing?.locationMode || state.locationMode,
      durationMode: existing?.durationMode || state.durationMode,
      theme: existing?.theme || plan.shortTheme,
      splitLevel: nextLv,
      splitMemo: nextMemo
    });

    updateStreakBadge();
    renderWeeklyStamps();
    renderSplitHistory();
    syncSplitQuickChipsUI(nextMemo);

    if (state.syncKey) {
      relayRequest('/api/split-level', 'POST', {
        date: todayIso,
        splitLevel: nextLv || undefined,
        splitMemo: nextMemo,
        dayKey: state.selectedDay,
        dayLabel: plan.dayLabel,
        locationMode: state.locationMode,
        durationMode: state.durationMode,
        theme: plan.shortTheme
      }).then((res) => {
        if (res) {
          const lvPart = nextLv ? `Lv.${nextLv}` : '';
          const memoPart = nextMemo ? `「${nextMemo}」` : '';
          updateSyncUI(`🤸 開脚進捗 ${lvPart} ${memoPart} をNotion「健康ダッシュボード」へ保存しました！`);
        }
      });
    } else {
      updateSyncUI('📝 開脚進捗をこの端末に保存しました。');
    }
  }

  function renderSplitHistory() {
    const levelLabels = {
      1: '🌱 Lv.1 骨盤立て',
      2: '🖐️ Lv.2 指先タッチ',
      3: '✋ Lv.3 手のひら',
      4: '💪 Lv.4 肘がついた！',
      5: '🔥 Lv.5 胸ペター！'
    };
    const recent = state.logs.slice(0, 6);
    el.recentLogsList.innerHTML = recent.length
      ? recent
          .map((l) => {
            const locIcon = l.locationMode === 'hotel' ? '🏨' : '🏠';
            const durIcon = l.durationMode === 'short' ? '⚡時短 ' : l.durationMode === 'care' ? '🧘ケア ' : '';
            const medTag = l.meditationDone ? ' ・ 🧘瞑想済' : '';
            const wTag = l.weightsSummary ? ` ・ 🏋️${l.weightsSummary}` : '';
            const splitTag = l.splitLevel ? ` ・ <strong>${levelLabels[l.splitLevel]}</strong>` : '';
            const memoTag = l.splitMemo ? ` ・ 💬${l.splitMemo}` : '';
            return `<div>📅 ${l.date} ${locIcon}${durIcon}（${l.theme || '実践'}）${wTag}${medTag}${splitTag}${memoTag}</div>`;
          })
          .join('')
      : '<div>まだ記録がありません。セッション完走または上の記録ボタンから残せます！</div>';
  }

  function updateStreakBadge() {
    el.streakBadge.textContent = `${state.logs.length}回`;
  }

  // -------------------- Event Listeners --------------------
  function bindEvents() {
    el.locHomeBtn.addEventListener('click', () => setLocationMode('home'));
    el.locHotelBtn.addEventListener('click', () => setLocationMode('hotel'));

    if (el.durFullBtn) el.durFullBtn.addEventListener('click', () => setDurationMode('full'));
    if (el.durShortBtn) el.durShortBtn.addEventListener('click', () => setDurationMode('short'));
    if (el.durCareBtn) el.durCareBtn.addEventListener('click', () => setDurationMode('care'));

    if (el.mcActionBtn) {
      el.mcActionBtn.addEventListener('click', () => {
        const target = el.mcActionBtn.dataset.targetMode;
        if (target) setDurationMode(target);
      });
    }

    el.heroStartBtn.addEventListener('click', () => startSession());
    el.playPauseBtn.addEventListener('click', () => {
      if (state.isRunning) pauseSession();
      else startSession();
    });

    el.replayVoiceBtn.addEventListener('click', () => {
      ensureAudioUnlocked();
      const step = state.steps[state.currentIndex];
      if (step && step.speechText) speakShoko(step.speechText);
    });

    el.prevStepBtn.addEventListener('click', () => advanceStep(-1));
    el.nextStepBtn.addEventListener('click', () => advanceStep(1));

    el.minus10Btn.addEventListener('click', () => {
      const step = state.steps[state.currentIndex];
      if (
        step &&
        step.kind === 'video' &&
        state.ytReady &&
        state.ytPlayer &&
        !state.ytStepFailed &&
        typeof state.ytPlayer.getCurrentTime === 'function'
      ) {
        const endSec = step.endSeconds || (step.startSeconds || 0) + step.durationSeconds;
        const cur = state.ytPlayer.getCurrentTime() || step.startSeconds || 0;
        const target = Math.min(endSec - 1, cur + 10);
        state.videoStepSeekVerified = true;
        state.ytPlayer.seekTo(target, true);
        state.remainingSec = Math.max(1, Math.ceil(endSec - target));
        updateTimerUI();
        return;
      }
      state.remainingSec = Math.max(1, state.remainingSec - 10);
      updateTimerUI();
    });

    el.plus15Btn.addEventListener('click', () => {
      const step = state.steps[state.currentIndex];
      if (
        step &&
        step.kind === 'video' &&
        state.ytReady &&
        state.ytPlayer &&
        !state.ytStepFailed &&
        typeof state.ytPlayer.getCurrentTime === 'function'
      ) {
        const endSec = step.endSeconds || (step.startSeconds || 0) + step.durationSeconds;
        const cur = state.ytPlayer.getCurrentTime() || step.startSeconds || 0;
        const target = Math.max(0, cur - 15);
        state.videoStepSeekVerified = true;
        state.ytPlayer.seekTo(target, true);
        state.remainingSec = Math.max(1, Math.ceil(endSec - target));
        state.stepTotalSec = Math.max(state.stepTotalSec, state.remainingSec);
        updateTimerUI();
        return;
      }
      state.remainingSec += 15;
      state.stepTotalSec = Math.max(state.stepTotalSec, state.remainingSec);
      updateTimerUI();
    });

    el.plateMinusBtn.addEventListener('click', () => adjustPlates(-1));
    el.platePlusBtn.addEventListener('click', () => adjustPlates(1));

    if (el.repsMinusBtn) el.repsMinusBtn.addEventListener('click', () => adjustReps(-1));
    if (el.repsPlusBtn) el.repsPlusBtn.addEventListener('click', () => adjustReps(1));

    if (el.overloadAcceptBtn) {
      el.overloadAcceptBtn.addEventListener('click', acceptOverloadUpgrade);
    }

    if (el.repQuickRow) {
      el.repQuickRow.querySelectorAll('.rep-pill').forEach((pill) => {
        pill.addEventListener('click', () => recordQuickSetReps(pill.dataset.reps));
      });
    }

    if (el.rpeBtnRow) {
      el.rpeBtnRow.querySelectorAll('.rpe-btn').forEach((btn) => {
        btn.addEventListener('click', () => recordExerciseRpe(btn.dataset.rpe));
      });
    }

    el.toggleDemoPipBtn.addEventListener('click', () => {
      state.showDemoPip = !state.showDemoPip;
      renderCurrentStep();
      syncYouTubeForStep(state.steps[state.currentIndex], state.isRunning);
    });

    el.ytUnblockBtn.addEventListener('click', () => {
      el.ytUnblockBtn.classList.add('hidden');
      if (state.ytPlayer && state.ytPlayer.playVideo) {
        state.ytPlayer.unMute();
        state.ytPlayer.setVolume(100);
        state.ytPlayer.playVideo();
      }
    });

    el.shuffleStretchBtn.addEventListener('click', () => shuffleCurrentPoolVideo());
    el.replayStepVideoBtn.addEventListener('click', () => {
      const step = state.steps[state.currentIndex];
      if (step && step.kind === 'video') {
        state.videoStepSeekVerified = true;
        state.remainingSec = step.durationSeconds;
        state.stepTotalSec = step.durationSeconds;
        updateTimerUI();
        if (state.ytReady && state.ytPlayer && state.ytPlayer.seekTo) {
          state.ytPlayer.seekTo(step.startSeconds || 0, true);
          if (state.isRunning) state.ytPlayer.playVideo();
        }
      }
    });

    el.voiceToggleBtn.addEventListener('click', () => {
      state.voiceEnabled = !state.voiceEnabled;
      localStorage.setItem(STORAGE_KEYS.voiceEnabled, String(state.voiceEnabled));
      updateVoiceBtnUI();
      if (!state.voiceEnabled) {
        state.shokoAudio.pause();
        el.shokoAvatar?.classList.remove('speaking');
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      }
    });

    el.fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });

    el.openTimelineBtn.addEventListener('click', openTimelineModal);
    el.nextUpBar.addEventListener('click', openTimelineModal);

    el.openPoolModalBtn.addEventListener('click', () => {
      renderPoolModal();
      el.poolModal.classList.remove('hidden');
    });

    el.openLogModalBtn.addEventListener('click', () => openLogModal(false));

    el.openSyncModalBtn.addEventListener('click', () => {
      updateSyncUI();
      if (el.syncKeyInput) {
        el.syncKeyInput.value = state.syncKey || '';
      }
      el.syncModal.classList.remove('hidden');
    });

    el.syncNowBtn.addEventListener('click', () => {
      pullCloudState({ silent: false });
    });

    el.syncKeyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      let raw = (el.syncKeyInput.value || '').trim();
      const m = raw.match(/(?:key|syncKey)=([A-Za-z0-9_-]+)/);
      if (m) raw = m[1];
      state.syncKey = raw;
      if (raw) {
        localStorage.setItem(STORAGE_KEYS.syncKey, raw);
        pullCloudState({ silent: false });
      } else {
        localStorage.removeItem(STORAGE_KEYS.syncKey);
        updateSyncUI();
      }
    });

    el.manualSaveSessionBtn.addEventListener('click', () => {
      syncFullSessionToCloud({ fromManualBtn: true });
    });

    el.manualSaveMeditationBtn.addEventListener('click', () => {
      syncStandaloneMeditationToCloud();
    });

    window.addEventListener('online', () => {
      if (state.syncKey) pullCloudState({ silent: true });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.syncKey && Date.now() - state.lastPullMs > 45000) {
        pullCloudState({ silent: true });
      }
    });

    document.querySelectorAll('.close-modal-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.close);
        if (target) target.classList.add('hidden');
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.add('hidden');
      });
    });

    el.addVideoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const vid = extractYoutubeId(el.customVideoUrl.value);
      if (!vid) {
        alert('有効なYouTubeのURLまたは11文字の動画IDを入力してください。');
        return;
      }
      const title = el.customVideoTitle.value.trim() || 'マイストレッチ動画';
      const startSec = Number(el.customVideoStart.value) || 0;
      const mins = Number(el.customVideoMinutes.value) || 10;

      const newEntry = {
        id: 'custom_' + Date.now(),
        category: 'マイ追加動画',
        badge: 'マイ登録ストレッチ',
        title,
        channel: 'Custom YouTube',
        videoId: vid,
        startSeconds: startSec,
        endSeconds: startSec + mins * 60,
        durationSeconds: mins * 60,
        focus: 'カスタム登録したお気に入りストレッチ動画です。'
      };
      state.customStretches.push(newEntry);
      saveJson(STORAGE_KEYS.customStretches, state.customStretches);
      el.customVideoUrl.value = '';
      el.customVideoTitle.value = '';
      applySelectedStretch(newEntry.id);
      if (state.syncKey) {
        relayRequest('/api/custom-stretches', 'POST', { customStretches: state.customStretches });
      }
    });

    el.splitLevelBtns.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const lv = Number(btn.dataset.level);
        el.splitLevelBtns.querySelectorAll('button').forEach((b) => b.classList.remove('saved'));
        btn.classList.add('saved');
        saveSplitProgress({ splitLevel: lv });
      });
    });

    if (el.splitQuickChips) {
      el.splitQuickChips.querySelectorAll('.split-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const phrase = chip.dataset.memo;
          const curVal = (el.splitMemoInput?.value || '').trim();
          const parts = curVal ? curVal.split(' / ').map((s) => s.trim()).filter(Boolean) : [];
          const idx = parts.indexOf(phrase);
          if (idx >= 0) parts.splice(idx, 1);
          else parts.push(phrase);
          const nextMemo = parts.join(' / ');
          if (el.splitMemoInput) el.splitMemoInput.value = nextMemo;
          saveSplitProgress({ splitMemo: nextMemo });
        });
      });
    }

    if (el.splitMemoForm) {
      el.splitMemoForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const nextMemo = (el.splitMemoInput?.value || '').trim();
        saveSplitProgress({ splitMemo: nextMemo });
      });
    }
  }

  function updateVoiceBtnUI() {
    el.voiceToggleBtn.classList.toggle('muted', !state.voiceEnabled);
    el.voiceToggleBtn.innerHTML = state.voiceEnabled
      ? '🎙️ <span class="btn-sublabel">ショウコON</span>'
      : '🔇 <span class="btn-sublabel">消音中</span>';
  }

  // -------------------- Boot --------------------
  function init() {
    updateVoiceBtnUI();
    updateSyncUI();
    updateStreakBadge();
    renderMorningCondition();
    bindEvents();
    initYouTubeApi();
    selectDay(state.selectedDay);
    if (state.syncKey) {
      pullCloudState({ silent: true });
    }
  }

  init();
})();
