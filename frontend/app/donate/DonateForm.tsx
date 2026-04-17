"use client";

import { useState } from "react";

const PRESET_AMOUNTS = [5, 10, 25, 50, 100];

export default function DonateForm() {
  const [selected, setSelected] = useState<number | "custom">(10);
  const [customAmount, setCustomAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function getAmount(): number {
    if (selected === "custom") return parseFloat(customAmount) || 0;
    return selected;
  }

  function isValid(): boolean {
    const amt = getAmount();
    return Number.isFinite(amt) && amt >= 1 && amt <= 1000;
  }

  function buttonLabel(): string {
    if (loading) return "Redirecting to checkout…";
    const amt = getAmount();
    if (!isValid()) return "Contribute";
    return `Contribute $${Number.isInteger(amt) ? amt : amt.toFixed(2)}`;
  }

  async function handleDonate() {
    if (!isValid()) {
      setError("Please enter an amount between $1 and $1,000.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/donate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: getAmount() }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#F8FAFC] border border-gray-200 rounded-xl p-6 space-y-5">

      {/* Amount selection */}
      <div>
        <p className="text-sm font-medium text-[#0F172A] mb-3">Choose an amount</p>
        <div className="flex flex-wrap gap-2">
          {PRESET_AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => { setSelected(a); setError(""); }}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 ${
                selected === a
                  ? "bg-[#CC0000] text-white border-[#CC0000]"
                  : "bg-white text-[#0F172A] border-gray-200 hover:border-gray-400"
              }`}
            >
              ${a}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setSelected("custom"); setError(""); }}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 ${
              selected === "custom"
                ? "bg-[#CC0000] text-white border-[#CC0000]"
                : "bg-white text-[#0F172A] border-gray-200 hover:border-gray-400"
            }`}
          >
            Other
          </button>
        </div>
      </div>

      {/* Custom amount input */}
      {selected === "custom" && (
        <div>
          <label htmlFor="custom-amount" className="block text-sm font-medium text-[#0F172A] mb-1.5">
            Enter your amount
          </label>
          <div className="relative max-w-xs">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#475569] text-sm font-medium select-none">
              $
            </span>
            <input
              id="custom-amount"
              type="number"
              min="1"
              max="1000"
              step="1"
              placeholder="0"
              value={customAmount}
              onChange={(e) => { setCustomAmount(e.target.value); setError(""); }}
              className="w-full pl-7 pr-4 py-2.5 text-sm text-[#0F172A] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent transition-colors"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
          <p className="mt-1.5 text-xs text-[#94a3b8]">Minimum $1 · Maximum $1,000</p>
        </div>
      )}

      {error && (
        <p className="text-sm text-[#CC0000]" role="alert">{error}</p>
      )}

      <button
        type="button"
        onClick={handleDonate}
        disabled={loading || !isValid()}
        className="w-full py-3 px-6 bg-[#CC0000] text-white text-sm font-semibold rounded-lg hover:bg-[#aa0000] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {buttonLabel()}
      </button>

      <p className="text-xs text-[#94a3b8] text-center">
        You&apos;ll be taken to Stripe&apos;s secure checkout. Contributions are not tax-deductible.
      </p>
    </div>
  );
}
