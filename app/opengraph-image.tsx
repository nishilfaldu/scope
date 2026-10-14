import { ImageResponse } from "next/og";
import { BrandSymbol } from "@/lib/brand-symbol";

export const alt =
  "Scope: connect once and decide what each AI app can do. One MCP server for Cursor, Claude and ChatGPT.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#F7F9F7",
        color: "#1D3025",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 72,
            height: 72,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 20,
            background: "#285C40",
          }}
        >
          <BrandSymbol size={42} />
        </div>
        <span style={{ fontSize: 40, letterSpacing: -1 }}>Scope</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <span
          style={{
            fontSize: 76,
            lineHeight: 1.04,
            letterSpacing: -3,
            maxWidth: 960,
          }}
        >
          Connect once. Decide what each AI app can do.
        </span>
        <span style={{ fontSize: 30, color: "#647168" }}>
          One MCP server for Cursor, Claude, ChatGPT and your other AI apps.
        </span>
      </div>
      <span style={{ fontSize: 26, color: "#285C40" }}>
        scope.nishilfaldu.site
      </span>
    </div>,
    size,
  );
}
