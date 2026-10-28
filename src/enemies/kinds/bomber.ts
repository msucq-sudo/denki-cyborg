// ボンバー：電気の球を投げる小型（T3-F で実装）
import { Builder, COLORS, sphereGeo } from '../models';
import type { KindModule } from './kind';

export const bomber: KindModule = {
  knockback: 0.5,
  build() {
    const b = new Builder();
    b.mesh(sphereGeo(0.5), b.body(COLORS.white, 0.5, true));
    b.weak(0, 0.3, -0.4, 0.2);
    return b.done();
  },
  update() {},
  animate() {},
};
