// スキルの選択と発動。
// パッド：十字キー下を押している間（input.skillMenuHeld）、右スティックの向きでリングの枠を選ぶ → 離しても選択は残る → Y（仮想キー 'Skill'）で発動。
// キーボード：Y で選択中のスキルを発動（仮の割り当て）。
// 今のスキルはバキュームだけ。リングは4枠（上・右・下・左）で、空き枠は今後のスキル用。
import type { SkillId, World } from '../core/types';
import { VACUUM } from '../config/balance';
import { canUseVacuum, startVacuum, updateVacuum } from './vacuum';

export interface SkillDef {
  id: SkillId;
  name: string;
  /** 再使用までの時間（秒） */
  cooldown: number;
  unlocked(world: World): boolean;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  vacuum: { id: 'vacuum', name: 'バキューム', cooldown: VACUUM.cooldown, unlocked: (w) => w.unlocks.vacuum },
};

/** リングの枠（上から時計回り：上・右・下・左）。null は空き枠 */
export const SKILL_SLOTS: (SkillId | null)[] = ['vacuum', null, null, null];

/** スティックをこれ以上倒したら向きを読む */
export const SKILL_STICK_DEADZONE = 0.5;

/** キーボードの発動キー（仮。ハッキングの出題キー Q T G Z X V B 4 とゲームの操作キーを避けた） */
export const SKILL_KEY = 'KeyY';

/**
 * スティックの向き → 枠の番号（上=0 から時計回り）。倒し方が足りなければ null。
 * y はゲームパッドの軸と同じく下が +
 */
export function pickSkillSlot(x: number, y: number, count = SKILL_SLOTS.length, deadzone = SKILL_STICK_DEADZONE): number | null {
  if (Math.hypot(x, y) < deadzone || count <= 0) return null;
  // 上=0、右=90°…（時計回りの角度）
  const ang = Math.atan2(x, -y);
  const step = (Math.PI * 2) / count;
  const i = Math.round(ang / step);
  return ((i % count) + count) % count;
}

export function isSkillUnlocked(world: World, id: SkillId): boolean {
  return SKILLS[id].unlocked(world);
}

/** 選択中のスキルを発動する。使えなければ 'skillDenied' を出して false */
export function useSkill(world: World, id: SkillId = world.skills.selected): boolean {
  const sk = world.skills;
  if (!isSkillUnlocked(world, id)) { world.events.emit('skillDenied', { id, reason: 'locked' }); return false; }
  if (sk.cooldown[id] > 0) { world.events.emit('skillDenied', { id, reason: 'cooldown' }); return false; }
  if (id === 'vacuum') {
    const why = canUseVacuum(world);
    if (why) { world.events.emit('skillDenied', { id, reason: why }); return false; }
    startVacuum(world);
    sk.cooldown[id] = SKILLS[id].cooldown;
    return true;
  }
  return false;
}

/** 毎フレーム（敵の更新の後に呼ぶ。バキュームの敵側の見た目を上書きするため） */
export function updateSkills(world: World, dt: number): void {
  const sk = world.skills;
  const inp = world.input;
  for (const id of Object.keys(sk.cooldown) as SkillId[]) sk.cooldown[id] = Math.max(0, sk.cooldown[id] - dt);

  // ---- 選択（十字キー下を押している間） ----
  if (inp.skillMenuHeld && !world.hack.active) {
    const slot = pickSkillSlot(inp.skillStickX ?? 0, inp.skillStickY ?? 0);
    sk.hover = slot;
    const id = slot === null ? null : SKILL_SLOTS[slot];
    // 未入手のスキル・空き枠は選べない（指すだけ。ロック表示）
    if (id && isSkillUnlocked(world, id) && id !== sk.selected) {
      sk.selected = id;
      world.events.emit('skillSelect', { id });
    }
  } else {
    sk.hover = null;
  }

  // ---- 発動 ----
  const busy = world.hack.active || !!world.player.hacking;
  if (!busy && (inp.pressed('Skill') || inp.pressed(SKILL_KEY))) useSkill(world);

  updateVacuum(world, dt);
}
