// Efeitos sonoros via Web Audio API. Um único AudioContext, mas cada som toca
// num BufferSource + GainNode próprios, então os sons são independentes e podem
// se sobrepor. Os arquivos ficam em /public/assets/sfx/<nome>.mp3.

export type SfxName =
  | "navigate"
  | "confirm"
  | "cancel"
  | "move"
  | "error"
  | "distortion"
  | "laser";

// Volume por som (0..1) — ajuste fino aqui, no código. Lido a cada toque, então
// editar e salvar reflete na hora (o AudioContext sobrevive ao hot-reload).
const VOLUMES: Record<SfxName, number> = {
  navigate: 0.35,
  confirm: 0.5,
  cancel: 0.55,
  move: 2.5,
  error: 0.35,
  distortion: 0.4,
  laser: 0.5,
};

const FILES: Record<SfxName, string> = {
  navigate: "/assets/sfx/navigate.mp3",
  confirm: "/assets/sfx/confirm.mp3",
  cancel: "/assets/sfx/cancel.mp3",
  move: "/assets/sfx/move.mp3",
  error: "/assets/sfx/error.mp3",
  distortion: "/assets/sfx/distortion.mp3",
  laser: "/assets/sfx/laser.mp3",
};

// O AudioContext e os buffers decodificados vivem no globalThis (não no escopo do
// módulo) para SOBREVIVER ao hot-reload do dev. Sem isso, ao editar este arquivo
// (ex.: afinar volumes) o Fast Refresh zerava o contexto e os sons sumiam até um
// reload completo + novo login. Aqui a edição passa a valer na hora.
interface SfxStore {
  ctx: AudioContext | null;
  buffers: Map<SfxName, AudioBuffer>;
}
const G = globalThis as unknown as { __matrixSfx?: SfxStore };
function store(): SfxStore {
  if (!G.__matrixSfx) G.__matrixSfx = { ctx: null, buffers: new Map() };
  return G.__matrixSfx;
}

/**
 * Cria/inicia o AudioContext. DEVE ser chamado dentro de um gesto do usuário
 * (ex.: clique de login), senão o navegador mantém o contexto suspenso.
 */
export function unlockSfx(): void {
  if (typeof window === "undefined") return;
  const s = store();
  if (s.ctx) {
    if (s.ctx.state === "suspended") void s.ctx.resume();
    return;
  }
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    s.ctx = ctx;
    void ctx.resume();
    // Pré-carrega e decodifica cada som (independentes; falha silenciosa se faltar).
    (Object.keys(FILES) as SfxName[]).forEach(async (name) => {
      try {
        const res = await fetch(FILES[name]);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(data);
        s.buffers.set(name, decoded);
      } catch {
        /* arquivo ausente / formato inválido — ignora */
      }
    });
  } catch {
    /* navegador sem Web Audio */
  }
}

/** Toca um som de forma independente (pode sobrepor outros). */
export function playSfx(name: SfxName): void {
  const { ctx, buffers } = store();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const buf = buffers.get(name);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = VOLUMES[name]; // lido no momento do toque → edição vale na hora
  src.connect(gain).connect(ctx.destination);
  src.start();
}
