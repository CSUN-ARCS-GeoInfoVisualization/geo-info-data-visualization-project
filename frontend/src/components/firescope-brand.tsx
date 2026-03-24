/** FireScope wordmark. Bundled from `src/assets` so dev/prod always resolve the file and picks up updates after rebuild. */
import logoSrc from "../assets/firescope-logo.png";

type BrandMarkProps = {
  /** Visual height in pixels; width scales with aspect ratio */
  height?: number;
  className?: string;
  /** Dark backing for transparent logos on light UI surfaces */
  variant?: "onLight" | "plain";
};

export function FireScopeBrandMark({
  height = 40,
  className = "",
  variant = "plain",
}: BrandMarkProps) {
  const img = (
    <img
      src={logoSrc}
      alt="FireScope — flame in a scope crosshair with wordmark"
      width={undefined}
      height={height}
      className={`w-auto max-w-[min(100%,280px)] object-contain object-left transition-none ${className}`}
      style={{ height }}
      decoding="async"
    />
  );

  if (variant === "plain") {
    return img;
  }

  return (
    <span className="inline-flex items-center rounded-md bg-zinc-950 px-2 py-1 ring-1 ring-zinc-800/90 shadow-sm transition-none">
      {img}
    </span>
  );
}
