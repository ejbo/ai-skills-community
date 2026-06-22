import { SkillCardSkeleton } from '@/components/SkillCard';

/** Instant skeleton for `/` while the dynamic home (CommunityHome / Landing) renders. */
export default function HomeLoading() {
  return (
    <div>
      <section className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="container py-10 md:py-14">
          <div className="shimmer h-3 w-28 rounded" />
          <div className="shimmer mt-3 h-9 w-72 rounded" />
          <div className="shimmer mt-3 h-4 w-96 max-w-full rounded" />
          <div className="mt-5 flex gap-3">
            <div className="shimmer h-9 w-28 rounded-lg" />
            <div className="shimmer h-9 w-28 rounded-lg" />
          </div>
        </div>
      </section>
      <section className="container py-10 md:py-12">
        <div className="shimmer mb-5 h-7 w-40 rounded" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkillCardSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
