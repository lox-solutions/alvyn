import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

// Image metadata
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

// Load local logo and convert to base64
const logoPath = join(process.cwd(), "public/logo.png");
const logoData = readFileSync(logoPath);
const logoBase64 = `data:image/png;base64,${logoData.toString("base64")}`;

// Image generation
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#000000",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "80px",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Soft subtle radial spotlight behind the content */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "800px",
            height: "800px",
            background: "radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)",
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />

        {/* Left Side: Brand Identity */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            width: "40%",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoBase64}
            width={140}
            height={140}
            style={{
              width: 140,
              height: 140,
              objectFit: "contain",
              marginBottom: "40px",
            }}
          />
          <div
            style={{
              fontSize: "64px",
              fontWeight: "bold",
              color: "#ffffff",
              letterSpacing: "-0.02em",
              marginBottom: "16px",
            }}
          >
            Alvyn
          </div>
          {/* Monochromatic pill badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid #27272a", // zinc-800
              backgroundColor: "rgba(24, 24, 27, 0.4)", // zinc-900/40
              padding: "8px 16px",
              borderRadius: "9999px",
              fontSize: "12px",
              fontWeight: "bold",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: "#a1a1aa", // zinc-400
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "#10b981", // emerald-500
                marginRight: "8px",
              }}
            />
            Event Sourcing
          </div>
        </div>

        {/* Right Side: Message & Moat */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: "55%",
            borderLeft: "1px solid #18181b", // zinc-900
            paddingLeft: "60px",
            height: "100%",
          }}
        >
          <div
            style={{
              fontSize: "60px",
              fontWeight: 900,
              color: "#ffffff",
              lineHeight: "1.15",
              letterSpacing: "-0.03em",
              marginBottom: "24px",
            }}
          >
            Your data tells the whole story.
          </div>
          <div
            style={{
              fontSize: "24px",
              color: "#a1a1aa", // zinc-400
              lineHeight: "1.5",
              fontWeight: "normal",
            }}
          >
            Capture every business intent as an immutable, append-only fact.
            Build an irreplaceable data moat for the agentic AI era.
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
