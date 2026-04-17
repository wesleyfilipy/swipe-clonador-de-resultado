import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSubscriber } from "@/lib/subscription";
import { FeedShell } from "@/components/feed/FeedShell";

export default async function FeedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const subscriber = await isSubscriber(supabase, user.id);

  return <FeedShell email={user.email ?? ""} initialSubscriber={subscriber} />;
}
