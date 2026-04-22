import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canProxyInBrowser, safeHttpUrl, FACEBOOK_LIKE_REFERER } from "@/lib/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Faz stream de imagem/vídeo da Meta (fbcdn, etc.) com Referer, para o <video>/<img> no teu
 * domínio não receber 400/403 (hotlink).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const target = safeHttpUrl(req.nextUrl.searchParams.get("url"));
  if (!target) {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }
  if (!canProxyInBrowser(target.toString())) {
    return NextResponse.json({ error: "Host não permitido" }, { status: 400 });
  }

  const range = req.headers.get("range") ?? undefined;
  const upstream = await fetch(target.toString(), {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      Referer: FACEBOOK_LIKE_REFERER,
      Accept: req.headers.get("accept") ?? "*/*",
      ...(range ? { Range: range } : {}),
    },
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
  }
  if (!upstream.body) {
    return NextResponse.json({ error: "Corpo vazio" }, { status: 502 });
  }

  const resHeaders = new Headers();
  const pass = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "last-modified",
    "cache-control",
  ] as const;
  for (const k of pass) {
    const v = upstream.headers.get(k);
    if (v) resHeaders.set(k, v);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}
