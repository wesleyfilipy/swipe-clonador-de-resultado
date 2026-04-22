import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canProxyInBrowser, FACEBOOK_LIKE_REFERER } from "@/lib/media";

const MAX_BYTES = 80 * 1024 * 1024;

function safeRemoteUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const target = safeRemoteUrl(searchParams.get("url"));
  const filename = searchParams.get("name") ?? "download";

  if (!target) {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  const metaLike = canProxyInBrowser(target.toString());
  const upstream = await fetch(target.toString(), {
    redirect: "follow",
    headers: metaLike
      ? {
          Referer: FACEBOOK_LIKE_REFERER,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        }
      : undefined,
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Falha ao buscar arquivo" }, { status: 502 });
  }

  const len = upstream.headers.get("content-length");
  if (len && Number(len) > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo muito grande" }, { status: 413 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
