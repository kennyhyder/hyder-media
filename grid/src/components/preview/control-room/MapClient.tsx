"use client";

import dynamic from "next/dynamic";
import { CR } from "./theme";
import type { StateDatum } from "./ChoroplethMap";
import type { MapPoint } from "./SiteMiniMap";

function Skeleton({ height }: { height: string }) {
  return (
    <div
      style={{
        height,
        width: "100%",
        borderRadius: 12,
        border: `1px solid ${CR.border}`,
        background:
          "linear-gradient(180deg, #0F1422, #0A0E1A)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: CR.muted,
        fontSize: 12,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      Loading map…
    </div>
  );
}

const Choropleth = dynamic(() => import("./ChoroplethMap"), {
  ssr: false,
  loading: () => <Skeleton height="560px" />,
});

const MiniMap = dynamic(() => import("./SiteMiniMap"), {
  ssr: false,
  loading: () => <Skeleton height="340px" />,
});

export function ChoroplethClient({
  states,
  height,
}: {
  states: Record<string, StateDatum>;
  height?: string;
}) {
  return <Choropleth states={states} height={height} />;
}

export function MiniMapClient({
  points,
  height,
}: {
  points: MapPoint[];
  height?: string;
}) {
  return <MiniMap points={points} height={height} />;
}
