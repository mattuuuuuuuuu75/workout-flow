// ============================================================================
// 筋トレNOW スタジオ v4 — 朝一スマート・コーチング仕様
// （建設NOWニュースUI × 厳密図解 × ショウコ音声 × 5分瞑想 × PixelWatch睡眠HRV連動 × 漸進負荷ナビ × 時短切替）
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

  function getTodayJst() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

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

  // -------------------- State --------------------
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
    plateMap: loadJson(STORAGE_KEYS.plates, {}),
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
    plateMinusBtn: document.getElementById('plateMinusBtn'),
    platePlusBtn: document.getElementById('platePlusBtn'),
    plateCountNum: document.getElementById('plateCountNum'),

    rpeFeedbackBox: document.getElementById('rpeFeedbackBox'),
    rpeHeadingTitle: document.getElementById('rpeHeadingTitle'),
    rpeStreakHint: document.getElementById('rpeStreakHint'),
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
    // 同じ日のリロードなら選択維持、翌朝になったら標準「通常フル」へリセット
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
    // JSTの曜日を採用
    const jstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
    return jstDay;
  }

  function getActivePlan(dayKey) {
    if (state.locationMode === 'hotel' && DATA.hotelPlans[dayKey]) {
      return DATA.hotelPlans[dayKey];
    }
    return DATA.homePlans[dayKey];
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

  function getPlatesForExercise(exId, defaultPlates) {
    if (exId && typeof state.plateMap[exId] === 'number') {
      return state.plateMap[exId];
    }
    return defaultPlates || 5;
  }

  function formatPlateDetail(plates) {
    const lbs = plates * DATA.plateStepLbs;
    const kg = (plates * DATA.plateStepKg).toFixed(1).replace(/\.0$/, '');
    return { lbs, kg, text: `${lbs} lbs / 約${kg} kg` };
  }

  function cleanExerciseShortTitle(title) {
    return String(title || '').replace(/^[①②③④⑤]\s*/, '');
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

    // ① 🧘 ケア＆瞑想 15分編成（疲労蓄積朝・睡眠不足朝でもゼロにしない回復専用コース）
    if (durMode === 'care') {
      const careSteps = [
        {
          kind: 'warmup',
          themePhase: 'PREP',
          phaseLabel: 'MORNING CARE PREP',
          title: '🌅 朝一リカバリー深呼吸 ＆ 肩・骨盤ゆらし',
          image: './images/exercises/warmup_shoulder_roll.jpg',
          actionSteps: ['① 鼻から4秒かけて深く吸う', '② 口から6秒かけて脱力しながら吐く', '③ 肩と股関節をやさしく揺らす'],
          subtitle: '無理に追い込まず、朝の関節ケアと自律神経リセットに特化した15分編成です。',
          setupNote: '今朝は身体を労わる15分ケア編成です。深い呼吸で全身に酸素を巡らせましょう。',
          durationSeconds: 35,
          pulley: 'ヨガマット / ベッド可',
          attachment: 'リカバリー・ケア編成',
          cues: ['疲労がある朝でも「ゼロにしない」ことが最大の継続力になります'],
          speechText: 'おはようございます！今朝は身体をいたわる15分ケア編成ですね。まずは深く息を吸って、肩と骨盤まわりをゆったりほぐしていきましょう。'
        }
      ];

      if (stretchObj) {
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
          startSeconds: stretchObj.startSeconds || 0,
          durationSeconds: Math.min(stretchObj.durationSeconds, 540),
          safetyTip: '🤸 朝はまだ筋肉が硬めなので、痛気持ちいい6〜7割の伸びで呼吸を続けます',
          speechText: `それでは股割り・柔軟ケアに入りましょう。朝一番の身体をやさしく目覚めさせるように、息を吐きながら伸ばしていきますよ。`
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
          startSeconds: medObj.startSeconds || 0,
          durationSeconds: medObj.durationSeconds,
          safetyTip: '🧘 5分間瞑想：目を閉じて肩の力を抜き、ゆっくりと自然な呼吸に意識を向けます',
          speechText:
            medObj.speech ||
            '仕上げの5分間は、瞑想タイムです。ゆっくりと深い呼吸を続けながら、穏やかな時間をお過ごしください。'
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
      // 時短20分モードの最適化フィルタ
      if (isShort) {
        if (hasMachineBlocks) {
          // 筋トレ日はHIIT動画とその直前のマット移動トランジションをスキップし、2セット集中＋股割り6分＋瞑想5分へ直結
          if (block.type === 'video') return;
          const nextBlock = plan.blocks[blockIdx + 1];
          if (block.type === 'transition' && nextBlock && nextBlock.type === 'video') return;
        } else {
          // 水・土・日の動画中心日はメイン動画1本(最大6分)＋開脚(最大5分)＋瞑想5分に凝縮
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
        if (lastFinishedMachine && !lastFinishedMachine.hidePlates) {
          stepObj.prevExerciseId = lastFinishedMachine.id;
          stepObj.prevExerciseTitle = lastFinishedMachine.title;
          stepObj.prevDefaultPlates = lastFinishedMachine.defaultPlates;
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
            demoRange: block.demoRange || [30, 60],
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
              actionSteps: ['① 深い呼吸で酸素を送る', `② 次は セット ${s + 1} / ${totalSets}`, '③ 手応えメモも1タップ記録OK'],
              subtitle: `次は セット ${s + 1} / ${totalSets}`,
              setIndex: s,
              totalSets,
              durationSeconds: restSec,
              defaultPlates: block.defaultPlates,
              pulley: block.pulley,
              attachment: block.attachment,
              demoRange: block.demoRange || [30, 60],
              setupNote: restVoices[(s - 1) % restVoices.length],
              cues: block.cues || [],
              speechText: restVoices[(s - 1) % restVoices.length]
            });
          }
        }
        lastFinishedMachine = block;
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
        const vidDur = isShort ? Math.min(block.durationSeconds, 360) : block.durationSeconds;
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
          startSeconds: block.startSeconds || 0,
          durationSeconds: vidDur,
          safetyTip: isRelaxOrStretch
            ? '🧘 呼吸を止めず、膝に違和感がある角度は無理せず緩めてキープ'
            : '🛡️ 膝保護：スクワット・ジャンプが出たら上半身パンチやツイストに置換OK',
          speechText: block.speech || `${block.title}、スタートです！`
        });
      } else if (block.type === 'daily_stretch' && stretchObj) {
        lastFinishedMachine = null;
        const stretchDur = isShort ? Math.min(stretchObj.durationSeconds, 360) : stretchObj.durationSeconds;
        steps.push({
          kind: 'video',
          isDailyStretch: true,
          isDailyMeditation: false,
          stretchId: stretchObj.id,
          themePhase: 'STRETCH',
          phaseLabel: block.phase,
          badge: `${stretchObj.badge}${isShort ? '（時短6分）' : '（日替わり選出）'}`,
          title: stretchObj.title,
          subtitle: `${stretchObj.channel}｜${stretchObj.focus}`,
          channel: stretchObj.channel,
          videoId: stretchObj.videoId,
          startSeconds: stretchObj.startSeconds || 0,
          durationSeconds: stretchDur,
          safetyTip: '🤸 股割りタイム：痛気持ちいい7割の伸びで、吐く息ごとに力を抜きます',
          speechText: `本日の股割りストレッチは、${stretchObj.category}、のメニューです！息をふーっと吐きながら、気持ちよく伸ばしていきましょうね。`
        });
      } else if (block.type === 'daily_meditation' && medObj) {
        lastFinishedMachine = null;
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
          startSeconds: medObj.startSeconds || 0,
          durationSeconds: medObj.durationSeconds,
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

  // -------------------- YouTube IFrame API --------------------
  function initYouTubeApi() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
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
          }
          if (ev.data === window.YT.PlayerState.ENDED && step.kind === 'video' && state.isRunning) {
            advanceStep(1);
          }
        },
        onError: () => {
          el.ytUnblockBtn.classList.add('hidden');
        }
      }
    });
  };

  function syncYouTubeForStep(step, autoPlayNow) {
    clearInterval(state.demoLoopHandle);
    el.ytUnblockBtn.classList.add('hidden');

    const run = () => {
      if (!state.ytPlayer || typeof state.ytPlayer.loadVideoById !== 'function') return;

      if (step.kind === 'video') {
        const endSec = (step.startSeconds || 0) + step.durationSeconds + 5;
        if (autoPlayNow) {
          state.ytPlayer.loadVideoById({
            videoId: step.videoId,
            startSeconds: step.startSeconds || 0,
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
            startSeconds: step.startSeconds || 0
          });
        }
      } else {
        const [dStart, dEnd] = step.demoRange || [30, 58];
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
            if (cur >= dEnd || cur < dStart - 2) {
              state.ytPlayer.seekTo(dStart, true);
            }
          }, 1000);
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

  function resolveRpeTargetForStep(step) {
    if (!step || state.locationMode !== 'home') return null;
    if (step.kind === 'rest' && step.exerciseId && !step.hidePlates) {
      return {
        exerciseId: step.exerciseId,
        title: step.title.replace(/（休憩）$/, ''),
        defaultPlates: step.defaultPlates
      };
    }
    if (step.kind === 'work' && step.exerciseId && !step.hidePlates && step.setIndex === step.totalSets) {
      return {
        exerciseId: step.exerciseId,
        title: step.title,
        defaultPlates: step.defaultPlates
      };
    }
    if ((step.kind === 'setup' || step.kind === 'transition') && step.prevExerciseId) {
      return {
        exerciseId: step.prevExerciseId,
        title: step.prevExerciseTitle || step.prevExerciseId,
        defaultPlates: step.prevDefaultPlates || 5
      };
    }
    return null;
  }

  function renderOverloadAndRpe(step, activePlateStep) {
    // 1. 漸進性過負荷（ピン＋1枚提案）バナー
    if (el.overloadBanner) {
      el.overloadBanner.classList.add('hidden');
      if (activePlateStep && state.locationMode === 'home' && !activePlateStep.hidePlates) {
        const exId = activePlateStep.exerciseId;
        const rpe = state.rpeMap[exId] || {};
        const curPlates = getPlatesForExercise(exId, activePlateStep.defaultPlates);
        const todayIso = getTodayJst();
        if (
          Number(rpe.easyStreak || 0) >= 2 &&
          rpe.lastUpgradeDate !== todayIso &&
          curPlates < DATA.maxPlates
        ) {
          const nextPlates = curPlates + 1;
          const nextDet = formatPlateDetail(nextPlates);
          el.overloadBanner.classList.remove('hidden');
          el.overloadBanner.dataset.exerciseId = exId;
          el.overloadBanner.dataset.nextPlates = String(nextPlates);
          el.overloadBanner.dataset.exerciseName = activePlateStep.title;
          el.overloadText.textContent = `🚀 前回${rpe.easyStreak}連続「余裕😊」！${curPlates}→${nextPlates}枚目(${nextDet.kg}kg)へ上げますか？`;
        }
      }
    }

    // 2. 手応えワンタップ（休憩中・最終セット・直後の移行中に表示）
    if (el.rpeFeedbackBox) {
      const target = resolveRpeTargetForStep(step);
      if (!target) {
        el.rpeFeedbackBox.classList.add('hidden');
      } else {
        el.rpeFeedbackBox.classList.remove('hidden');
        el.rpeFeedbackBox.dataset.exerciseId = target.exerciseId;
        el.rpeFeedbackBox.dataset.exerciseName = target.title;
        el.rpeFeedbackBox.dataset.defaultPlates = String(target.defaultPlates || 5);

        const shortName = cleanExerciseShortTitle(target.title);
        el.rpeHeadingTitle.textContent =
          step.kind === 'setup' || step.kind === 'transition'
            ? `直前「${shortName}」の手応えは？`
            : `「${shortName}」の手応えメモ`;

        const rpeInfo = state.rpeMap[target.exerciseId] || {};
        const todayIso = getTodayJst();
        const ratedToday = rpeInfo.lastRatedDate === todayIso ? rpeInfo.lastRpe : null;

        el.rpeBtnRow.querySelectorAll('.rpe-btn').forEach((btn) => {
          btn.classList.toggle('selected', Boolean(ratedToday && btn.dataset.rpe === ratedToday));
        });

        const streak = Number(rpeInfo.easyStreak || 0);
        if (streak >= 2) {
          el.rpeStreakHint.textContent = '🔥 次回＋1枚UP提案ON！';
        } else if (streak === 1) {
          el.rpeStreakHint.textContent = '✨ あと1回「余裕」で＋1枚提案';
        } else if (ratedToday) {
          el.rpeStreakHint.textContent = '✓ 本日の手応え記録済';
        } else {
          el.rpeStreakHint.textContent = '余裕2連続で次回＋1枚提案';
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

      if (step.exerciseId && !step.hidePlates) {
        const plates = getPlatesForExercise(step.exerciseId, step.defaultPlates);
        const detail = formatPlateDetail(plates);
        el.hwPinDisplay.classList.remove('hidden');
        el.hwPinDisplay.textContent = `ピン：上から ${plates} 枚目 (約${detail.kg}kg)`;
      } else {
        const upcomingMachine = state.steps
          .slice(state.currentIndex + 1)
          .find((s) => s.exerciseId && !s.hidePlates);
        if (upcomingMachine) {
          const plates = getPlatesForExercise(upcomingMachine.exerciseId, upcomingMachine.defaultPlates);
          const detail = formatPlateDetail(plates);
          el.hwPinDisplay.classList.remove('hidden');
          el.hwPinDisplay.textContent = `次ピン：${plates} 枚目 (約${detail.kg}kg)`;
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

    updateTimerUI();

    const activePlateStep =
      step.exerciseId && !step.hidePlates
        ? step
        : state.steps.slice(state.currentIndex + 1).find((s) => s.exerciseId && !s.hidePlates);

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
    } else if (activePlateStep) {
      el.plateSelector.classList.remove('hidden');
      const pCount = getPlatesForExercise(activePlateStep.exerciseId, activePlateStep.defaultPlates);
      const pDetail = formatPlateDetail(pCount);
      el.plateCountNum.textContent = pCount;
      el.plateKgHint.textContent = pDetail.text;
      renderOverloadAndRpe(step, activePlateStep);
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
    const step = state.steps[index];
    state.stepTotalSec = step.durationSeconds;
    state.remainingSec = step.durationSeconds;

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
    renderCurrentStep();

    if (firstLaunch) {
      playBeep(1046.5, 140, 0.12);
      speakShoko(step.speechText);
      syncYouTubeForStep(step, true);
      prefetchSessionVoices();
    } else {
      if (step.kind === 'video' && state.ytPlayer && state.ytPlayer.playVideo) {
        state.ytPlayer.unMute();
        state.ytPlayer.playVideo();
      } else {
        syncYouTubeForStep(step, true);
      }
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
    state.remainingSec -= 1;

    const step = state.steps[state.currentIndex];

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
    if (state.locationMode === 'home' && state.durationMode !== 'care' && Array.isArray(plan.blocks)) {
      plan.blocks.forEach((b) => {
        if (b.type === 'machine' && b.id && !b.hidePlates) {
          const p = getPlatesForExercise(b.id, b.defaultPlates);
          const det = formatPlateDetail(p);
          const rpeObj = state.rpeMap[b.id] || {};
          const todayRpe = rpeObj.lastRatedDate === getTodayJst() ? rpeObj.lastRpe : undefined;
          weightsMap[b.id] = { title: b.title, plates: p, kg: Number(det.kg), rpe: todayRpe };
          const shortTitle = b.title.replace(/（.*?）/g, (m) =>
            m.includes('横') ? '(横)' : m.includes('縦') ? '(縦)' : ''
          );
          const rpeIcon =
            todayRpe === 'easy' ? '😊' : todayRpe === 'good' ? '👍' : todayRpe === 'hard' ? '🔥' : '';
          weightParts.push(`${shortTitle}: ${p}枚(${det.kg}kg)${rpeIcon}`);
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
      if (el.plateHeadingTitle) el.plateHeadingTitle.textContent = 'ピン位置メモ（端末保存）';
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
      if (el.plateHeadingTitle) el.plateHeadingTitle.textContent = 'ピン位置メモ（Notion自動同期）';
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
    } catch (err) {
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

    // 0. 朝一 Pixel Watch 睡眠・HRV コンディション反映
    if (data.morningCondition) {
      state.morningCondition = data.morningCondition;
      saveJson(STORAGE_KEYS.morningCond, data.morningCondition);
    }

    // 1. IROTEC ピン枚数 ＆ 漸進性過負荷RPEマージ
    if (data.plates && typeof data.plates === 'object') {
      state.plateMap = { ...state.plateMap, ...data.plates };
      saveJson(STORAGE_KEYS.plates, state.plateMap);
    }
    if (data.rpeMap && typeof data.rpeMap === 'object') {
      state.rpeMap = { ...state.rpeMap, ...data.rpeMap };
      saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);
    }

    // 2. カスタム追加YouTubeストレッチ動画マージ
    if (Array.isArray(data.customStretches) && data.customStretches.length > 0) {
      const byVid = new Map();
      [...state.customStretches, ...data.customStretches].forEach((c) => {
        if (c && c.videoId) byVid.set(c.videoId, c);
      });
      state.customStretches = [...byVid.values()];
      saveJson(STORAGE_KEYS.customStretches, state.customStretches);
    }

    // 3. セッション＆開脚ログマージ
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
      });
      state.logs = [...logMap.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      saveJson(STORAGE_KEYS.logs, state.logs);
    }

    updateStreakBadge();
    renderMorningCondition();
    renderCurrentStep();
    if (!el.logModal.classList.contains('hidden')) {
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
      splitLevel: existing?.splitLevel || null,
      splitMemo: existing?.splitMemo || ''
    });
    updateStreakBadge();
    renderWeeklyStamps();

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
          ? '✅ 朝一ワークアウト＆5分瞑想をNotion「健康ダッシュボード」とマインドフルネスログへ記録しました！'
          : '🎉 Notion「健康ダッシュボード」＆5分瞑想ログへ自動保存しました！下の開脚レベル・柔軟メモも記録できます。'
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

  // -------------------- Plate Adjustment & Progressive Overload RPE --------------------
  function adjustPlates(delta) {
    const step = state.steps[state.currentIndex];
    const targetStep =
      step.exerciseId && !step.hidePlates
        ? step
        : state.steps.slice(state.currentIndex + 1).find((s) => s.exerciseId && !s.hidePlates);
    if (!targetStep) return;

    const exId = targetStep.exerciseId;
    const cur = getPlatesForExercise(exId, targetStep.defaultPlates);
    const next = Math.max(1, Math.min(DATA.maxPlates, cur + delta));
    state.plateMap[exId] = next;
    saveJson(STORAGE_KEYS.plates, state.plateMap);
    renderCurrentStep();

    if (state.syncKey) {
      clearTimeout(state.plateSyncTimers[exId]);
      state.plateSyncTimers[exId] = setTimeout(() => {
        relayRequest('/api/plates', 'POST', {
          exerciseId: exId,
          plates: next,
          exerciseName: targetStep.title,
          rpeInfo: state.rpeMap[exId] || undefined
        });
      }, 650);
    }
  }

  function acceptOverloadUpgrade() {
    if (!el.overloadBanner) return;
    const exId = el.overloadBanner.dataset.exerciseId;
    const nextPlates = Number(el.overloadBanner.dataset.nextPlates);
    const exName = el.overloadBanner.dataset.exerciseName || exId;
    if (!exId || !nextPlates) return;

    const todayIso = getTodayJst();
    state.plateMap[exId] = nextPlates;
    const updatedRpe = {
      ...(state.rpeMap[exId] || {}),
      easyStreak: 0,
      lastUpgradeDate: todayIso,
      lastRpe: 'good'
    };
    state.rpeMap[exId] = updatedRpe;
    saveJson(STORAGE_KEYS.plates, state.plateMap);
    saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);

    ensureAudioUnlocked();
    playBeep(1046.5, 130, 0.12);
    speakShoko('ナイスチャレンジです！ピンを1枚上げて、丁寧なフォームで効かせていきましょう！');
    renderCurrentStep();

    if (state.syncKey) {
      relayRequest('/api/plates', 'POST', {
        exerciseId: exId,
        plates: nextPlates,
        exerciseName: exName,
        rpeInfo: updatedRpe
      });
    }
  }

  function recordExerciseRpe(rpeValue) {
    if (!el.rpeFeedbackBox || !['easy', 'good', 'hard'].includes(rpeValue)) return;
    const exId = el.rpeFeedbackBox.dataset.exerciseId;
    const exName = el.rpeFeedbackBox.dataset.exerciseName || exId;
    const defPlates = Number(el.rpeFeedbackBox.dataset.defaultPlates || 5);
    if (!exId) return;

    const todayIso = getTodayJst();
    const prev = state.rpeMap[exId] || {};
    // 同日中の押し直しでストリークが二重加算されないよう基準値を保持
    const baseStreak =
      prev.baseStreakDate === todayIso ? Number(prev.baseStreak || 0) : Number(prev.easyStreak || 0);
    const nextEasyStreak = rpeValue === 'easy' ? baseStreak + 1 : 0;

    const updatedRpe = {
      ...prev,
      lastRpe: rpeValue,
      easyStreak: nextEasyStreak,
      baseStreak,
      baseStreakDate: todayIso,
      lastRatedDate: todayIso
    };
    state.rpeMap[exId] = updatedRpe;
    saveJson(STORAGE_KEYS.rpeMap, state.rpeMap);

    playBeep(rpeValue === 'easy' ? 1046.5 : 880, 80, 0.08);
    renderCurrentStep();

    const curPlates = getPlatesForExercise(exId, defPlates);
    if (state.syncKey) {
      clearTimeout(state.plateSyncTimers[exId]);
      state.plateSyncTimers[exId] = setTimeout(() => {
        relayRequest('/api/plates', 'POST', {
          exerciseId: exId,
          plates: curPlates,
          exerciseName: exName,
          rpeInfo: updatedRpe
        });
      }, 400);
    }
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

  function openLogModal(justFinished = false) {
    el.logModalHeading.textContent = justFinished
      ? '🎉 朝一ルーティン完走！お疲れ様でした！'
      : '🏆 ワークアウト記録 ＆ 股割りトラッカー';

    const m = computeCurrentSessionMetrics();
    el.hmStrength.textContent = `${m.strengthMin} 分`;
    el.hmCardio.textContent = `${m.cardioMin} 分`;
    el.hmFlex.textContent = `${m.flexMin} 分`;
    el.hmMeditation.textContent = `${m.meditationMin} 分`;

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
            const splitTag = l.splitLevel ? ` ・ <strong>${levelLabels[l.splitLevel]}</strong>` : '';
            const memoTag = l.splitMemo ? ` ・ 💬${l.splitMemo}` : '';
            return `<div>📅 ${l.date} ${locIcon}${durIcon}（${l.theme || '実践'}）${medTag}${splitTag}${memoTag}</div>`;
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
      state.remainingSec = Math.max(1, state.remainingSec - 10);
      updateTimerUI();
    });
    el.plus15Btn.addEventListener('click', () => {
      state.remainingSec += 15;
      state.stepTotalSec = Math.max(state.stepTotalSec, state.remainingSec);
      updateTimerUI();
    });

    el.plateMinusBtn.addEventListener('click', () => adjustPlates(-1));
    el.platePlusBtn.addEventListener('click', () => adjustPlates(1));

    if (el.overloadAcceptBtn) {
      el.overloadAcceptBtn.addEventListener('click', acceptOverloadUpgrade);
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
      if (step && step.kind === 'video' && state.ytPlayer) {
        state.ytPlayer.seekTo(step.startSeconds || 0, true);
        state.ytPlayer.playVideo();
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
