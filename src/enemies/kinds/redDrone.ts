// 赤ドローン：ドローンの赤い版。ハッキングで味方になる（T3-C で実装）
import { Builder, COLORS, sphereGeo } from '../models';
import type { KindModule } from './kind';

export const redDrone: KindModule = {
  knockback: 0.5,
  flying: true,
  hackable: true,
  build() {
    const b = new Builder();
    b.mesh(sphereGeo(0.5), b.body(COLORS.white, 0.5, true));
    b.weak(0, 0.3, -0.4, 0.2);
    return b.done();
  },
  update() {},
  animate() {},
};
