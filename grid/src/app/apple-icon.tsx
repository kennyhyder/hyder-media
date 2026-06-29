import { ImageResponse } from "next/og";

// Apple touch icon: ◆ brand mark on the accent, dark-navy ground.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0E1A",
        }}
      >
        <div
          style={{
            width: 104,
            height: 104,
            transform: "rotate(45deg)",
            borderRadius: 18,
            background: "#22D3EE",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
