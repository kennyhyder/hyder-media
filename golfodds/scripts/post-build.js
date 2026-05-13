#!/usr/bin/env node

/**
 * Post-build script for GolfOdds
 * 1. Injects sessionStorage auth check into all generated HTML pages
 * 2. Moves build output from out/ to parent directory (golfodds/)
 * Mirrors the SolarTrack / AG2020 pattern.
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "out");
const ROOT_DIR = path.join(__dirname, "..");

const AUTH_SNIPPET = `<script>
(function() {
    const AUTH_KEY = 'golfodds_auth';
    if (sessionStorage.getItem(AUTH_KEY) !== 'authenticated') {
        window.location.href = '/golfodds/password.html';
    }
})();
</script>`;

function injectAuth(filePath) {
  if (filePath.endsWith("password.html")) return;
  let html = fs.readFileSync(filePath, "utf-8");
  if (html.includes("<head>") && !html.includes("golfodds_auth")) {
    html = html.replace("<head>", `<head>\n${AUTH_SNIPPET}`);
    fs.writeFileSync(filePath, html, "utf-8");
    console.log(`  Auth injected: ${path.relative(OUT_DIR, filePath)}`);
  }
}

function walkAndInject(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAndInject(fullPath);
    else if (entry.name.endsWith(".html")) injectAuth(fullPath);
  }
}

console.log("GolfOdds post-build: Injecting auth checks...");

if (!fs.existsSync(OUT_DIR)) {
  console.error("Error: out/ directory not found. Run `next build` first.");
  process.exit(1);
}

const srcPassword = path.join(__dirname, "..", "public", "password.html");
const destPassword = path.join(OUT_DIR, "password.html");
if (fs.existsSync(srcPassword)) {
  fs.copyFileSync(srcPassword, destPassword);
  console.log("  Copied password.html to out/");
}

walkAndInject(OUT_DIR);

console.log("Moving build output to parent directory...");
for (const item of fs.readdirSync(OUT_DIR)) {
  if (item.startsWith("__next.")) continue;
  const srcPath = path.join(OUT_DIR, item);
  const destPath = path.join(ROOT_DIR, item);
  if (fs.existsSync(destPath)) {
    if (fs.statSync(destPath).isDirectory()) fs.rmSync(destPath, { recursive: true });
    else fs.unlinkSync(destPath);
  }
  fs.renameSync(srcPath, destPath);
  console.log(`  Moved: ${item}`);
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
console.log("Post-build complete!");
