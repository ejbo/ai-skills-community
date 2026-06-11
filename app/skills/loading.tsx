import { SkillCardSkeleton } from '@/components/SkillCard';

/** Instant skeleton for `/skills` while the browse page renders. */
export default function SkillsLoading() {
  return (
    <div className="container py-8">
      <div className="shimmer h-8 w-48 rounded" />
      <div className="shimmer mt-4 h-10 w-full max-w-xl rounded-lg" />
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <SkillCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
