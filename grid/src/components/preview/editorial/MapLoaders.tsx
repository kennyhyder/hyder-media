"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import ChoroplethMapComp from "./ChoroplethMap";
import SiteMiniMapComp from "./SiteMiniMap";

// ssr:false is only permitted in a Client Component in the App Router, so these
// thin loaders are the boundary the server pages import.

const Choropleth = dynamic(() => import("./ChoroplethMap"), {
  ssr: false,
  loading: () => <MapSkeleton height="520px" label="Rendering state choropleth…" />,
});

const Mini = dynamic(() => import("./SiteMiniMap"), {
  ssr: false,
  loading: () => <MapSkeleton height="340px" label="Loading map…" />,
});

function MapSkeleton({ height, label }: { height: string; label: string }) {
  return (
    <div
      style={{
        height,
        width: "100%",
        background:
          "repeating-linear-gradient(45deg,#F4F1EA,#F4F1EA 12px,#FBFAF7 12px,#FBFAF7 24px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#6B6B63",
        fontSize: "0.8125rem",
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </div>
  );
}

export function ChoroplethMap(props: ComponentProps<typeof ChoroplethMapComp>) {
  return <Choropleth {...props} />;
}

export function SiteMiniMap(props: ComponentProps<typeof SiteMiniMapComp>) {
  return <Mini {...props} />;
}
