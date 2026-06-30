// Side-effect-only dynamic import: `await import("leaflet.markercluster")`.
// Runtime attaches markerClusterGroup onto the global L (accessed via window.L),
// so no typed bindings are needed here — just satisfy moduleResolution.
declare module "leaflet.markercluster" {}
