import { Texture } from "pixi.js";

/**
 * Planetas do fundo, gerados por código (nenhuma imagem para baixar).
 *
 * Técnica: cada planeta é desenhado UMA vez num <canvas> 2D (que tem gradiente
 * radial, clip e curvas prontos) e vira uma textura. Depois disso o Pixi só
 * move sprites, o que é baratíssimo: desenhar planeta a cada frame não seria.
 */
export interface PlanetSpec {
  /** Raio como fração da ALTURA do canvas (assim escala com a tela). */
  radius: number;
  /** Cores do corpo: [luz, meio, sombra]. */
  colors: [string, string, string];
  /** Faixas de gás (tipo Júpiter). */
  bands?: string;
  /** Crateras (tipo Lua). */
  craters?: boolean;
  /** Cor do anel (tipo Saturno). */
  ring?: string;
  /** Posição inicial, em fração da tela (0..1). */
  x: number;
  y: number;
  /** 0..1: profundidade do parallax. Mais perto = passa mais rápido. */
  depth: number;
}

export const PLANETS: PlanetSpec[] = [
  { radius: 0.42, colors: ["#8b9cf0", "#4338ca", "#1e1b4b"], bands: "#c7d2fe", x: 0.1, y: 0.18, depth: 0.18 },
  { radius: 0.2, colors: ["#fdba74", "#c2410c", "#431407"], craters: true, x: 0.06, y: 0.95, depth: 0.3 },
  { radius: 0.085, colors: ["#f5d0fe", "#a21caf", "#3b0764"], ring: "#f0abfc", x: 0.88, y: 0.16, depth: 0.5 },
  { radius: 0.05, colors: ["#a5f3fc", "#0e7490", "#083344"], bands: "#cffafe", x: 0.5, y: 0.7, depth: 0.7 },
  { radius: 0.03, colors: ["#f3f4f6", "#6b7280", "#1f2937"], craters: true, x: 0.9, y: 0.62, depth: 0.85 },
];

/** Altura de referência em que as texturas são geradas (depois o sprite escala). */
export const PLANET_REFERENCE_HEIGHT = 600;
/** Gera a textura com 2x de pixels, para continuar nítida em telas retina. */
export const PLANET_TEXTURE_SCALE = 2;

/** "#rrggbb" + alfa -> "rgba(r,g,b,a)" */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Números "aleatórios" previsíveis: o mesmo planeta sai igual em todo reload. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function makePlanetTexture(spec: PlanetSpec, seed: number): Texture {
  const r = spec.radius * PLANET_REFERENCE_HEIGHT;
  const glow = r * 0.3;
  const ringW = spec.ring ? r * 1.9 : 0;
  const half = Math.ceil(Math.max(r + glow, ringW + 4));
  const size = half * 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * PLANET_TEXTURE_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PLANET_TEXTURE_SCALE, PLANET_TEXTURE_SCALE);
  const c = half;
  const random = seededRandom(seed);

  // 1) Atmosfera: um halo suave em volta do planeta
  const atmosphere = ctx.createRadialGradient(c, c, r * 0.85, c, c, r + glow);
  atmosphere.addColorStop(0, rgba(spec.colors[0], 0.35));
  atmosphere.addColorStop(1, rgba(spec.colors[0], 0));
  ctx.fillStyle = atmosphere;
  ctx.beginPath();
  ctx.arc(c, c, r + glow, 0, Math.PI * 2);
  ctx.fill();

  // 2) Metade de TRÁS do anel (fica atrás do planeta)
  const drawRing = (start: number, end: number) => {
    if (!spec.ring) return;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-0.38);
    ctx.lineCap = "round";
    for (const [scale, width, alpha] of [
      [1.9, 0.1, 0.55],
      [1.55, 0.14, 0.8],
    ] as const) {
      ctx.strokeStyle = rgba(spec.ring, alpha);
      ctx.lineWidth = r * width;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * scale, r * scale * 0.28, 0, start, end);
      ctx.stroke();
    }
    ctx.restore();
  };
  drawRing(Math.PI, Math.PI * 2);

  // 3) Corpo: gradiente radial com a luz vindo de cima/esquerda
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip(); // tudo daqui em diante fica DENTRO do círculo
  const body = ctx.createRadialGradient(c - r * 0.45, c - r * 0.45, r * 0.05, c, c, r * 1.05);
  body.addColorStop(0, spec.colors[0]);
  body.addColorStop(0.55, spec.colors[1]);
  body.addColorStop(1, spec.colors[2]);
  ctx.fillStyle = body;
  ctx.fillRect(c - r, c - r, r * 2, r * 2);

  if (spec.bands) {
    // Faixas onduladas de gás
    const count = 7;
    for (let i = 0; i < count; i++) {
      const y = c - r + ((i + 0.5) * 2 * r) / count;
      ctx.strokeStyle = rgba(spec.bands, 0.08 + random() * 0.14);
      ctx.lineWidth = r * (0.08 + random() * 0.12);
      ctx.beginPath();
      const amplitude = r * 0.05 * (0.5 + random());
      const phase = random() * Math.PI * 2;
      for (let x = c - r; x <= c + r; x += r / 12) {
        const yy = y + Math.sin((x / r) * 3 + phase) * amplitude;
        if (x === c - r) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  }

  if (spec.craters) {
    for (let i = 0; i < 9; i++) {
      const angle = random() * Math.PI * 2;
      const dist = random() * r * 0.8;
      const cr = r * (0.06 + random() * 0.14);
      const x = c + Math.cos(angle) * dist;
      const y = c + Math.sin(angle) * dist;
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.beginPath();
      ctx.arc(x, y, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = Math.max(1, cr * 0.15);
      ctx.beginPath();
      ctx.arc(x - cr * 0.1, y - cr * 0.1, cr, Math.PI * 0.9, Math.PI * 1.7);
      ctx.stroke();
    }
  }

  // Sombra do lado oposto à luz (o "terminador" dia/noite)
  const shade = ctx.createLinearGradient(c - r, c - r, c + r, c + r);
  shade.addColorStop(0.45, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  ctx.fillStyle = shade;
  ctx.fillRect(c - r, c - r, r * 2, r * 2);
  ctx.restore();

  // 4) Metade da FRENTE do anel (passa na frente do planeta)
  drawRing(0, Math.PI);

  return Texture.from(canvas);
}
