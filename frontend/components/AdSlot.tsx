"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
}

export default function AdSlot() {
  useEffect(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {}
  }, []);

  return (
    <div className="w-full my-4 relative min-h-[100px]">
      {/* Placeholder shown until AdSense fills the slot */}
      <div className="absolute inset-0 bg-[#F8FAFC] border border-dashed border-gray-200 rounded-lg flex items-center justify-center">
        <p className="text-xs text-[#94a3b8]">Advertisement</p>
      </div>
      <ins
        className="adsbygoogle relative z-10"
        style={{ display: "block", minHeight: "100px" }}
        data-ad-client="ca-pub-3804213779492333"
        data-ad-slot="7275904724"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
