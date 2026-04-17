// PageHeader — shared page title block used on all interior pages.
// Dark navy background matching the homepage hero, white text.
//
// Usage:
//   <PageHeader
//     title="Browse by county"
//     subtitle="Select a county to see all candidates and races."
//     breadcrumbs={[{ label: "Home", href: "/" }]}
//   />

interface Breadcrumb {
  label: string;
  href: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  badge?: string;
}

export default function PageHeader({
  title,
  subtitle,
  breadcrumbs = [],
  badge,
}: PageHeaderProps) {
  return (
    <div className="bg-[#0F172A]">
      <div className="max-w-7xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Breadcrumb */}
        {breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex items-center gap-2 text-sm text-slate-400">
              {breadcrumbs.map(({ label, href }, i) => (
                <li key={href} className="flex items-center gap-2">
                  {i > 0 && (
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  )}
                  <a
                    href={href}
                    className="hover:text-white transition-colors duration-150 focus:outline-none focus:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
              {/* Current page — not a link */}
              <li className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                <span className="text-slate-200 font-medium" aria-current="page">
                  {title}
                </span>
              </li>
            </ol>
          </nav>
        )}

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
          <div className="text-center sm:text-left">
            <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
            {subtitle && (
              <p className="text-slate-300 max-w-xl mx-auto sm:mx-0">{subtitle}</p>
            )}
          </div>
          {badge && (
            <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full bg-[#F5A623]/10 text-[#F5A623] border border-[#F5A623]/40 mx-auto sm:mx-0 sm:mt-1">
              {badge}
            </span>
          )}
        </div>

      </div>
    </div>
  );
}
