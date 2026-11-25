import { Application, BitmapText, Container, Graphics, Sprite, Text, type Texture, type Ticker } from "pixi.js";
import { floorMultiplier, msToReach, multiplierAt } from "../../../shared/crash-math.ts";
import type { RoundPhase } from "../../../shared/protocol.ts";
import type { GameState } from "../game/state.ts";
import { makePlanetTexture, PLANET_REFERENCE_HEIGHT, PLANET_TEXTURE_SCALE, PLANETS } from "./space.ts";

const COLORS = {
  grid: 0xc4b5fd, // lilás bem transparente sobre o espaço
  label: 0x9d97c7,
  curve: 0x4ade80,
  crash: 0xf87171,
  text: 0xf0fdf4,
  smoke: 0xe9d5ff,
  star: [0xffffff, 0xe0e7ff, 0xfef3c7, 0xf5d0fe],
  fire: [0xfde047, 0xf97316, 0xef4444, 0xffffff],
};
// top maior: as "pílulas" do histórico (HTML) ficam por cima do canvas nessa faixa
const PAD = { left: 48, right: 28, top: 58, bottom: 34 };
const STAR_COUNT = 110;
const MAX_PARTICLES = 300;
const CURVE_SAMPLES = 64;
/** Abra a página com ?debug para ver FPS e contadores (útil para testar no celular). */
const DEBUG = new URLSearchParams(location.search).has("debug");
/** Quantos frames recentes entram nas estatísticas de performance (~2s a 60fps). */
const PERF_SAMPLES = 120;

/** Percentil p (0..1) de uma lista de números. p95 = "95% dos frames foram melhores que isso". */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** Métricas que o modo ?debug publica (e que dá para ler no console: window.__crashPerf). */
export interface PerfStats {
  fps: number;
  frameMsAvg: number;
  frameMsP95: number;
  frameMsMax: number;
  updateMsAvg: number;
  updateMsP95: number;
  particles: number;
  pooled: number;
}

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  startAlpha: number;
}

/**
 * Objeto do fundo (estrela ou planeta): flutua devagar e acelera quando o foguete voa.
 * depth 0..1 = profundidade. Mais perto = passa mais rápido (parallax).
 */
interface SpaceObject {
  sprite: Sprite;
  depth: number;
  /** Planetas: raio como fração da altura da tela (para escalar no resize). Estrelas: 0. */
  radius: number;
  spin: number;
  /** Estrelas piscam: brilho base, velocidade e fase da oscilação. */
  baseAlpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** "Passo bonito" para a grade: 0.1, 0.2, 0.5, 1, 2, 5, 10... */
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Suavização exponencial independente de FPS: quanto `current` anda em direção
 * a `target` num frame de `dtMs`. Com `x += (alvo - x) * 0.1` puro, a animação
 * seria 2x mais rápida numa tela de 120Hz do que numa de 60Hz.
 */
function ease(current: number, target: number, dtMs: number, smoothingMs: number): number {
  return current + (target - current) * (1 - Math.exp(-dtMs / smoothingMs));
}

/**
 * A cena do jogo em PixiJS. Não sabe nada de React nem de rede:
 * a cada frame ela LÊ o estado atual (getState) e desenha.
 *
 * React  -> atualiza o estado quando chegam mensagens (~10x/s)
 * PixiJS -> desenha a 60fps (ou 120fps), interpolando entre as mensagens
 */
export class CrashScene {
  private readonly app = new Application();
  private readonly getState: () => GameState;
  private destroyed = false;
  private ready = false;
  private resizeObserver: ResizeObserver | null = null;

  // Camadas (a ordem de addChild = ordem de desenho, de trás para frente)
  private readonly world = new Container(); // tudo que treme na explosão
  private readonly backdrop = new Container(); // estrelas + planetas do fundo
  private readonly stars: SpaceObject[] = [];
  private readonly planets: SpaceObject[] = [];
  private readonly planetTextures: Texture[] = [];
  private readonly grid = new Graphics();
  private readonly labels: Text[] = [];
  private readonly timeLabels: Text[] = [];
  private readonly area = new Graphics();
  private readonly line = new Graphics();
  private readonly particleLayer = new Container();
  private readonly rocket = new Container();
  private readonly flame = new Graphics();
  private readonly hud = new Container();
  private readonly caption = new Text({
    text: "",
    style: { fontFamily: "system-ui, sans-serif", fontSize: 20, fontWeight: "700", fill: COLORS.text, letterSpacing: 2 },
  });
  private readonly progressBar = new Graphics();
  private multiplierText!: BitmapText;
  private debugText: Text | null = null;

  // Partículas com "object pool": reaproveitamos sprites em vez de criar/destruir
  // centenas por segundo (isso geraria lixo para o garbage collector e engasgos).
  private particleTexture!: Texture;
  private readonly particles: Particle[] = [];
  private readonly pool: Sprite[] = [];

  // Estado puramente VISUAL (o estado do jogo mora no GameState)
  private lastPhase: RoundPhase | null = null;
  private lastRoundId = -1;
  private displaySince = 0;
  private displayMult = 1;
  private crashElapsed = 0;
  private viewMaxT = 8_000;
  private viewMaxM = 2;
  private shake = 0;
  private trailTimer = 0;
  private debugTimer = 0;
  private readonly frameSamples: number[] = []; // intervalo entre frames (ms)
  private readonly updateSamples: number[] = []; // quanto o NOSSO update() levou (ms)

  constructor(getState: () => GameState) {
    this.getState = getState;
  }

  /**
   * O init do Pixi v8 é ASSÍNCRONO. Se o React desmontar o componente antes de ele
   * terminar (o StrictMode faz exatamente isso em dev), destruímos logo em seguida.
   */
  async mount(host: HTMLElement): Promise<void> {
    await this.app.init({
      backgroundAlpha: 0, // transparente: o fundo do card (CSS) aparece por trás
      antialias: true,
      resizeTo: host,
      // Telas retina têm devicePixelRatio 3. Renderizar em 3x custa 9x os pixels
      // de 1x; limitamos a 2x: diferença quase invisível, bem mais leve no celular.
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
    });
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    this.ready = true;
    this.app.canvas.style.display = "block";
    host.appendChild(this.app.canvas);

    // O resizeTo do Pixi só escuta o resize da JANELA. O ResizeObserver pega
    // também mudanças só do elemento (ex.: girar o celular, layout mudar).
    this.resizeObserver = new ResizeObserver(() => this.app.resize());
    this.resizeObserver.observe(host);

    this.build();
    this.app.ticker.add(this.update);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    if (!this.ready) return;
    this.ready = false;
    for (const sprite of this.pool) sprite.destroy();
    this.particleTexture.destroy(true);
    for (const texture of this.planetTextures) texture.destroy(true);
    this.app.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- montagem

  private build(): void {
    // Uma textura de círculo gerada UMA vez e compartilhada por todas as partículas:
    // sprites com a mesma textura são desenhados juntos numa só chamada à GPU (batching).
    this.particleTexture = this.app.renderer.generateTexture(new Graphics().circle(0, 0, 8).fill(0xffffff));

    for (let i = 0; i < 8; i++) {
      const label = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fill: COLORS.label } });
      label.anchor.set(1, 0.5);
      this.labels.push(label);
      const timeLabel = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fill: COLORS.label } });
      timeLabel.anchor.set(0.5, 0);
      this.timeLabels.push(timeLabel);
    }

    this.buildSpace();
    this.buildRocket();

    // BitmapText: as letras viram uma textura pronta. Trocar o texto todo frame é
    // barato. Um Text normal re-renderiza a fonte inteira a cada mudança.
    this.multiplierText = new BitmapText({
      text: "1.00x",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 96, fontWeight: "800", fill: 0xffffff },
    });
    this.multiplierText.anchor.set(0.5);
    this.caption.anchor.set(0.5);

    this.hud.addChild(this.caption, this.multiplierText, this.progressBar);
    this.world.addChild(this.backdrop, this.grid, ...this.labels, ...this.timeLabels, this.area, this.line, this.particleLayer, this.rocket);
    this.app.stage.addChild(this.world, this.hud);

    if (DEBUG) {
      this.debugText = new Text({ text: "", style: { fontFamily: "monospace", fontSize: 11, fill: 0x4ade80 } });
      this.debugText.anchor.set(1, 0);
      this.app.stage.addChild(this.debugText);
    }
  }

  /**
   * O espaço: estrelas (reaproveitando a textura de círculo das partículas, então
   * entram no mesmo batch da GPU) e planetas com textura gerada em space.ts.
   */
  private buildSpace(): void {
    const { width, height } = this.app.screen;

    for (let i = 0; i < STAR_COUNT; i++) {
      const sprite = new Sprite(this.particleTexture);
      sprite.anchor.set(0.5);
      const depth = 0.05 + Math.random() * 0.45; // estrelas estão "longe": parallax lento
      sprite.scale.set(0.04 + depth * 0.32); // raio de ~0.3px a ~1.6px
      sprite.tint = COLORS.star[i % COLORS.star.length]!;
      sprite.position.set(Math.random() * width, Math.random() * height);
      this.backdrop.addChild(sprite);
      this.stars.push({
        sprite,
        depth,
        radius: 0,
        spin: 0,
        baseAlpha: 0.35 + Math.random() * 0.6,
        twinkleSpeed: 0.8 + Math.random() * 2.5,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }

    PLANETS.forEach((spec, i) => {
      const texture = makePlanetTexture(spec, i + 7);
      this.planetTextures.push(texture);
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.position.set(spec.x * width, spec.y * height);
      // Um pouco apagados: são cenário, não podem competir com a curva e o número.
      sprite.alpha = 0.55 + spec.depth * 0.3;
      this.backdrop.addChild(sprite);
      this.planets.push({
        sprite,
        depth: spec.depth,
        radius: spec.radius,
        spin: (Math.random() - 0.5) * 0.04, // giro bem lento
        baseAlpha: 1,
        twinkleSpeed: 0,
        twinklePhase: 0,
      });
    });
  }

  /**
   * Parallax: tudo "passa" para a esquerda/baixo, como se a câmera subisse com o
   * foguete. Mais perto (depth alto) = mais rápido. Em voo, acelera com o multiplicador.
   */
  private updateSpace(dt: number, phase: RoundPhase, mult: number, now: number): void {
    const { width, height } = this.app.screen;
    const seconds = dt / 1000;
    const speed = phase === "running" ? 60 + Math.min(260, (mult - 1) * 80) : 10;
    // Planetas escalam com a ALTURA da tela (textura gerada em PLANET_REFERENCE_HEIGHT, 2x pixels)
    const planetScale = height / PLANET_REFERENCE_HEIGHT / PLANET_TEXTURE_SCALE;

    const move = (obj: SpaceObject, margin: number) => {
      const s = obj.sprite;
      s.x -= speed * obj.depth * seconds;
      s.y += speed * 0.4 * obj.depth * seconds;
      // Saiu da tela? Volta pelo lado oposto (reaproveita o objeto, nada é criado).
      if (s.x < -margin) {
        s.x = width + margin;
        // Planetas grandes voltam perto da borda de cima ou de baixo: no meio
        // eles brigariam com a curva e o multiplicador pela atenção do jogador.
        const big = obj.radius >= 0.1;
        s.y = big ? (Math.random() < 0.5 ? Math.random() * 0.2 : 0.85 + Math.random() * 0.2) * height : Math.random() * height;
      }
      if (s.y > height + margin) {
        s.y = -margin;
        s.x = Math.random() * width;
      }
    };

    for (const star of this.stars) {
      move(star, 4);
      star.sprite.alpha = star.baseAlpha * (0.6 + 0.4 * Math.sin(now / 1000 * star.twinkleSpeed + star.twinklePhase));
    }
    for (const planet of this.planets) {
      planet.sprite.scale.set(planetScale);
      planet.sprite.rotation += planet.spin * seconds;
      move(planet, planet.sprite.width / 2);
    }
  }

  /** Foguete desenhado com formas geométricas (apontando para a direita), no tema verde. */
  private buildRocket(): void {
    this.flame.poly([-20, -6, -40, 0, -20, 6]).fill(0xf97316).poly([-20, -3, -31, 0, -20, 3]).fill(0xfde047);
    const body = new Graphics()
      .poly([-26, -8, -10, -8, -20, -19]).fill(0x16a34a) // aleta de cima
      .poly([-26, 8, -10, 8, -20, 19]).fill(0x16a34a) // aleta de baixo
      .poly([-22, -9, 8, -9, 25, 0, 8, 9, -22, 9]).fill(0xdcfce7) // corpo
      .poly([8, -9, 25, 0, 8, 9]).fill(0x4ade80) // bico
      .rect(-22, -2, 30, 4).fill({ color: 0x16a34a, alpha: 0.5 }) // faixa
      .circle(0, 0, 4.5).fill(0x14532d) // janelinha (moldura)
      .circle(0, 0, 3).fill(0x86efac); // janelinha
    this.rocket.addChild(this.flame, body);
  }

  // ---------------------------------------------------------------- game loop

  /** Chamado pelo Ticker do Pixi a cada frame (~16ms a 60fps). */
  private update = (ticker: Ticker): void => {
    const startedAt = DEBUG ? performance.now() : 0;
    const dt = ticker.deltaMS; // ms desde o último frame: base de toda animação
    const now = performance.now();
    const state = this.getState();
    const plot = this.plotRect();

    this.handlePhaseChange(state);

    // 1) Quanto tempo de voo e qual multiplicador MOSTRAR neste frame?
    let elapsed = 0;
    let mult = 1;
    if (state.phase === "running") {
      // INTERPOLAÇÃO: o servidor manda ticks 10x/s, mas a curva é uma fórmula
      // conhecida. Então calculamos o valor exato para ESTE frame.
      // O relógio de exibição "persegue" suavemente o do servidor (cada tick
      // corrige runningSince), evitando trancos por variação da rede.
      const drift = state.runningSince - this.displaySince;
      this.displaySince = Math.abs(drift) > 250 ? state.runningSince : ease(this.displaySince, state.runningSince, dt, 100);
      elapsed = Math.max(0, now - this.displaySince);
      // Nunca deixa o número andar para trás (isso pareceria bug para o jogador).
      mult = Math.max(this.displayMult, multiplierAt(elapsed));
      this.displayMult = mult;
      this.crashElapsed = elapsed;
    } else if (state.phase === "crashed" && state.crashPoint !== null) {
      mult = state.crashPoint;
      elapsed = msToReach(state.crashPoint);
    }

    // 2) "Câmera": a área visível cresce junto com o voo, de forma suave.
    const targetT = Math.max(8_000, elapsed * 1.15);
    const targetM = Math.max(2, mult * 1.15);
    this.viewMaxT = Math.max(ease(this.viewMaxT, targetT, dt, 150), elapsed * 1.02);
    this.viewMaxM = Math.max(ease(this.viewMaxM, targetM, dt, 150), mult * 1.02);

    // 3) Desenho
    this.updateSpace(dt, state.phase, mult, now);
    this.drawGrid(plot);
    this.drawCurve(plot, state.phase, elapsed);
    this.updateRocket(plot, state.phase, elapsed, now, dt);
    this.updateHud(plot, state, mult, now);
    this.updateParticles(dt);

    // 4) Tremor da tela após a explosão, decaindo com o tempo
    if (this.shake > 0.1) {
      this.world.position.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake = ease(this.shake, 0, dt, 90);
    } else {
      this.world.position.set(0, 0);
    }

    if (DEBUG) this.recordPerf(dt, performance.now() - startedAt);
  };

  /** Reage a TRANSIÇÕES de fase (ex.: running -> crashed dispara a explosão). */
  private handlePhaseChange(state: GameState): void {
    if (state.phase === this.lastPhase && state.roundId === this.lastRoundId) return;

    if (state.phase === "running" && this.lastPhase !== "running") {
      this.displaySince = state.runningSince;
      this.displayMult = 1;
    }
    if (state.phase === "crashed" && this.lastPhase === "running") {
      this.explode(this.rocket.x, this.rocket.y);
    }
    if (state.phase === "betting") {
      this.displayMult = 1;
    }
    this.lastPhase = state.phase;
    this.lastRoundId = state.roundId;
  }

  // ---------------------------------------------------------------- desenho

  private plotRect(): Rect {
    const { width, height } = this.app.screen;
    return {
      x: PAD.left,
      y: PAD.top,
      w: Math.max(10, width - PAD.left - PAD.right),
      h: Math.max(10, height - PAD.top - PAD.bottom),
    };
  }

  /** Converte (tempo, multiplicador) do jogo para (x, y) em pixels na tela. */
  private xOf(t: number, plot: Rect): number {
    return plot.x + (t / this.viewMaxT) * plot.w;
  }
  private yOf(m: number, plot: Rect): number {
    return plot.y + plot.h - ((m - 1) / (this.viewMaxM - 1)) * plot.h;
  }

  private drawGrid(plot: Rect): void {
    const g = this.grid.clear();
    const step = niceStep((this.viewMaxM - 1) / 4);
    const decimals = step < 1 ? 1 : 0;

    // Linha em 1x e depois nos múltiplos "redondos" do passo (5x, 10x... e não 6x, 11x)
    const values = [1];
    for (let k = Math.floor(1 / step) + 1; values.length < this.labels.length; k++) {
      const m = k * step;
      if (m > this.viewMaxM) break;
      values.push(m);
    }

    let i = 0;
    for (; i < values.length; i++) {
      const m = values[i]!;
      const y = this.yOf(m, plot);
      g.moveTo(plot.x, y).lineTo(plot.x + plot.w, y);

      const label = this.labels[i]!;
      const text = `${m.toFixed(decimals)}x`;
      if (label.text !== text) label.text = text; // só re-renderiza o Text se mudou
      label.position.set(plot.x - 8, y);
      label.visible = true;
    }
    for (; i < this.labels.length; i++) this.labels[i]!.visible = false;

    // Eixo X: segundos de voo (2s, 4s, 6s...), com passo "bonito" que cresce junto com a câmera
    const seconds = this.viewMaxT / 1000;
    const tStep = niceStep(seconds / 5);
    const axisY = plot.y + plot.h + 10;
    let j = 0;
    for (let k = 1; j < this.timeLabels.length; k++, j++) {
      const t = k * tStep;
      if (t > seconds) break;
      const label = this.timeLabels[j]!;
      const text = `${t}s`;
      if (label.text !== text) label.text = text;
      label.position.set(this.xOf(t * 1000, plot), axisY);
      label.visible = true;
    }
    for (; j < this.timeLabels.length; j++) this.timeLabels[j]!.visible = false;

    g.stroke({ width: 1, color: COLORS.grid, alpha: 0.08 });
  }

  private drawCurve(plot: Rect, phase: RoundPhase, elapsed: number): void {
    this.area.clear();
    this.line.clear();
    if (phase === "betting" || elapsed <= 0) return;

    const color = phase === "crashed" ? COLORS.crash : COLORS.curve;
    const points: number[] = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = (elapsed * i) / CURVE_SAMPLES;
      points.push(this.xOf(t, plot), this.yOf(multiplierAt(t), plot));
    }

    const baseY = this.yOf(1, plot);
    // Área preenchida embaixo da curva
    this.area.moveTo(points[0]!, baseY);
    for (let i = 0; i < points.length; i += 2) this.area.lineTo(points[i]!, points[i + 1]!);
    this.area.lineTo(points[points.length - 2]!, baseY).closePath().fill({ color, alpha: 0.12 });

    // A linha da curva
    this.line.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) this.line.lineTo(points[i]!, points[i + 1]!);
    this.line.stroke({ width: 4, color, cap: "round", join: "round" });
  }

  private updateRocket(plot: Rect, phase: RoundPhase, elapsed: number, now: number, dt: number): void {
    if (phase === "crashed") {
      this.rocket.visible = false;
      return;
    }
    this.rocket.visible = true;
    const scale = Math.min(1.6, Math.max(0.85, plot.w / 480));
    this.rocket.scale.set(scale);

    if (phase === "betting") {
      // Parado na plataforma, "respirando"
      this.rocket.position.set(this.xOf(0, plot) + 24, this.yOf(1, plot) - 14 + Math.sin(now / 300) * 3);
      this.rocket.rotation = -0.6;
      this.flame.scale.set(0.4 + Math.random() * 0.15, 1);
      return;
    }

    // Em voo: na ponta da curva, apontando na direção dela (tangente)
    const x = this.xOf(elapsed, plot);
    const y = this.yOf(multiplierAt(elapsed), plot);
    const back = Math.max(0, elapsed - 150);
    const angle = Math.atan2(y - this.yOf(multiplierAt(back), plot), x - this.xOf(back, plot));
    this.rocket.position.set(x, y);
    this.rocket.rotation = Math.min(0, Math.max(-1.3, angle));
    this.flame.scale.set(0.8 + Math.random() * 0.6, 0.9 + Math.random() * 0.2); // fogo tremulando

    // Rastro de fumaça: uma partícula a cada ~16ms, saindo da cauda
    this.trailTimer += dt;
    while (this.trailTimer >= 16) {
      this.trailTimer -= 16;
      const r = this.rocket.rotation;
      const tailX = x - Math.cos(r) * 26 * scale;
      const tailY = y - Math.sin(r) * 26 * scale;
      this.spawn({
        x: tailX,
        y: tailY,
        vx: -Math.cos(r) * 40 + (Math.random() - 0.5) * 20,
        vy: -Math.sin(r) * 40 + (Math.random() - 0.5) * 20,
        gravity: 0,
        life: 700,
        color: COLORS.smoke,
        startScale: 0.25,
        endScale: 0.9,
        alpha: 0.35,
      });
    }
  }

  private updateHud(plot: Rect, state: GameState, mult: number, now: number): void {
    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h * 0.42;
    const hudScale = Math.min(1, Math.max(0.45, plot.w / 640));

    let text: string;
    let caption: string;
    let tint: number = COLORS.text;
    this.progressBar.clear();

    if (state.phase === "betting") {
      const msLeft = Math.max(0, state.bettingEndsAt - now);
      text = `${(msLeft / 1000).toFixed(1)}s`;
      caption = "PRÓXIMA RODADA EM";
      // Barra de progresso diminuindo até a decolagem
      const total = 5_000;
      const barW = 260 * hudScale;
      const barY = cy + 62 * hudScale;
      this.progressBar
        .roundRect(cx - barW / 2, barY, barW, 6, 3).fill({ color: COLORS.grid, alpha: 0.18 })
        .roundRect(cx - barW / 2, barY, barW * Math.min(1, msLeft / total), 6, 3).fill({ color: COLORS.curve });
    } else if (state.phase === "running") {
      // floor, não toFixed: toFixed ARREDONDA (1.175 -> "1.18") e mostraria mais do que o servidor paga.
      text = `${floorMultiplier(mult).toFixed(2)}x`;
      caption = "";
    } else {
      text = `${mult.toFixed(2)}x`;
      caption = "CRASH!";
      tint = COLORS.crash;
    }

    // Só atribui se mudou: evita recalcular o layout do texto à toa.
    if (this.multiplierText.text !== text) this.multiplierText.text = text;
    if (this.caption.text !== caption) this.caption.text = caption;
    this.multiplierText.tint = tint;
    this.caption.style.fill = tint;

    this.multiplierText.scale.set(hudScale);
    this.multiplierText.position.set(cx, cy);
    this.caption.scale.set(hudScale);
    this.caption.position.set(cx, cy - 66 * hudScale);
  }

  // ---------------------------------------------------------------- partículas

  private spawn(p: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    gravity: number;
    life: number;
    color: number;
    startScale: number;
    endScale: number;
    alpha: number;
  }): void {
    if (this.particles.length >= MAX_PARTICLES) return; // teto: protege o FPS
    const sprite = this.pool.pop() ?? new Sprite(this.particleTexture);
    sprite.anchor.set(0.5);
    sprite.position.set(p.x, p.y);
    sprite.tint = p.color;
    sprite.alpha = p.alpha;
    sprite.scale.set(p.startScale);
    this.particleLayer.addChild(sprite);
    this.particles.push({
      sprite,
      vx: p.vx,
      vy: p.vy,
      gravity: p.gravity,
      life: 0,
      maxLife: p.life,
      startScale: p.startScale,
      endScale: p.endScale,
      startAlpha: p.alpha,
    });
  }

  private explode(x: number, y: number): void {
    this.shake = 16;
    for (let i = 0; i < 70; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 360; // pixels por segundo
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 300,
        life: 500 + Math.random() * 600,
        color: COLORS.fire[i % COLORS.fire.length]!,
        startScale: 0.4 + Math.random() * 0.5,
        endScale: 0.05,
        alpha: 1,
      });
    }
  }

  private updateParticles(dt: number): void {
    const seconds = dt / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life += dt;
      const k = p.life / p.maxLife; // 0 = nasceu, 1 = morreu
      if (k >= 1) {
        // Devolve ao pool e remove do array com "swap and pop" (O(1), sem splice)
        this.particleLayer.removeChild(p.sprite);
        this.pool.push(p.sprite);
        this.particles[i] = this.particles[this.particles.length - 1]!;
        this.particles.pop();
        continue;
      }
      // Física simples: velocidade em px/s, multiplicada pelo tempo do frame
      p.vy += p.gravity * seconds;
      p.sprite.x += p.vx * seconds;
      p.sprite.y += p.vy * seconds;
      p.sprite.alpha = p.startAlpha * (1 - k);
      p.sprite.scale.set(p.startScale + (p.endScale - p.startScale) * k);
    }
  }

  /**
   * Profiling embutido (só com ?debug). FPS médio esconde engasgos; o p95 do
   * tempo entre frames mostra se ALGUNS frames estão lentos. E o tempo do nosso
   * update() diz quanto do orçamento (16.7ms a 60fps) é culpa do nosso código.
   */
  private recordPerf(frameMs: number, updateMs: number): void {
    this.frameSamples.push(frameMs);
    this.updateSamples.push(updateMs);
    if (this.frameSamples.length > PERF_SAMPLES) this.frameSamples.shift();
    if (this.updateSamples.length > PERF_SAMPLES) this.updateSamples.shift();

    this.debugTimer += frameMs;
    if (this.debugTimer < 500 || !this.debugText) return; // atualiza 2x/s: o overlay não pode pesar
    this.debugTimer = 0;

    const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
    const stats: PerfStats = {
      fps: Math.round(this.app.ticker.FPS),
      frameMsAvg: avg(this.frameSamples),
      frameMsP95: percentile(this.frameSamples, 0.95),
      frameMsMax: Math.max(...this.frameSamples),
      updateMsAvg: avg(this.updateSamples),
      updateMsP95: percentile(this.updateSamples, 0.95),
      particles: this.particles.length,
      pooled: this.pool.length,
    };
    (globalThis as { __crashPerf?: PerfStats }).__crashPerf = stats;

    const { width, height } = this.app.screen;
    this.debugText.text =
      `${stats.fps} fps · frame p95 ${stats.frameMsP95.toFixed(1)}ms · máx ${stats.frameMsMax.toFixed(1)}ms\n` +
      `update() ${stats.updateMsAvg.toFixed(2)}ms (p95 ${stats.updateMsP95.toFixed(2)}ms)\n` +
      `${stats.particles} partículas (pool ${stats.pooled}) · ${Math.round(width)}x${Math.round(height)} @${this.app.renderer.resolution}x · ${this.app.renderer.name}`;
    this.debugText.position.set(width - 8, PAD.top - 4); // abaixo das pílulas do histórico
  }
}
