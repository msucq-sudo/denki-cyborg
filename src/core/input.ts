/**
 * キーボード/マウス入力。キーは KeyboardEvent.code（'KeyW', 'Space', 'ShiftLeft', 'Digit1' など）。
 * マウスボタン: 0=左, 2=右。
 * pressed/released は「このフレームで押された/離された」。endFrame() でリセット。
 */
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

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.mouseDown.has(e.button)) this.mousePressedSet.add(e.button);
      this.mouseDown.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
      this.mouseReleasedSet.add(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
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

  requestLock(): void {
    try {
      const r = (this.target as any).requestPointerLock?.();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* ignore */ }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean { return this.enabled && this.down.has(code); }
  pressed(code: string): boolean { return this.enabled && this.pressedSet.has(code); }
  released(code: string): boolean { return this.enabled && this.releasedSet.has(code); }
  mouse(button: number): boolean { return this.enabled && this.mouseDown.has(button); }
  mousePressed(button: number): boolean { return this.enabled && this.mousePressedSet.has(button); }
  mouseReleased(button: number): boolean { return this.enabled && this.mouseReleasedSet.has(button); }

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
