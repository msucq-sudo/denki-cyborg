// リーチ（吸収マン）：小型。吸収アームでプレイヤーの電力を吸い、つながれると逃げる（T3-B で実装）
import { Builder, COLORS, sphereGeo } from '../models';
import { moveGround } from '../common';
import type { KindModule } from './kind';

export const leech: KindModule = {
  knockback: 0.5,
  flying: true,
  build() {
    const b = new Builder();
    b.mesh(sphereGeo(0.5), b.body(COLORS.white, 0.5, true));
    b.weak(0, 0.3, -0.4, 0.2);
    return b.done();
  },
  update(c) { void c; },
  animate() {},
};
