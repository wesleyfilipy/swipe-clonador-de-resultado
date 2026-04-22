import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { freeFeedUnlimitedEnv, isSubscriber } from "@/lib/subscription";
import { FeedShell } from "@/components/feed/FeedShell";
import { queryFeedAds, computeFeedHasMore } from "@/lib/feed-ads-query";
import { ensureFeedAdsForPageLoad, scheduleFeedCatalogFill } from "@/lib/feed-instant-fill";

const INITIAL_FEED_PAGE_SIZE = 24;

/** Com FEED_INSTANT_BLOCKING_FILL=1 a mineração síncrona pode levar minutos; padrão é background (`scheduleFeedCatalogFill`). */
export const maxDuration = 120;

export default async function FeedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (process.env.FEED_INSTANT_BLOCKING_FILL === "1") {
    await ensureFeedAdsForPageLoad();
  } else {
    scheduleFeedCatalogFill();
  }

  const paid = await isSubscriber(supabase, user.id);
  const subscriber = paid || freeFeedUnlimitedEnv();

  const { data: initialAds, count, error } = await queryFeedAds(supabase, {
    niche: "todos",
    sort: "scaled",
    offset: 0,
    pageSize: INITIAL_FEED_PAGE_SIZE,
    subscriber,
  });

  const rows = error ? [] : initialAds;
  const total = count ?? 0;
  const initialHasMore = computeFeedHasMore({
    offset: 0,
    pageSize: INITIAL_FEED_PAGE_SIZE,
    rowCount: rows.length,
    total,
    subscriber,
  });

  return (
    <FeedShell
      email={user.email ?? ""}
      initialAds={rows}
      initialHasMore={initialHasMore}
    />
  );
}
