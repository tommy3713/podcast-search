export function MetadataSkeleton() {
  return (
    <div className="mb-6 animate-pulse">
      <div className="h-3 w-32 bg-gray-200 rounded mb-2" />
      <div className="h-6 w-3/4 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-24 bg-gray-200 rounded" />
    </div>
  );
}

export function TranscriptSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className={`h-4 bg-gray-200 rounded ${i % 5 === 4 ? 'w-3/5' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-full" />
      <div className="h-4 bg-gray-200 rounded w-5/6" />
      <div className="h-4 bg-gray-200 rounded w-full" />
      <div className="h-4 bg-gray-200 rounded w-4/6" />
      <div className="h-4 bg-gray-200 rounded w-full" />
      <div className="h-4 bg-gray-200 rounded w-5/6" />
      <div className="h-4 bg-gray-200 rounded w-3/6" />
    </div>
  );
}
