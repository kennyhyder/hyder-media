import { ImageResponse } from "next/og";

// Brand mark: the ◆ diamond on the cyan accent, dark-navy ground.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
            width: 18,
            height: 18,
            transform: "rotate(45deg)",
            borderRadius: 3,
            background: "#22D3EE",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
