export function VideoCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="shimmer aspect-video w-full rounded-xl" />
      <div className="flex gap-2.5">
        <div className="shimmer mt-0.5 h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="shimmer h-3.5 w-5/6 rounded" />
          <div className="shimmer h-3 w-1/2 rounded" />
          <div className="shimmer h-3 w-2/3 rounded" />
        </div>
      </div>
    </div>
  );
}
