// The Scope keyhole symbol from public/brand/scope-mark.svg, for generated images.
export function BrandSymbol({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="260 260 504 504">
      <g
        fill="none"
        stroke="#F7F9F7"
        strokeWidth="64"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M418 292H316c-13 0-24 11-24 24v102" />
        <path d="M606 292h102c13 0 24 11 24 24v102" />
        <path d="M732 606v102c0 13-11 24-24 24H606" />
        <path d="M418 732H316c-13 0-24-11-24-24V606" />
      </g>
      <circle cx="512" cy="456" r="78" fill="#F7F9F7" />
      <path
        d="M480 500h64l39 133c6 21-10 42-32 42h-78c-22 0-38-21-32-42l39-133Z"
        fill="#F7F9F7"
      />
    </svg>
  );
}
