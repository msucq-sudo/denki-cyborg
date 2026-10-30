import * as THREE from 'three';
import { Input } from './core/input';
import { EventBus } from './core/events';
import { createWorld } from './core/world';
import type { World } from './core/types';
import { updateProjectiles } from './core/projectiles';
import { updatePickups } from './core/pickups';
import { updateEffects } from './core/effects';
import { initPlayer, updatePlayer, updateGun, setPlayerWeapon } from './player/player';
import { initAbsorb, updateAbsorb } from './abilities/absorb';
import { initHack, updateHack } from './abilities/hack';
import { updateGrapple } from './core/grapple';
import { initFunctions, updateFunctions } from './abilities/functions';
import { updateSkills } from './abilities/skills';
import { updateWeaponSwitch, giveWeapon, WEAPON_ORDER } from './player/weaponSwitch';
import { updateEnemies } from './enemies/api';
import { buildDungeon, updateLevel } from './level/dungeon';
import { buildFloor1, buildFloor1Revisit, updateFloor1, FLOOR1_EXPOSURE, getFloor1Memo, restoreFloor1Memo } from './level/floor1';
import { buildFloor2, updateFloor2, floor2Hooks, wakeFromRest, FLOOR2_EXPOSURE, type Floor2State } from './level/floor2';
import { buildSurge, updateSurge, SURGE_EXPOSURE } from './level/surge';
import { buildCamp1, updateCamp1, CAMP1_EXPOSURE, getCamp1Memo, setCamp1Memo, prepareCamp1RoomResume } from './level/camp1';
import { readSave, readSaveHistory, getSaveCheckpointId, writeSave, describeSave, SAVE_VERSION, type SaveData } from './core/save';
import { activeCheckpointId, checkpointChoices, CHECKPOINT_TARGETS, prepareFloor1Checkpoint } from './core/checkpoints';
import { toast } from './core/combat';
import { buildCamp2, updateCamp2, CAMP2_EXPOSURE } from './level/camp2';
import { CAMERA, CHARACTER } from './config/balance';
import { syncPlayerStats } from './progression/effects';
import { createHUD } from './ui/hud';
import { getDriveHud } from './ui/driveHud';
import { createUpgradeScreen } from './ui/upgradeScreen';
import { initAudio, resumeAudio, updateAudio } from './audio/sfx';
import './ui/style.css';

// ?level=floor1 で研究所1階、?level=floor2 で2階（サイボーグ改造室）、?level=surge でガレージ→サージ収容所への道。
// ?level=camp1 でサージ収容所 1階（&start=boss で中ボス戦の前から）。
// 既定はアルファ版ダンジョン。?start=drive のように開始地点を指定できる（レベルが world.level.data.startAt を読む）
type LevelId = 'dungeon' | 'floor1' | 'floor2' | 'surge' | 'camp1' | 'camp2';
const urlQ = new URLSearchParams(location.search);
const levelParam = urlQ.get('level');
let levelId: LevelId = levelParam === 'floor1' || levelParam === 'floor2' || levelParam === 'surge' || levelParam === 'camp1' || levelParam === 'camp2' ? levelParam : 'dungeon';
const initialLevelId = levelId;
/** 次に作る World の開始地点（レベルごとの意味。リトライ地点にも使う） */
let startAt: string | undefined = urlQ.get('start') ?? undefined;
/** 2階から1階へ戻ってきた（戦闘は解決済みの状態で始める） */
let floor1Revisit = false;
const LEVELS: Record<LevelId, { build: (w: World) => void; tick: (w: World, dt: number) => void; exposure: number }> = {
  dungeon: { build: buildDungeon, tick: updateLevel, exposure: 1.05 },
  floor1: { build: (w) => (floor1Revisit ? buildFloor1Revisit(w) : buildFloor1(w)), tick: updateFloor1, exposure: FLOOR1_EXPOSURE },
  floor2: { build: buildFloor2, tick: updateFloor2, exposure: FLOOR2_EXPOSURE },
  surge: { build: buildSurge, tick: updateSurge, exposure: SURGE_EXPOSURE },
  camp1: { build: buildCamp1, tick: updateCamp1, exposure: CAMP1_EXPOSURE },
  camp2: { build: buildCamp2, tick: updateCamp2, exposure: CAMP2_EXPOSURE },
};
const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LEVELS[levelId].exposure;
container.appendChild(renderer.domElement);

const events = new EventBus();
const input = new Input(renderer.domElement);
initAudio(events);

// 強化画面（2階のベッドで眠り終わると開く）。画面は1つだけ作って使い回す
const upgradeScreen = createUpgradeScreen(input, events);
floor2Hooks.onSleepComplete = (w) => {
  if (w !== world) return false;
  upgradeScreen.open(w, { onClose: () => wakeFromRest(w) });
  return true;
};
// ?gears=N で歯車 N 個から始める（強化画面の確認用）
const gearsParam = Number(new URLSearchParams(location.search).get('gears'));
// ?unlock=vacuum,autoAim,shotgun,assault（または ?unlock=all）で解放した状態から始める（開発中の確認用）
const unlockParam = (urlQ.get('unlock') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
function applyUnlocks(w: World, list: string[]): void {
  const all = list.includes('all');
  if (all || list.includes('vacuum')) w.unlocks.vacuum = true;
  if (all || list.includes('autoAim')) w.unlocks.autoAim = true;
  for (const id of WEAPON_ORDER) if (all || list.includes(id)) giveWeapon(w, id);
}
// 武器の切り替え（十字キー左右 / 1・3）→ 見た目の武器を差し替える
events.on('weaponSwitch', (p) => setPlayerWeapon(world, p.id));

let world: World = newWorld();
let hadLock = false;

const hud = createHUD(document.getElementById('hud')!, {
  onStart: () => freshGame(),
  onContinue: () => continueGame(),
  onCheckpoint: (id) => chooseCheckpoint(id),
  onRetry: () => retry(),
  onResume: () => resume(),
  onTitle: () => { flushSave(); world = newWorld(); refreshContinue(); hud.showScreen(world); },
});
refreshContinue();
hud.showScreen(world);

// ---- セーブ（core/save.ts）：ステージに入った・チェックポイントを通った・レベルが saveDirty を立てたときに自動で書く
/** 保存に成功した永続状態。失敗した場合は更新せず再試行する。 */
let saveKey = '';
let saveRetryAt = 0;
let checkpointOverride: string | undefined;
function checkpointId(): string { return checkpointOverride ?? activeCheckpointId(world, levelId, startAt, floor1Revisit); }
function savePlace(): string {
  return `${levelId}|${checkpointId()}`;
}
function currentSaveKey(): string {
  return `${savePlace()}|${JSON.stringify({
    inventory: world.inventory, upgrades: world.upgrades, functions: world.functions,
    unlocks: world.unlocks, loadout: world.loadout, selectedSkill: world.skills.selected,
    rested: levelId === 'floor2' && (world.level.data.floor2 as Floor2State).sleeps > 0,
  })}`;
}
function saveNow(): boolean {
  return writeSave({
    v: SAVE_VERSION, savedAt: Date.now(), level: levelId,
    startAt: (world.level.data.retryAt as string | undefined) ?? startAt,
    floor1Revisit: levelId === 'floor1' && floor1Revisit,
    checkpointId: checkpointId(),
    resume: levelId === 'camp1' || checkpointId() === 'surge:garage'
      ? { x: world.player.pos.x, y: world.player.pos.y, z: world.player.pos.z, yaw: world.player.yaw, pitch: world.player.pitch } : undefined,
    inventory: { ...world.inventory }, upgrades: { ...world.upgrades }, functions: { ...world.functions },
    unlocks: { ...world.unlocks }, loadout: { ...world.loadout, owned: [...world.loadout.owned] }, selectedSkill: world.skills.selected,
    levelMemo: levelId === 'camp1' ? getCamp1Memo()
      : levelId === 'floor1' && !floor1Revisit ? getFloor1Memo(world)
      : levelId === 'floor2' ? { rested: (world.level.data.floor2 as Floor2State).sleeps > 0 } : undefined,
  });
}
/** 毎フレーム（プレイ中）：セーブ地点が変わったか、レベルが記録を更新したらセーブ */
function autoSave(): void {
  const key = currentSaveKey();
  if ((key !== saveKey || world.level.data.saveDirty) && Date.now() >= saveRetryAt) {
    const placeChanged = key.split('|').slice(0, 2).join('|') !== saveKey.split('|').slice(0, 2).join('|');
    if (!saveNow()) {
      saveRetryAt = Date.now() + 3000;
      toast(world, 'セーブできませんでした。ブラウザの保存設定・空き容量を確認してください', 4);
      return;
    }
    saveKey = key;
    saveRetryAt = 0;
    world.level.data.saveDirty = false;
    if (placeChanged) toast(world, 'セーブしました', 1.6);
  }
}
/** タイトルへ戻る・タブを閉じる際にも変更済みの進行を確定する。 */
function flushSave(): void {
  if ((world.state === 'playing' || world.state === 'paused') && world.player.hp > 0 && !pendingFloor) {
    saveRetryAt = 0;
    autoSave();
  }
}
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
/** タイトル画面の「つづきから」ボタン */
function refreshContinue(): void {
  const s = readSave();
  hud.setContinue(s && s.level in LEVELS ? `つづきから（${describeSave(s)}）` : null);
  hud.setCheckpoints(checkpointChoices(s, readSaveHistory(), initialLevelId), s ? getSaveCheckpointId(s) : undefined);
}
/** つづきから：セーブした地点のステージを作り直し、所持品・強化・解放を戻して始める */
function continueGame(): void {
  const s = readSave();
  if (!s || !(s.level in LEVELS)) { refreshContinue(); return; }
  restoreGame(s);
}

function restoreGame(s: SaveData): void {
  floor1Revisit = !!s.floor1Revisit;
  if (s.level === 'camp1') setCamp1Memo(s.levelMemo);
  levelId = s.level as LevelId;
  startAt = s.startAt;
  renderer.toneMappingExposure = LEVELS[levelId].exposure;
  world = newWorld();
  world.inventory = { ...world.inventory, ...s.inventory };
  world.upgrades = { ...world.upgrades, ...s.upgrades };
  world.functions = { ...world.functions, ...s.functions };
  world.unlocks = { ...world.unlocks, ...s.unlocks };
  world.loadout = { ...s.loadout, owned: [...s.loadout.owned] };
  world.skills.selected = s.selectedSkill;
  syncPlayerStats(world);
  world.player.hp = world.player.maxHp;
  if (levelId === 'floor1' && !floor1Revisit) restoreFloor1Memo(world, s.levelMemo);
  if (levelId === 'floor2' && s.levelMemo && typeof s.levelMemo === 'object' && 'rested' in s.levelMemo && s.levelMemo.rested === true) {
    const state = world.level.data.floor2 as Floor2State;
    state.sleeps = 1;
    state.exitUnlocked = true;
  }
  if (s.resume && (levelId === 'camp1' || levelId === 'surge')) {
    world.player.pos.set(s.resume.x, s.resume.y, s.resume.z);
    world.player.yaw = s.resume.yaw; world.player.pitch = s.resume.pitch;
    world.player.vel.set(0, 0, 0);
  }
  if (world.loadout.current !== 'pistol') setPlayerWeapon(world, world.loadout.current);
  startGame();
}

/** 地点の過去記録があればそれを復元し、旧1枠セーブでは現在の装備を引き継ぐ。 */
function chooseCheckpoint(id: string): void {
  const latest = readSave(), history = readSaveHistory();
  if (!checkpointChoices(latest, history, initialLevelId).some(c => c.id === id && !c.disabled)) return;
  const recorded = history.find(s => getSaveCheckpointId(s) === id)
    ?? (latest && getSaveCheckpointId(latest) === id ? latest : null);
  const target = CHECKPOINT_TARGETS.find(t => t.id === id);
  if (!recorded && !target) return;
  // 選択だけで直前の未保存進行を失わない。
  flushSave();
  const base = readSave() ?? latest;
  if (recorded) restoreGame(recorded);
  else if (target) {
    const s: SaveData = base ? JSON.parse(JSON.stringify(base)) : {
      v: SAVE_VERSION, savedAt: Date.now(), level: target.level,
      inventory: { ...world.inventory }, upgrades: { ...world.upgrades }, functions: { ...world.functions },
      unlocks: { ...world.unlocks }, loadout: { ...world.loadout, owned: [...world.loadout.owned] }, selectedSkill: world.skills.selected,
    };
    const prior = base?.level === target.level ? base.levelMemo
      : [...history].filter(h => h.level === target.level).sort((a, b) => b.savedAt - a.savedAt)[0]?.levelMemo;
    s.level = target.level; s.startAt = target.startAt; s.floor1Revisit = false;
    s.resume = undefined; s.checkpointId = id;
    s.levelMemo = target.level === 'floor2' ? { rested: id === 'floor2:rested' }
      : target.level === 'camp1' ? prior ?? {
        gears: ['tunnel', 'E', 'I', 'J', 'duct', 'H'], keys: ['B', 'F'], vacuum: s.unlocks.vacuum,
        ally: 'enemy', allyHp: 0, hatchOpen: true, cLit: true, wallBroken: true,
        laserOff: true, drained: ['L1', 'L2'], boss: false,
      } : undefined;
    restoreGame(s);
    if (target.level === 'floor1') prepareFloor1Checkpoint(world, target.room, prior);
    if (target.level === 'camp1' && target.room) prepareCamp1RoomResume(world, target.room);
    if (id === 'surge:garage') { world.player.pos.set(0, 0, 8); world.player.yaw = 0; }
  }
  checkpointOverride = id;
  world.level.data.saveDirty = true;
  autoSave();
  checkpointOverride = undefined;
  input.resetAll();
}

function newWorld(): World {
  // ワールド切替では運転 HUD の表示状態も戻す（#hud.driving の残留を防ぐ）
  getDriveHud().reset();
  // 古いワールドの後始末
  if ((globalThis as any).__oldWorld) disposeWorld((globalThis as any).__oldWorld);
  const w = createWorld(input, events, window.innerWidth / window.innerHeight);
  if (startAt) w.level.data.startAt = startAt;
  LEVELS[levelId].build(w);
  if (Number.isFinite(gearsParam) && gearsParam > 0) w.inventory.gears = Math.floor(gearsParam);
  applyUnlocks(w, unlockParam);
  initPlayer(w);
  initAbsorb(w);
  initHack(w);
  initFunctions(w);
  (globalThis as any).__oldWorld = w;
  exposeDebug(w);
  return w;
}

// ---- 階の移動（エレベーター）：暗転 → 次の階を作る → 明転。プレイヤーの状態は引き継ぐ
const FADE_OUT = 0.45, FADE_IN = 0.7;
let pendingFloor = 0;
let pendingLevel: { level: LevelId; startAt?: string } | null = null;
let fadeT = 0;
let fadeIn = 0;
const fadeEl = document.createElement('div');
fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;z-index:30;pointer-events:none';
document.body.appendChild(fadeEl);

/** 次のステージ（または同じステージの別の開始地点）へ。所持品・強化などは引き継ぐ */
function changeLevel(to: LevelId, start?: string, opts: { keepHp?: boolean } = { keepHp: true }): void {
  const prev = world;
  const keep = {
    hp: prev.player.hp, energy: prev.player.energy, inventory: { ...prev.inventory }, upgrades: { ...prev.upgrades }, functions: { ...prev.functions },
    stats: { ...prev.stats },
    unlocks: { ...prev.unlocks }, loadout: { ...prev.loadout, owned: [...prev.loadout.owned] }, selectedSkill: prev.skills.selected,
  };
  levelId = to;
  startAt = start;
  renderer.toneMappingExposure = LEVELS[levelId].exposure;
  world = newWorld();
  if (opts.keepHp) Object.assign(world.player, { hp: keep.hp, energy: keep.energy });
  world.inventory = keep.inventory;
  world.upgrades = keep.upgrades;
  world.functions = keep.functions;
  Object.assign(world.stats, keep.stats);
  world.unlocks = keep.unlocks;
  world.loadout = keep.loadout;
  world.skills.selected = keep.selectedSkill;
  if (world.loadout.current !== 'pistol') setPlayerWeapon(world, world.loadout.current);
  // 部屋判定が進む前のステージ入口も履歴に残す（所持品の引き継ぎ後に保存）。
  world.level.data.saveDirty = true;
  autoSave();
}

/**
 * 死亡画面のリトライ。レベルが world.level.data.retryAt を設定していれば、そこから（所持品・強化は残す。HP・電力は満タン）。
 * なければ従来どおり最初から
 */
function retry(): void {
  const at = world.level.data.retryAt as string | undefined;
  if (at) changeLevel(levelId, at, { keepHp: false });
  else world = newWorld();
  startGame();
  // 死亡フレームで到達した地点は未保存の場合がある。生存状態へ戻したリトライ地点を確定する。
  world.level.data.saveDirty = true;
  autoSave();
}

function changeFloor(to: 1 | 2): void {
  const from = levelId === 'floor2' ? 2 : 1;
  floor1Revisit = to === 1;
  changeLevel(to === 2 ? 'floor2' : 'floor1');
  world.state = 'playing';
  input.enabled = true;
  input.locked = false;
  input.resetAll();
  events.emit('floorChange', { from, to });
  hud.showScreen(world);
}

function disposeWorld(w: World): void {
  w.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
  });
}

function startGame(): void {
  resumeAudio();
  world.state = 'playing';
  world.stats.startTime = world.time;
  input.enabled = true;
  input.requestLock();
  events.emit('gameStart', {});
  // 既存セーブは新規開始だけでは上書きしない。初回プレイは開始地点を確保する。
  saveKey = currentSaveKey();
  saveRetryAt = 0;
  world.level.data.saveDirty = false;
  if (!readSave()) { saveKey = ''; autoSave(); }
  hud.showScreen(world);
  // スパークとの会話（'comm' イベント）は後で実装。仕組みだけ HUD にある
}

function freshGame(): void {
  levelId = initialLevelId;
  startAt = urlQ.get('start') ?? undefined;
  floor1Revisit = false;
  setCamp1Memo(null);
  renderer.toneMappingExposure = LEVELS[levelId].exposure;
  world = newWorld();
  startGame();
}

function resume(): void {
  if (world.state !== 'paused') return;
  world.state = 'playing';
  input.requestLock();
  hud.showScreen(world);
}

function pause(): void {
  if (world.state !== 'playing') return;
  flushSave();
  world.state = 'paused';
  input.resetAll();
  input.exitLock();
  refreshContinue();
  hud.showScreen(world);
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) hadLock = true;
  else if (hadLock && world.state === 'playing' && !upgradeScreen.isOpen) pause();
});
renderer.domElement.addEventListener('click', () => {
  if (world.state === 'playing' && !document.pointerLockElement) input.requestLock();
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  world.camera.aspect = window.innerWidth / window.innerHeight;
  world.camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
// ?manual を付けると自動ループを止める（テストから __game.step / __game.render で駆動）
const manual = new URLSearchParams(location.search).has('manual');
function frame(): void {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  step(dt);
  drawScene();
  if (!manual) requestAnimationFrame(frame);
}

/** 強化画面が開いている間は、本編のシーンの代わりに画面の3Dモデルを描く */
function drawScene(): void {
  if (upgradeScreen.isOpen) upgradeScreen.render(renderer);
  else renderer.render(world.scene, world.camera);
}

/** 1ステップ進める（テストからも呼べる） */
function step(dt: number): void {
  input.pollGamepad(dt);
  world.time += dt;
  if (world.state === 'playing') {
    if (input.pressed('KeyP')) { pause(); input.endFrame(); return; }
    updatePlayer(world, dt);
    updateFunctions(world, dt);
    updateGun(world, dt);
    updateAbsorb(world, dt);
    updateHack(world, dt);
    updateGrapple(world, dt);
    updateEnemies(world, dt);
    updateSkills(world, dt); // 敵の更新の後（バキュームで吸われている敵の見た目を上書きする）
    updateWeaponSwitch(world);
    updateProjectiles(world, dt);
    updatePickups(world, dt);
    LEVELS[levelId].tick(world, dt);
    for (const t of world.toasts) t.timer -= dt;
    world.toasts = world.toasts.filter((t) => t.timer > 0);
    if (!pendingFloor && world.player.hp > 0) autoSave();

    // エレベーターに乗った：暗転してから次の階へ
    const nf = world.level.data.nextFloor;
    if (!pendingFloor && (nf === 1 || nf === 2)) { pendingFloor = nf; fadeT = 0; input.locked = true; }
    // 別のステージへ（例：2階の西の出口 → { level: 'surge' }）
    const nl = world.level.data.nextLevel as { level: LevelId; startAt?: string } | undefined;
    if (!pendingFloor && nl && LEVELS[nl.level]) { pendingFloor = -1; pendingLevel = nl; fadeT = 0; input.locked = true; }
    if (pendingFloor) {
      fadeT += dt;
      fadeEl.style.opacity = String(Math.min(1, fadeT / FADE_OUT));
      if (fadeT >= FADE_OUT) {
        const to = pendingFloor;
        pendingFloor = 0;
        if (to === -1 && pendingLevel) {
          const nl = pendingLevel;
          pendingLevel = null;
          changeLevel(nl.level, nl.startAt);
          world.state = 'playing';
          input.enabled = true;
          input.locked = false;
          input.resetAll();
          hud.showScreen(world);
        } else changeFloor(to as 1 | 2);
        fadeIn = FADE_IN;
        fadeEl.style.opacity = '1';
      }
    } else if (fadeIn > 0) {
      fadeIn = Math.max(0, fadeIn - dt);
      fadeEl.style.opacity = String(fadeIn / FADE_IN);
    }

    if (world.player.hp <= 0) {
      world.state = 'gameover';
      world.stats.endTime = world.time;
      input.exitLock();
      events.emit('gameOver', {});
      hud.showScreen(world);
    } else if (world.level.bossDefeated && levelId !== 'floor1') {
      world.state = 'clear';
      world.stats.endTime = world.time;
      input.exitLock();
      events.emit('gameClear', {});
      hud.showScreen(world);
    }
  } else if (world.state === 'paused') {
    if (!hud.checkpointOpen && input.pressed('KeyP')) resume();
  } else if (world.state === 'title') {
    // タイトル背景：カメラをゆっくり回す
    updatePlayer(world, 0);
    if (!hud.checkpointOpen && (input.pressed('PadA') || input.pressed('KeyP'))) {
      if (readSave()) continueGame(); else startGame();
    }
  } else if (world.state === 'gameover' || world.state === 'clear') {
    // リトライ（設定されていればリトライ地点から。例：サージの道は車に乗ったところ）
    if (input.pressed('PadA')) retry();
  }
  updateEffects(world, dt);
  hud.update(world, dt);
  upgradeScreen.update(world, dt);
  updateAudio(world, dt);
  input.endFrame();
}

function exposeDebug(w: World): void {
  (window as any).__game = {
    world: w,
    input,
    events,
    start: () => startGame(),
    step: (dt = 1 / 60, n = 1) => { for (let i = 0; i < n; i++) step(dt); },
    camera: CAMERA,
    character: CHARACTER, // 見た目調整のデバッグ用（実行時に数値を触れる）
    setWeapon: (id: string) => setPlayerWeapon(world, id),
    /** 解放（例：__game.unlock('vacuum') / __game.unlock('all')）。武器 id なら所持に加える */
    unlock: (...ids: string[]) => applyUnlocks(world, ids),
    render: () => drawScene(),
    /** 強化画面を開く（確認用。ベッドを使わずに開ける。閉じても起き上がりの処理は無い） */
    openUpgrade: () => upgradeScreen.open(world),
    upgradeScreen,
    get current() { return world; },
    THREE,
  };
}

requestAnimationFrame(frame);
