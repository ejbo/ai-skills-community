/** Instant skeleton for `/videos` while the feed renders. */
export default function VideosLoading() {
  return (
    <div className="container py-8">
      <div className="shimmer h-8 w-44 rounded" />
      <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2.5">
            <div className="shimmer aspect-video w-full rounded-xl" />
            <div className="flex gap-2.5">
              <div className="shimmer mt-0.5 h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="shimmer h-4 w-5/6 rounded" />
                <div className="shimmer h-3 w-1/2 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
