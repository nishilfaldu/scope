import { ImageResponse } from "next/og";
import { BrandSymbol } from "@/lib/brand-symbol";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Full bleed: iOS rounds the corners and fills transparency with black.
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#285C40",
      }}
    >
      <BrandSymbol size={104} />
    </div>,
    size,
  );
}
