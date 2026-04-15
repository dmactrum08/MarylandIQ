import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-03-31.basil",
});

const ALLOWED_AMOUNTS = [5, 10, 25, 50, 100]; // dollars

export async function POST(req: NextRequest) {
  let amount: number;
  try {
    const body = await req.json();
    amount = Number(body.amount);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!ALLOWED_AMOUNTS.includes(amount)) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
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
          unit_amount: amount * 100, // cents
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
