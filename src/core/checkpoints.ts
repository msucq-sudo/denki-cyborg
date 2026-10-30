import type { World } from './types';
import { describeSave, getSaveCheckpointId, type SaveData } from './save';
import { generateCamp1 } from '../level/camp1/plan';
import { generateFloor1 } from '../level/floor1/plan';
import { getFloor1Memo, restoreFloor1Memo } from '../level/floor1';

export interface CheckpointChoice {
  id: string;
  label: string;
  detail: string;
  disabled: boolean;
}
export interface CheckpointTarget {
  id: string;
  level: string;
  startAt?: string;
  room?: string;
  label: string;
}
const camp = generateCamp1();
const floor = generateFloor1();
export const CHECKPOINT_TARGETS: CheckpointTarget[] = [
  { id: 'floor1:start', level: 'floor1', label: '研究所1階・入口' },
  ...floor.rooms.map(r => ({ id: `floor1:room.${r.id}`, level: 'floor1', room: r.id, label: `研究所1階・${r.name === 'エレベーター' ? 'エレベーター前' : r.name}` })),
  { id: 'floor2:start', level: 'floor2', label: '研究所2階・アップグレード前' },
  { id: 'floor2:rested', level: 'floor2', label: '研究所2階・アップグレード後' },
  { id: 'surge:stairs', level: 'surge', startAt: 'stairs', label: 'ガレージへの階段' },
  { id: 'surge:garage', level: 'surge', startAt: 'stairs', label: 'ガレージ・車に乗る前' },
  { id: 'surge:drive', level: 'surge', startAt: 'drive', label: '車の運転開始' },
  { id: 'camp1:entrance', level: 'camp1', startAt: 'entrance', label: '収容所1階・入口' },
  ...camp.rooms.map(r => ({ id: `camp1:room.${r.id}`, level: 'camp1', startAt: 'entrance', room: r.id, label: `収容所1階・${r.name}` })),
  { id: 'camp1:room.tunnel', level: 'camp1', startAt: 'entrance', room: 'tunnel', label: '収容所1階・地下通路' },
  { id: 'camp1:room.duct', level: 'camp1', startAt: 'entrance', room: 'duct', label: '収容所1階・隠しダクト' },
  { id: 'camp1:boss', level: 'camp1', startAt: 'boss', label: '収容所1階・中ボス戦の前' },
  { id: 'camp2:start', level: 'camp2', label: '収容所2階・前室' },
  { id: 'camp2:boss', level: 'camp2', startAt: 'boss', label: '収容所2階・ボス戦の前' },
  { id: 'camp2:freed', level: 'camp2', startAt: 'freed', label: '収容所2階・住民解放後' },
];
const ORDER: Record<string, number> = { dungeon: 0, floor1: 1, floor2: 2, surge: 3, camp1: 4, camp2: 5 };

export function checkpointChoices(latest: SaveData | null, history: SaveData[], initialLevel = 'floor1'): CheckpointChoice[] {
  const saves = latest ? [...history, latest] : history;
  const reached = saves.length ? Math.max(...saves.map(s => ORDER[s.level] ?? 0)) : ORDER[initialLevel] ?? 0;
  const choices = CHECKPOINT_TARGETS.map(t => {
    const recorded = history.find(s => getSaveCheckpointId(s) === t.id)
      ?? (latest && getSaveCheckpointId(latest) === t.id ? latest : null);
    const disabled = (ORDER[t.level] ?? 0) > reached || (t.id === 'camp2:freed' && !recorded);
    return { id: t.id, label: t.label, disabled,
      detail: disabled ? 'まだ到達していないステージです'
        : recorded ? '初回到達時の記録あり：その時の所持品・強化・進行から再開します'
        : '過去の記録なし：現在の所持品・強化を引き継いで戻ります' };
  });
  // 未知の旧記録もメニューから落とさない。
  for (const saved of history) {
    const id = getSaveCheckpointId(saved);
    if (!choices.some(c => c.id === id)) choices.push({ id, label: describeSave(saved), detail: '保存した地点の記録から再開します', disabled: false });
  }
  return choices;
}

/** 最初に入った各部屋と主要地点を別枠に記録する。 */
export function activeCheckpointId(w: World, level: string, startAt?: string, revisit = false): string {
  if (level === 'floor1' && revisit) return 'floor1:revisit';
  if (level === 'floor2') return (w.level.data.floor2 as { sleeps: number }).sleeps > 0 ? 'floor2:rested' : 'floor2:start';
  if (level === 'surge') {
    if (w.level.data.retryAt === 'drive' || startAt === 'drive') return 'surge:drive';
    if (w.player.pos.y < 1.5 && w.player.pos.z < 14 && w.player.pos.z > -10) return 'surge:garage';
    return 'surge:stairs';
  }
  if (level === 'camp1') {
    if (w.player.pos.y < -2) return 'camp1:room.tunnel';
    const d = camp.duct, p = w.player.pos;
    if (p.y > d.y0 - 0.5 && p.x > d.x0 && p.x < d.x1 && p.z > d.z0 && p.z < d.z1) return 'camp1:room.duct';
  }
  if (level === 'camp1' || level === 'floor1') {
    const plan = level === 'camp1' ? camp : floor;
    const room = plan.rooms[w.level.currentRoom];
    if (level === 'camp1' && room?.id === 'D' && w.level.data.retryAt === 'boss') return 'camp1:boss';
    if (room) return `${level}:room.${room.id}`;
  }
  return `${level}:${(w.level.data.retryAt as string | undefined) ?? startAt ?? (level === 'camp1' ? 'entrance' : 'start')}`;
}

/** 旧セーブから別の階へ戻る場合の安全な練習位置。取得済みか不明な歯車は再配置しない。 */
export function prepareFloor1Checkpoint(w: World, room?: string, priorMemo?: unknown): void {
  const points: Record<string, [number, number, number]> = {
    hall: [0, 0, -50], start: [floor.start.x, 0, floor.start.z], L1: [-42, 0, -62],
    L2: [-42, 0, -45], L3: [-42, 0, -28], vestW: [-27, 0, -45], side: [-27, 0, -27],
    RU: [54, 0, -56], RL: [54, 0, -29], dead: [75, 0, -2], alcove: [0, 0, -68],
  };
  const memo = getFloor1Memo(w) as {
    player: { x: number; y: number; z: number; yaw: number; pitch: number }; gears: number[];
    gates: Record<string, boolean>; gateWants: Record<string, boolean>; fights: Record<string, string>;
    powered: boolean; powerVia: string; powerT: number; cleared: boolean; passedExit: boolean;
  };
  const previous = priorMemo && typeof priorMemo === 'object' ? priorMemo as { gears?: unknown; fights?: unknown } : null;
  memo.gears = Array.isArray(previous?.gears) && previous.gears.every(i => Number.isInteger(i) && i >= 0 && i < floor.gears.length)
    ? [...previous.gears] : floor.gears.map((_, i) => i);
  if (previous?.fights && typeof previous.fights === 'object') {
    for (const id of Object.keys(memo.fights)) {
      if ((previous.fights as Record<string, unknown>)[id] === 'done') memo.fights[id] = 'done';
    }
  }
  // 任意の部屋から戻っても入口ゲート等で行き止まりにならないよう通路を開ける。
  for (const key of Object.keys(memo.gates)) memo.gates[key] = memo.gateWants[key] = true;
  memo.powered = true; memo.powerVia = 'shot'; memo.powerT = 100; memo.cleared = false; memo.passedExit = false;
  if (room && room in memo.fights) memo.fights[room] = 'idle';
  const [x, y, z] = points[room ?? 'start'] ?? points.start;
  memo.player = { x, y, z, yaw: room === 'start' ? floor.start.yaw : 0, pitch: 0 };
  restoreFloor1Memo(w, memo);
  w.level.data.nextFloor = 0;
}
