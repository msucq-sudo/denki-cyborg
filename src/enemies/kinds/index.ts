import type { EnemyKind } from '../../config/balance';
import { registerKindBuilders } from '../models';
import type { KindModule } from './kind';
import { walker } from './walker';
import { heavyWalker } from './heavyWalker';
import { missileBot } from './missileBot';

/** kinds/ に置いた敵の一覧。ここに足せば spawnEnemy・buildModel・敵図鑑で使える */
export const KIND_MODULES: Partial<Record<EnemyKind, KindModule>> = {
  walker,
  heavyWalker,
  missile: missileBot,
};

registerKindBuilders(Object.fromEntries(Object.entries(KIND_MODULES).map(([k, m]) => [k, () => m!.build()])));
