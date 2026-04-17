import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-03-31.basil",
});

const MIN_AMOUNT = 1;   // dollars
const MAX_AMOUNT = 1000; // dollars

export async function POST(req: NextRequest) {
  let amount: number;
  try {
    const body = await req.json();
    amount = Number(body.amount);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return NextResponse.json({ error: "Amount must be between $1 and $1,000" }, { status: 400 });
  }

  const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://marylandiq.org";

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: Math.round(amount * 100), // cents
          product_data: {
            name: "Support MarylandIQ",
            description:
              "MarylandIQ is a free, nonpartisan voter research tool for Maryland. Your contribution helps keep it running.",
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/donate/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/donate`,
      submit_type: "donate",
      custom_text: {
        submit: {
          message:
            "Contributions are not tax-deductible. MarylandIQ is an independent project, not a registered nonprofit.",
        },
      },
    });
  } catch (err) {
    console.error("[api/donate] Stripe error:", err);
    return NextResponse.json({ error: "Stripe error" }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
