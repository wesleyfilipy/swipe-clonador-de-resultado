import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { freeFeedUnlimitedEnv, isSubscriber } from "@/lib/subscription";
import { FeedShell } from "@/components/feed/FeedShell";

export default async function FeedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const paid = await isSubscriber(supabase, user.id);
  const subscriber = paid || freeFeedUnlimitedEnv();

  return <FeedShell email={user.email ?? ""} initialSubscriber={subscriber} />;
}
