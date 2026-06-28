"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGame } from "./GameProvider";
import { fmtTime as fmt } from "./audio";
import { useMobile } from "./useMobile";
import type { MusicMeta, NowPlaying } from "@/game/types";
import styles from "./MusicPlayer.module.css";

/** Posição atual da faixa derivada do relógio (sincronizada para todos). */
function positionFor(np: NowPlaying | null, duration: number): number {
  if (!np) return 0;
  let pos = (Date.now() - np.startedAt) / 1000;
  if (pos < 0) pos = 0;
  if (np.loop && duration > 0) pos = pos % duration;
  return pos;
}

export function MusicPlayer() {
  const { state, session, emit, trackData } = useGame();
  const isGM = session?.role === "gm";
  const mobile = useMobile();
  const nowPlaying = state?.game.nowPlaying ?? null;
  const music: MusicMeta[] = state?.music ?? [];
  const current = music.find((m) => m.id === nowPlaying?.trackId) ?? null;
  const duration = current?.duration ?? 0;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedSrcRef = useRef<string | null>(null);

  const [volume, setVolume] = useState(0.1);
  const [muted, setMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [, setTick] = useState(0);

  // Carrega preferências locais (volume/mudo) — padrão 10%.
  useEffect(() => {
    try {
      const v = localStorage.getItem("music.volume");
      const m = localStorage.getItem("music.muted");
      if (v !== null) setVolume(Math.max(0, Math.min(1, Number(v))));
      if (m !== null) setMuted(m === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Pede o áudio (data URL) da faixa atual sob demanda.
  useEffect(() => {
    if (nowPlaying?.trackId && trackData?.id !== nowPlaying.trackId) {
      emit("music:track", { trackId: nowPlaying.trackId });
    }
  }, [nowPlaying?.trackId, trackData?.id, emit]);

  // Define a fonte do <audio> quando o áudio chega (ou para, sem música).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!nowPlaying) {
      a.pause();
      loadedSrcRef.current = null;
      a.removeAttribute("src");
      a.load();
      return;
    }
    if (
      trackData &&
      trackData.id === nowPlaying.trackId &&
      loadedSrcRef.current !== trackData.src
    ) {
      loadedSrcRef.current = trackData.src;
      a.src = trackData.src;
      a.load();
    }
  }, [nowPlaying, trackData]);

  // Loop + volume/mudo aplicados ao elemento.
  useEffect(() => {
    const a = audioRef.current;
    if (a) a.loop = nowPlaying?.loop ?? false;
  }, [nowPlaying?.loop]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) {
      a.volume = volume;
      a.muted = muted;
    }
    try {
      localStorage.setItem("music.volume", String(volume));
      localStorage.setItem("music.muted", muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [volume, muted]);

  // Sincroniza posição e dá play (na carga e quando a faixa/startedAt muda).
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !nowPlaying) return;
    if (!trackData || trackData.id !== nowPlaying.trackId) return;
    const sync = () => {
      const dur = duration || a.duration || 0;
      const pos = positionFor(nowPlaying, dur);
      if (Number.isFinite(pos) && Math.abs(a.currentTime - pos) > 0.5) {
        try {
          a.currentTime = pos;
        } catch {
          /* ignore */
        }
      }
      a.play().then(
        () => setNeedsGesture(false),
        () => setNeedsGesture(true),
      );
    };
    if (a.readyState >= 1) {
      sync();
    } else {
      a.addEventListener("loadedmetadata", sync, { once: true });
      return () => a.removeEventListener("loadedmetadata", sync);
    }
  }, [nowPlaying, trackData, duration]);

  // Corrige deriva (aba em segundo plano etc.) a cada 4s + relógio do display.
  useEffect(() => {
    if (!nowPlaying) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      const a = audioRef.current;
      if (!a || a.paused) return;
      if (!trackData || trackData.id !== nowPlaying.trackId) return;
      const dur = duration || a.duration || 0;
      const pos = positionFor(nowPlaying, dur);
      if (Number.isFinite(pos) && Math.abs(a.currentTime - pos) > 1) {
        try {
          a.currentTime = pos;
        } catch {
          /* ignore */
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [nowPlaying, trackData, duration]);

  function enableAudio() {
    const a = audioRef.current;
    if (!a) return;
    a.play().then(
      () => setNeedsGesture(false),
      () => setNeedsGesture(true),
    );
  }

  const rawPos = positionFor(nowPlaying, duration);
  const pos = duration ? Math.min(rawPos, duration) : rawPos;
  const progress = duration ? Math.min(1, pos / duration) : 0;

  // No mobile, sem a UI do player — só o áudio (a música continua tocando/sincronizada).
  if (mobile) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio ref={audioRef} hidden />;
  }

  return (
    <div className={styles.player}>
      {/* elemento de áudio persistente (escondido) */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} hidden />

      {nowPlaying && current ? (
        <>
          <div className={styles.info}>
            <span className={styles.title} title={current.name}>
              ♪ {current.name}
            </span>
            <span className={styles.time}>
              {fmt(pos)} / {fmt(duration)}
            </span>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${progress * 100}%` }} />
          </div>
        </>
      ) : (
        <span className={styles.idle}>♪ sem música</span>
      )}

      <div className={styles.controls}>
        {needsGesture && (
          <button className={styles.warn} onClick={enableAudio} title="Ativar áudio">
            ▶ ativar
          </button>
        )}
        {nowPlaying && (
          <button
            className={nowPlaying.loop ? styles.on : ""}
            disabled={!isGM}
            onClick={() => emit("gm:music:loop", { loop: !nowPlaying.loop })}
            title="Repetir"
          >
            loop
          </button>
        )}
        <button
          className={muted ? styles.on : ""}
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Reativar som" : "Mutar"}
        >
          {muted ? "mudo" : "som"}
        </button>
        <input
          type="range"
          className={styles.vol}
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          title={`Volume ${Math.round(volume * 100)}%`}
        />
        {isGM && (
          <button onClick={() => setChooserOpen(true)} title="Escolher música">
            músicas
          </button>
        )}
      </div>

      {chooserOpen && isGM && (
        <MusicChooser music={music} nowPlaying={nowPlaying} onClose={() => setChooserOpen(false)} />
      )}
    </div>
  );
}

function MusicChooser({
  music,
  nowPlaying,
  onClose,
}: {
  music: MusicMeta[];
  nowPlaying: NowPlaying | null;
  onClose: () => void;
}) {
  const { emit } = useGame();

  // Portal para o body: o header/player tem `transform`, o que criaria um
  // bloco de contenção para `position: fixed` e encolheria o overlay.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h3>Escolher música</h3>
          <button onClick={onClose}>fechar</button>
        </div>

        <div className={styles.tracks}>
          {music.length === 0 && (
            <p className="muted">
              Nenhuma música cadastrada. Adicione em Cadastros › Músicas.
            </p>
          )}
          {music.map((m) => {
            const playing = nowPlaying?.trackId === m.id;
            return (
              <div key={m.id} className={`${styles.track} ${playing ? styles.trackOn : ""}`}>
                <span className={styles.trackName} title={m.name}>
                  {playing ? "▶ " : ""}
                  {m.name}
                </span>
                <span className={styles.trackDur}>{fmt(m.duration)}</span>
                <button onClick={() => emit("gm:music:play", { trackId: m.id })}>tocar</button>
              </div>
            );
          })}
        </div>

        {nowPlaying && (
          <div className={styles.modalFoot}>
            <button onClick={() => emit("gm:music:stop")}>parar música</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
