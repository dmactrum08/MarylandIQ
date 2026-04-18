"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

declare global {
  interface Window {
    adsbygoogle: unknown[];
  }
}

export default function AdSlot() {
  const pathname = usePathname();
  const insRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    // Only push if the slot hasn't already been filled
    if (insRef.current && insRef.current.getAttribute("data-adsbygoogle-status") === null) {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {}
    }
  }, [pathname]);

  return (
    <div className="w-full my-4">
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client="ca-pub-3804213779492333"
        data-ad-slot="7275904724"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
