// TrustLabel — small colored badge applied to every data section on candidate,
// race, and measure pages. Four variants matching the PRD trust label system.
//
// Usage:
//   <TrustLabel variant="official" />
//   <TrustLabel variant="candidate" />
//   <TrustLabel variant="inferred" />
//   <TrustLabel variant="machine" />
//   <TrustLabel variant="official" showIcon={false} />

export type TrustVariant = "official" | "candidate" | "inferred" | "machine";

interface TrustLabelProps {
  variant: TrustVariant;
  /** Override the default label text */
  label?: string;
  /** Show the leading dot icon (default true) */
  showIcon?: boolean;
  className?: string;
}

const VARIANTS: Record<
  TrustVariant,
  { label: string; bg: string; text: string; dot: string; description: string }
> = {
  official: {
    label: "Official source",
    bg: "bg-blue-50",
    text: "text-blue-800",
    dot: "bg-blue-500",
    description:
      "Sourced directly from the Maryland State Board of Elections, a county board of elections, or an official government GIS layer.",
  },
  candidate: {
    label: "From the candidate",
    bg: "bg-green-50",
    text: "text-green-800",
    dot: "bg-green-500",
    description:
      "Sourced from a campaign website or social media profile directly managed by the candidate.",
  },
  inferred: {
    label: "From public social media",
    bg: "bg-amber-50",
    text: "text-amber-800",
    dot: "bg-amber-500",
    description:
      "Drawn from publicly visible social media profiles. Linked to the original source so you can verify it.",
  },
  machine: {
    label: "Sourced summary",
    bg: "bg-slate-100",
    text: "text-slate-700",
    dot: "bg-slate-400",
    description:
      "A summary compiled from publicly available source material. Always linked to the evidence it came from.",
  },
};

export default function TrustLabel({
  variant,
  label,
  showIcon = true,
  className = "",
}: TrustLabelProps) {
  const v = VARIANTS[variant];
  const displayLabel = label ?? v.label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${v.bg} ${v.text} ${className}`}
      title={v.description}
      aria-label={`Data label: ${displayLabel}. ${v.description}`}
    >
      {showIcon && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${v.dot}`}
          aria-hidden="true"
        />
      )}
      {displayLabel}
    </span>
  );
}
