# ESPIÃO NUTRA

Feed vertical de criativos/VSL (modo swipe). O feed lê a tabela **`ads`** no Supabase; anúncios entram pelo **cron**, sync em background ou **`npm run seed`** / **`bot/`**.

## O que adicionar na Vercel (Environment Variables)

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Sim | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sim | Chave anon |
| `SUPABASE_ANON_KEY` | Recomendado | Igual à anon (servidor) |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Service role — cron e APIs admin |
| `SUPABASE_URL` | Opcional | Mesma URL do Supabase se usar rotas que leem esta env |
| `CRON_SECRET` | Sim | Senha longa aleatória; protege `/api/cron/*` (agendado: `/api/cron/scheduled`) |
| `APIFY_TOKEN` | Sim p/ Apify | Mineração via Apify (sem token da Meta). Use com `APIFY_ONLY=1` para nunca chamar a Graph API. |
| `APIFY_ONLY` | Opcional | `1` = só Apify; pode remover `META_AD_LIBRARY_ACCESS_TOKEN` da Vercel. |
| `META_AD_LIBRARY_ACCESS_TOKEN` | Opcional* | *Só se não usar Apify; acesso à Ad Library (`ads_archive`) |
| `META_APP_SECRET` | Se a Meta exigir | App Secret do mesmo app do token (chamadas com `appsecret_proof`) |
| `META_AD_LIBRARY_COUNTRIES` | Opcional | Ex.: `US,GB` — ajuda se a API devolver pouco só com `US` |
| `META_AD_LIBRARY_MEDIA_TYPE` | Opcional | `VIDEO` (padrão) ou `ALL` se vier 0 anúncios |
| `FREE_FEED_UNLIMITED` | Opcional | `0` só se quiser limite free + Stripe de volta (padrão no código: ilimitado) |
| `AUTO_AD_LIBRARY_SYNC` | Opcional | `0` desliga o sync em background no `/api/ads` |

**Primeira carga manual** (troque o domínio e o secret). No **Hobby** só pode existir **um** cron no `vercel.json`; o job unificado é `/api/cron/scheduled` (mineração + spy com intervalo interno).

`https://SEU_DOMINIO.vercel.app/api/cron/scheduled?secret=SEU_CRON_SECRET`

Rotas antigas ainda existem: `/api/cron/mine-ad-library`, `/api/cron/spy-weekly`. Resposta com `inserted` / `spy.inserted` > 0 = sucesso parcial ou total.

## Supabase (SQL Editor)

Comentários em SQL usam **dois** hífens: `-- texto`. Um único `-` ou texto solto na primeira linha gera erro `42601`.

**Instalação única (recomendado após zerar o projeto):** abra e execute o arquivo  
[`supabase/complete_install.sql`](supabase/complete_install.sql) — contém schema + `mine_source` + colunas do bot + storage + `ingest_lock` + políticas.

Ou, em partes:

1. `supabase/schema.sql` (projeto novo — o arquivo começa direto em `create extension`)
2. `supabase/migration_mine_source.sql` — coluna `mine_source` (cron apaga o lote certo)
3. Opcional: `supabase/migration_bot_ads.sql` se for usar o `bot/`
4. Opcional: `supabase/migration_ingest_lock.sql` — lock do sync em background

## Repositório

https://github.com/wesleyfilipy/swipe-clonador-de-resultado
