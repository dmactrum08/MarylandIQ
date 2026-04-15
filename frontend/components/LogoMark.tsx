interface LogoMarkProps {
  size?: number;
  /** Show the wordmark text next to the icon */
  showWordmark?: boolean;
  /** Wordmark text color for the "Maryland" part */
  wordmarkColor?: string;
  /** Used in dark contexts — flips wordmark to white */
  dark?: boolean;
}

export default function LogoMark({
  size = 34,
  showWordmark = true,
  dark = false,
}: LogoMarkProps) {
  const wordmarkTextColor = dark ? "text-white" : "text-[#0F172A]";

  return (
    <span className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 34 34"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="34" height="34" rx="7" fill="#CC0000" />
        {/* Ballot lines */}
        <rect x="9" y="9" width="16" height="2.5" rx="1.25" fill="white" />
        <rect x="9" y="14" width="12" height="2" rx="1" fill="white" opacity="0.85" />
        <rect x="9" y="19" width="9" height="2" rx="1" fill="white" opacity="0.65" />
        {/* Gold checkmark badge */}
        <circle cx="25" cy="24" r="6" fill="#F5A623" />
        <path
          d="M22.5 24l1.8 1.8 3-3.3"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {showWordmark && (
        <span
          className={`font-bold tracking-tight ${wordmarkTextColor}`}
          style={{ fontSize: size * 0.56 }}
        >
          Maryland<span className="text-[#CC0000]">IQ</span>
        </span>
      )}
    </span>
  );
}
