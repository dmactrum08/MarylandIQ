import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-03-25.dahlia",
});

// Stripe requires the raw body for signature verification —
// do NOT parse it as JSON before passing to constructEvent.
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error("[stripe-webhook] Missing signature or webhook secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let event: Stripe.Event;
  const rawBody = await req.text();

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Only record if payment was actually collected
    if (session.payment_status === "paid") {
      const amountDollars = session.amount_total ? session.amount_total / 100 : null;

      try {
        const supabase = createServerClient();
        await supabase.from("donations").insert({
          stripe_session_id: session.id,
          amount_cents: session.amount_total,
          currency: session.currency,
          email: session.customer_details?.email ?? null,
          paid_at: new Date().toISOString(),
        });
        console.log(`[stripe-webhook] Donation recorded: $${amountDollars}`);
      } catch (err) {
        // Log but don't fail the webhook — Stripe will retry on non-2xx
        console.error("[stripe-webhook] Failed to record donation:", err);
      }
    }
  }

  return NextResponse.json({ received: true });
}
