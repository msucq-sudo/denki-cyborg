// ジャンパー：大きな頭の二足歩行。ジャンプ移動・着地で突き・核が開いた時だけ効く（T3-D で実装）
import { Builder, COLORS, sphereGeo } from '../models';
import type { KindModule } from './kind';

export const jumper: KindModule = {
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
