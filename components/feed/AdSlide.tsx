"use client";

import { useEffect, useRef, useState } from "react";
import type { AdRow } from "@/types/database";
import {
  isDirectVideoUrl,
  isLikelyEmbeddablePage,
  toMediaProxyUrl,
  isEmbeddableInIframe,
} from "@/lib/media";
import {
  getCreativoDownloadSourceUrl,
  getCreativeThumbSrc,
  getCreativeVideoSrc,
  hasCreativoFile,
  hideDuplicateVslSplit,
} from "@/lib/creative-urls";
import { TranscriptionSheet } from "./TranscriptionSheet";

type Props = {
  ad: AdRow;
  active: boolean;
  preload: boolean;
  favorited: boolean;
  vslLayout: "split" | "modal";
  onFavorite: () => void;
  onVslExpand?: () => void;
  /** Após o servidor rebuscar `video_url` e atualizar a linha. */
  onAdPatched?: (ad: AdRow) => void;
};

export function AdSlide({ ad, active, preload, favorited, vslLayout, onFavorite, onVslExpand, onAdPatched }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const vslVideoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [sheet, setSheet] = useState<"creative" | "vsl" | null>(null);
  const [vslModal, setVslModal] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [active]);

  useEffect(() => {
    const v = vslVideoRef.current;
    if (!v) return;
    if (active && vslLayout === "split" && isDirectVideoUrl(ad.vsl_url)) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [active, vslLayout, ad.vsl_url]);

  const creative: string | undefined = getCreativeVideoSrc(ad) ?? undefined;
  const previewThumb = getCreativeThumbSrc(ad);
  const vsl = ad.vsl_url;
  const vslIsVideo = isDirectVideoUrl(vsl);
  const vslIsPage = isLikelyEmbeddablePage(vsl) && !vslIsVideo;
  const vslPlayback: string | undefined = (toMediaProxyUrl(vsl) ?? vsl) || undefined;
  const vslInIframe = Boolean(vsl && vslIsPage && isEmbeddableInIframe(vsl));
  const vslPageButNoIframe = Boolean(vsl && vslIsPage && !vslInIframe);

  function downloadUrl(url: string | null | undefined, name: string) {
    if (!url) return;
    const href = `/api/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    a.click();
  }

  async function copyCopy() {
    if (!ad.ad_copy) return;
    await navigator.clipboard.writeText(ad.ad_copy);
  }

  const fbAdLibraryUrl = ad.facebook_ad_id
    ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(ad.facebook_ad_id)}`
    : null;
  const offerSiteUrl = ad.landing_domain?.trim()
    ? `https://${ad.landing_domain.replace(/^https?:\/\//i, "").split("/")[0]}`
    : null;

  const showSplitVsl =
    vslLayout === "split" &&
    (vslIsVideo || vslIsPage) &&
    !hideDuplicateVslSplit(ad);

  async function tryResolveVideoInApp() {
    setResolveError(null);
    setResolving(true);
    try {
      const r = await fetch(`/api/ads/${encodeURIComponent(ad.id)}/resolve-creative`, { method: "POST" });
      const j = (await r.json()) as { ad?: AdRow; error?: string; detail?: string };
      if (!r.ok) {
        setResolveError([j.error, j.detail].filter(Boolean).join(" — ") || "Pedido falhou");
        return;
      }
      if (j.ad) onAdPatched?.(j.ad);
    } catch {
      setResolveError("Falha de rede ao atualizar o vídeo.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <section className="feed-item h-full min-h-0 w-full max-w-6xl mx-auto relative bg-black flex flex-col">
      <div className={showSplitVsl ? "h-[48dvh] min-h-0 shrink-0" : "flex-1 min-h-0"}>
        {creative ? (
          <video
            ref={videoRef}
            className="h-full w-full object-cover bg-black"
            src={creative}
            poster={getCreativeThumbSrc(ad) ?? undefined}
            playsInline
            loop
            muted={muted}
            preload={preload ? "auto" : "metadata"}
            controls={false}
          />
        ) : (
          <div className="relative h-full w-full min-h-[40dvh] flex flex-col items-center justify-center gap-4 px-4 text-center bg-zinc-950/90">
            {previewThumb && (
              <div className="absolute inset-0 z-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewThumb}
                  alt=""
                  className="h-full w-full object-contain object-center opacity-40"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-zinc-950/80" />
              </div>
            )}
            <div className="relative z-10 flex flex-col items-center gap-3 max-w-md">
              <p className="text-sm text-zinc-200 font-medium">Vídeo do criativo ainda não veio da mineração</p>
              <p className="text-xs text-zinc-400">
                Tenta rebuscar o ficheiro na Ad Library (servidor) para ver e descarregar aqui. Ainda podes abrir o anúncio
                original na Facebook.
              </p>
              {resolveError && <p className="text-xs text-amber-300/95 whitespace-pre-line">{resolveError}</p>}
              {ad.facebook_ad_id && (
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => void tryResolveVideoInApp()}
                  className="rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2.5 text-sm font-medium text-white"
                >
                  {resolving ? "A obter vídeo…" : "Tentar obter vídeo no app"}
                </button>
              )}
              <div className="flex flex-col sm:flex-row flex-wrap gap-2 justify-center w-full">
                {fbAdLibraryUrl && (
                  <a
                    href={fbAdLibraryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white"
                  >
                    Ver anúncio na Biblioteca
                  </a>
                )}
                {offerSiteUrl && (
                  <a
                    href={offerSiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-zinc-600 hover:border-zinc-500 px-4 py-2.5 text-sm text-zinc-100"
                  >
                    Abrir site da oferta
                  </a>
                )}
                {ad.ad_copy && (
                  <button
                    type="button"
                    onClick={() => void copyCopy()}
                    className="rounded-full border border-zinc-600 hover:border-zinc-500 px-4 py-2.5 text-sm text-zinc-200"
                  >
                    Copiar descrição
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showSplitVsl && (
        <div className="flex-1 min-h-0 border-t border-zinc-800 bg-surface-950 relative">
          {vslIsVideo && vsl ? (
            <video
              ref={vslVideoRef}
              className="h-full w-full object-contain bg-black"
              src={vslPlayback}
              playsInline
              controls
              muted={false}
              preload={preload ? "auto" : "metadata"}
            />
          ) : vslInIframe && vsl ? (
            <iframe
              title="VSL"
              src={vsl}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              loading={preload ? "eager" : "lazy"}
            />
          ) : vslPageButNoIframe && vsl ? (
            <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-6 text-center bg-zinc-950">
              <p className="text-sm text-zinc-400 max-w-sm">
                Este site (ex.: Facebook / Instagram) não permite ver a página dentro do app — bloqueio de iframe
                (X-Frame-Options).
              </p>
              <a
                href={vsl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white"
              >
                Abrir em nova aba
              </a>
            </div>
          ) : null}
        </div>
      )}

      {!showSplitVsl && vsl && (
        <button
          type="button"
          onClick={() => {
            setVslModal(true);
            onVslExpand?.();
          }}
          className="absolute bottom-28 left-4 rounded-full bg-zinc-900/90 border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-100"
        >
          Ver VSL na tela
        </button>
      )}

      {vslModal && vsl && (
        <div
          className="absolute inset-0 z-30 bg-black/90 flex flex-col"
          onClick={() => setVslModal(false)}
        >
          <div className="flex justify-between items-center px-4 py-3 border-b border-zinc-800">
            <span className="text-sm font-medium">VSL</span>
            <button type="button" className="text-sm text-zinc-400" onClick={() => setVslModal(false)}>
              Fechar
            </button>
          </div>
          <div className="flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
            {vslIsVideo ? (
              <video src={vslPlayback} className="h-full w-full object-contain" playsInline controls autoPlay />
            ) : vslInIframe ? (
              <iframe
                title="VSL modal"
                src={vsl}
                className="h-full w-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-zinc-400 p-6">
                <p className="text-sm text-center">Incorporação bloqueada pelo site de destino.</p>
                <a
                  href={vsl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:underline"
                >
                  Abrir em nova aba
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        className="absolute top-20 right-3 rounded-full bg-black/55 px-3 py-1 text-[11px] text-white border border-white/10"
      >
        {muted ? "Ativar som" : "Silenciar"}
      </button>

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-20">
        <IconButton
          label="Favorito"
          onClick={onFavorite}
          active={favorited}
          icon={
            <span className={favorited ? "text-amber-400" : "text-white"}>{favorited ? "★" : "☆"}</span>
          }
        />
        <IconButton
          label="Baixar criativo"
          onClick={() => downloadUrl(getCreativoDownloadSourceUrl(ad), `${ad.title}-criativo.mp4`)}
          icon={<span className="text-white">⬇</span>}
          disabled={!hasCreativoFile(ad)}
        />
        <IconButton
          label="Baixar VSL"
          onClick={() =>
            downloadUrl(
              ad.vsl_url,
              vslIsVideo ? `${ad.title}-vsl.mp4` : `${ad.title}-vsl.html`
            )
          }
          icon={<span className="text-white">⬇</span>}
          disabled={!ad.vsl_url}
        />
        {fbAdLibraryUrl && (
          <IconButton
            label="Ver na Facebook"
            onClick={() => window.open(fbAdLibraryUrl, "_blank", "noopener,noreferrer")}
            icon={<span className="text-white text-xs font-bold">f</span>}
          />
        )}
        {offerSiteUrl && (
          <IconButton
            label="Site da oferta"
            onClick={() => window.open(offerSiteUrl, "_blank", "noopener,noreferrer")}
            icon={<span className="text-white">🌐</span>}
          />
        )}
        {vsl && !vslIsVideo && (
          <IconButton
            label="Abrir VSL (nova aba)"
            onClick={() => window.open(vsl, "_blank", "noopener,noreferrer")}
            icon={<span className="text-white">↗</span>}
          />
        )}
        <IconButton label="Transcrição criativo" onClick={() => setSheet("creative")} icon={<span>📄</span>} />
        <IconButton label="Transcrição VSL" onClick={() => setSheet("vsl")} icon={<span>📄</span>} />
        <IconButton label="Copiar copy" onClick={copyCopy} icon={<span>📋</span>} />
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-4 pb-8 bg-gradient-to-t from-black via-black/70 to-transparent z-10">
        <p className="text-xs text-indigo-300 font-medium uppercase tracking-wide">{ad.niche}</p>
        <h3 className="text-lg font-semibold leading-snug line-clamp-2">{ad.title}</h3>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-300">
          <Stat label="views/dia" value={ad.views_day.toLocaleString("pt-BR")} />
          <Stat label="views/sem" value={ad.views_week.toLocaleString("pt-BR")} />
          <Stat label="dias ativo" value={String(ad.active_days)} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-2 text-[10px]">
          {fbAdLibraryUrl && (
            <a
              href={fbAdLibraryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:underline"
            >
              Facebook
            </a>
          )}
          {offerSiteUrl && (
            <a href={offerSiteUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-400/90 hover:underline">
              Site
            </a>
          )}
          {ad.landing_domain && (
            <span className="text-zinc-500 truncate max-w-[140px]" title={ad.landing_domain}>
              {ad.landing_domain}
            </span>
          )}
        </div>
        {ad.ad_copy && <p className="mt-2 text-xs text-zinc-300 line-clamp-3">{ad.ad_copy}</p>}
      </div>

      <TranscriptionSheet
        open={sheet === "creative"}
        title="Transcrição — criativo"
        adId={ad.id}
        kind="creative"
        onClose={() => setSheet(null)}
      />
      <TranscriptionSheet
        open={sheet === "vsl"}
        title="Transcrição — VSL"
        adId={ad.id}
        kind="vsl"
        onClose={() => setSheet(null)}
      />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5">
      {label}: <span className="text-white font-medium">{value}</span>
    </span>
  );
}

function IconButton({
  label,
  onClick,
  icon,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`h-11 w-11 rounded-full border border-white/15 bg-black/50 backdrop-blur flex items-center justify-center text-sm ${
        active ? "ring-2 ring-amber-400/80" : ""
      } ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-white/10"}`}
    >
      {icon}
    </button>
  );
}
