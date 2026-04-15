"use client";

import { useState } from "react";

const AMOUNTS = [5, 10, 25, 50, 100];

export default function DonateForm() {
  const [selected, setSelected] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDonate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/donate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: selected }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError("Something went wrong. Please try again.");
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
      <div>
        <p className="text-sm font-medium text-[#0F172A] mb-3">Choose an amount</p>
        <div className="flex flex-wrap gap-2">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setSelected(a)}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 ${
                selected === a
                  ? "bg-[#CC0000] text-white border-[#CC0000]"
                  : "bg-white text-[#0F172A] border-gray-200 hover:border-gray-400"
              }`}
            >
              ${a}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-[#CC0000]" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleDonate}
        disabled={loading}
        className="w-full py-3 px-6 bg-[#CC0000] text-white text-sm font-semibold rounded-lg hover:bg-[#aa0000] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? "Redirecting to checkout…" : `Contribute $${selected}`}
      </button>

      <p className="text-xs text-[#94a3b8] text-center">
        You'll be taken to Stripe's secure checkout. Contributions are not tax-deductible.
      </p>
    </div>
  );
}
