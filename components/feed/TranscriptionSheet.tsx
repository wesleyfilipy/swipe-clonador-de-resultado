"use client";

import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  title: string;
  adId: string;
  kind: "creative" | "vsl";
  onClose: () => void;
};

export function TranscriptionSheet({ open, title, adId, kind, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    fetch(`/api/transcriptions?ad_id=${encodeURIComponent(adId)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        const hit = (j.items as { type: string; text: string }[] | undefined)?.find((t) => t.type === kind);
        setText(hit?.text ?? null);
      })
      .catch(() => setError("Falha ao carregar"))
      .finally(() => setLoading(false));
  }, [open, adId, kind]);

  async function generate() {
    setGenerating(true);
    setError(null);
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ad_id: adId, type: kind }),
    });
    const j = await res.json();
    setGenerating(false);
    if (!res.ok) {
      setError(j.error ?? "Erro");
      return;
    }
    setText(j.text as string);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-h-[80dvh] rounded-t-2xl border border-zinc-800 bg-surface-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white text-sm">
            Fechar
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-zinc-500">Carregando…</p>
        ) : text ? (
          <p className="text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap max-h-[55dvh] overflow-y-auto no-scrollbar">
            {text}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">Ainda não há transcrição salva.</p>
            <button
              type="button"
              disabled={generating}
              onClick={generate}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
            >
              {generating ? "Gerando com Whisper…" : "Gerar com Whisper"}
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
