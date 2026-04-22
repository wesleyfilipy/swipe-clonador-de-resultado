import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function periodEnd(sub: Stripe.Subscription): string | null {
  const end = sub.current_period_end;
  if (!end) return null;
  return new Date(end * 1000).toISOString();
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook não configurado" }, { status: 500 });
  }

  const stripe = getStripe();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Assinatura ausente" }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const admin = createAdminClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    if (userId && subId && customerId) {
      const sub = await stripe.subscriptions.retrieve(subId);
      await admin.from("subscriptions").upsert(
        {
          user_id: userId,
          status: sub.status,
          stripe_customer_id: customerId,
          stripe_subscription_id: subId,
          current_period_end: periodEnd(sub),
        },
        { onConflict: "user_id" }
      );
    }
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    let userId = sub.metadata?.user_id;
    if (!userId && typeof sub.customer === "string") {
      const { data } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", sub.customer)
        .maybeSingle();
      userId = data?.user_id ?? undefined;
    }
    if (userId) {
      await admin
        .from("subscriptions")
        .update({
          status: sub.status,
          stripe_subscription_id: sub.id,
          current_period_end: periodEnd(sub),
        })
        .eq("user_id", userId);
    }
  }

  return NextResponse.json({ received: true });
}
