/**
 * キーボード/マウス/ゲームパッド入力。キーは KeyboardEvent.code（'KeyW', 'Space', 'ShiftLeft', 'Digit1' など）。
 * マウスボタン: 0=左, 2=右。
 * pressed/released は「このフレームで押された/離された」。endFrame() でリセット。
 */
/** 右スティック全倒し時の視点移動量（マウスのピクセル換算/秒） */
const PAD_LOOK_PX_PER_SEC = 1300;

export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  private mouseDown = new Set<number>();
  private mousePressedSet = new Set<number>();
  private mouseReleasedSet = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  pointerLocked = false;
  /** false の間は入力を無視（タイトル画面など） */
  enabled = true;
  /** true の間はゲームの操作（移動・視点・射撃…）を無効にする。演出中のロック用。rawPressed だけは通る */
  locked = false;
  /**
   * true の間（ハッキング中）、パッドの十字キーと ABXY をゲーム操作（ジャンプ・逆流・インタラクト・機能）に割り当てない。
   * 生の仮想キー（PadUp/PadDown/PadLeft/PadRight/PadA/PadB/PadX/PadY）だけが届く。
   */
  padCapture = false;
  /** 最後に触った入力機器（ハッキングの表示切り替え用） */
  lastDevice: 'kbm' | 'pad' = 'kbm';

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.lastDevice = 'kbm';
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    });
    target.addEventListener('mousedown', (e) => {
      this.lastDevice = 'kbm';
      if (!this.mouseDown.has(e.button)) this.mousePressedSet.add(e.button);
      this.mouseDown.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
      this.mouseReleasedSet.add(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked && !this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.resetAll());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.target;
    });
  }

  /** パッドが押している仮想キー/ボタン（キーボード入力と混ざらないよう別管理） */
  private padKeys = new Set<string>();
  private padMouse = new Set<number>();

  /**
   * ゲームパッド（Xbox 配置）をキーボード/マウス入力に変換する。毎フレーム1回呼ぶ。
   * 左スティック=WASD、右スティック=視点、RT=射撃、LT=照準、LB=吸収(E)、A=ジャンプ/飛行、RB=回避(C)、Lスティック押込=ダッシュ(Shift)、
   * X=逆流(F)、B=インタラクト(PadB。ベッドなど)、Y=飛行(3)、十字キー左/上=スカウター/オートエイム(1/2)、Start=ポーズ(P)、A=決定(PadA)
   */
  pollGamepad(dt: number): void {
    const pad = navigator.getGamepads?.().find((g) => g && g.connected && g.mapping === 'standard');
    const keys = new Set<string>();
    const mouse = new Set<number>();
    if (pad) {
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = (i: number) => pad.axes[i] ?? 0;
      const T = 0.4;
      if (ax(1) < -T) keys.add('KeyW');
      if (ax(1) > T) keys.add('KeyS');
      if (ax(0) < -T) keys.add('KeyA');
      if (ax(0) > T) keys.add('KeyD');
      // 十字キーと ABXY は常に生の仮想キーも出す（ハッキングのコード入力用）。padCapture 中はゲーム操作に割り当てない
      const RAW: [number, string][] = [[12, 'PadUp'], [13, 'PadDown'], [14, 'PadLeft'], [15, 'PadRight'], [0, 'PadA'], [1, 'PadB'], [2, 'PadX'], [3, 'PadY']];
      for (const [i, k] of RAW) if (b(i)) keys.add(k);
      const cap = this.padCapture;
      if (b(0) && !cap) keys.add('Space');
      // B(1)=インタラクト専用（PadB。2階のベッドなど）。回避は RB(5) だけ
      if (b(5)) keys.add('KeyC');
      if (b(2) && !cap) keys.add('KeyF');
      // Y(3)=インタラクト（R：スイッチなど）。ジェットパックは A 長押し
      if (b(3) && !cap) keys.add('KeyR');
      if (b(4)) keys.add('KeyE');
      if (b(14) && !cap) keys.add('Digit1');
      if (b(12) && !cap) keys.add('Digit2');
      if (b(9)) keys.add('KeyP');
      if (b(10)) keys.add('ShiftLeft');
      if (b(7) || (pad.buttons[7]?.value ?? 0) > 0.3) mouse.add(0);
      if (b(6) || (pad.buttons[6]?.value ?? 0) > 0.3) mouse.add(2);
      // 右スティック→視点（デッドゾーン後に2乗カーブ）
      const look = (v: number) => {
        const m = Math.abs(v);
        if (m < 0.15) return 0;
        const n = (m - 0.15) / 0.85;
        return Math.sign(v) * n * n;
      };
      if (keys.size > 0 || mouse.size > 0 || Math.abs(ax(2)) > 0.3 || Math.abs(ax(3)) > 0.3) this.lastDevice = 'pad';
      if (!this.locked) {
        this.mouseDX += look(ax(2)) * PAD_LOOK_PX_PER_SEC * dt;
        this.mouseDY += look(ax(3)) * PAD_LOOK_PX_PER_SEC * dt;
      }
    }
    for (const k of this.padKeys) if (!keys.has(k)) this.simulateKey(k, false);
    for (const k of keys) if (!this.padKeys.has(k)) this.simulateKey(k, true);
    for (const m of this.padMouse) if (!mouse.has(m)) this.simulateMouse(m, false);
    for (const m of mouse) if (!this.padMouse.has(m)) this.simulateMouse(m, true);
    this.padKeys = keys;
    this.padMouse = mouse;
  }

  requestLock(): void {
    try {
      const r = (this.target as any).requestPointerLock?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* ignore */ }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean { return this.enabled && !this.locked && this.down.has(code); }
  pressed(code: string): boolean { return this.enabled && !this.locked && this.pressedSet.has(code); }
  released(code: string): boolean { return this.enabled && !this.locked && this.releasedSet.has(code); }
  mouse(button: number): boolean { return this.enabled && !this.locked && this.mouseDown.has(button); }
  mousePressed(button: number): boolean { return this.enabled && !this.locked && this.mousePressedSet.has(button); }
  mouseReleased(button: number): boolean { return this.enabled && !this.locked && this.mouseReleasedSet.has(button); }
  /** ロック中でも読める「押した瞬間」（演出中の起き上がりなど） */
  rawPressed(code: string): boolean { return this.enabled && this.pressedSet.has(code); }
  /** ロック中でも読める「押している間」（運転中の左右など） */
  rawDown(code: string): boolean { return this.enabled && this.down.has(code); }

  /** テスト/デバッグ用：入力を外部から注入 */
  simulateKey(code: string, isDown: boolean): void {
    if (isDown) { if (!this.down.has(code)) this.pressedSet.add(code); this.down.add(code); }
    else { this.down.delete(code); this.releasedSet.add(code); }
  }
  simulateMouse(button: number, isDown: boolean): void {
    if (isDown) { if (!this.mouseDown.has(button)) this.mousePressedSet.add(button); this.mouseDown.add(button); }
    else { this.mouseDown.delete(button); this.mouseReleasedSet.add(button); }
  }
  simulateLook(dx: number, dy: number): void { this.mouseDX += dx; this.mouseDY += dy; }

  resetAll(): void {
    this.down.clear(); this.mouseDown.clear();
  }

  endFrame(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.mousePressedSet.clear();
    this.mouseReleasedSet.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
