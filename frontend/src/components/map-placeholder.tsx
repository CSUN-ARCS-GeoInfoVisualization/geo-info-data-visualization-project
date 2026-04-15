/**
 * Empty map region when the Maps API is unavailable — no configuration or error copy.
 */
export function MapPlaceholder({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-muted/20 ${className}`}
      aria-hidden
    />
  );
}
