import type { VideoCard as VideoCardType } from '@/lib/video/queries';
import { VideoCard } from './VideoCard';

export function RelatedVideos({ videos }: { videos: VideoCardType[] }) {
  if (videos.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-1">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  );
}
