import { DocCardSkeleton } from '@/components/library/DocCard';

/** `/library` 渲染期间的即时骨架屏。 */
export default function LibraryLoading() {
  return (
    <div className="container py-6">
      <div className="shimmer h-8 w-40 rounded" />
      <div className="shimmer mt-4 h-11 w-full rounded-xl" />
      <div className="shimmer mt-5 h-9 w-full rounded" />
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <DocCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
