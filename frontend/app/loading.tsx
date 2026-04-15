// loading.tsx — shown while a Server Component is streaming.
// Primarily used by the /ballot runtime page (the only non-static route).

export default function Loading() {
  return (
    <main className="flex-1 px-4 py-16" aria-label="Loading" aria-busy="true">
      <div className="max-w-3xl mx-auto">

        {/* Page title skeleton */}
        <div className="mb-8">
          <div className="h-4 w-32 bg-gray-200 rounded animate-pulse mb-3" />
          <div className="h-8 w-72 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-56 bg-gray-100 rounded animate-pulse" />
        </div>

        {/* Race card skeletons */}
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="mb-4 p-5 border border-gray-200 rounded-xl bg-white"
            aria-hidden="true"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="h-4 w-48 bg-gray-200 rounded animate-pulse mb-2" />
                <div className="h-3 w-32 bg-gray-100 rounded animate-pulse mb-4" />
                <div className="flex gap-2">
                  <div className="h-7 w-24 bg-gray-100 rounded-full animate-pulse" />
                  <div className="h-7 w-24 bg-gray-100 rounded-full animate-pulse" />
                </div>
              </div>
              <div className="h-9 w-28 bg-gray-200 rounded-lg animate-pulse shrink-0" />
            </div>
          </div>
        ))}

        {/* Screen reader announcement */}
        <p className="sr-only">Loading your ballot results. Please wait.</p>
      </div>
    </main>
  );
}
