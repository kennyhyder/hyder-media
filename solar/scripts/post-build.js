#!/usr/bin/env node

/**
 * Post-build script for SolarTrack
 * 1. Injects sessionStorage auth check into all generated HTML pages
 * 2. Moves build output from out/ to parent directory (solar/)
 * Following the same pattern as AG2020 dashboard
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "out");
const ROOT_DIR = path.join(__dirname, "..");

const AUTH_SNIPPET = `<script>
(function() {
    const AUTH_KEY = 'solartrack_auth';
    if (sessionStorage.getItem(AUTH_KEY) !== 'authenticated') {
        window.location.href = '/solar/password.html';
    }
})();
</script>`;

// Step 1: Inject auth into all HTML files in out/
function injectAuth(filePath) {
  let html = fs.readFileSync(filePath, "utf-8");

  // Skip password.html itself
  if (filePath.endsWith("password.html")) return;

  // Inject auth check right after <head>
  if (html.includes("<head>") && !html.includes("solartrack_auth")) {
    html = html.replace("<head>", `<head>\n${AUTH_SNIPPET}`);
    fs.writeFileSync(filePath, html, "utf-8");
    console.log(`  Auth injected: ${path.relative(OUT_DIR, filePath)}`);
  }
}

function walkAndInject(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndInject(fullPath);
    } else if (entry.name.endsWith(".html")) {
      injectAuth(fullPath);
    }
  }
}

console.log("SolarTrack post-build: Injecting auth checks...");

if (!fs.existsSync(OUT_DIR)) {
  console.error("Error: out/ directory not found. Run `next build` first.");
  process.exit(1);
}

// Copy password.html from public/ to out/ before auth injection
const srcPassword = path.join(__dirname, "..", "public", "password.html");
const destPassword = path.join(OUT_DIR, "password.html");
if (fs.existsSync(srcPassword)) {
  fs.copyFileSync(srcPassword, destPassword);
  console.log("  Copied password.html to out/");
}

walkAndInject(OUT_DIR);

// Step 2: Move build output from out/ to parent directory
console.log("Moving build output to parent directory...");

const itemsToMove = fs.readdirSync(OUT_DIR);

for (const item of itemsToMove) {
  // Skip internal Next.js build metadata files
  if (item.startsWith("__next.")) continue;

  const srcPath = path.join(OUT_DIR, item);
  const destPath = path.join(ROOT_DIR, item);

  // Remove existing destination if it exists
  if (fs.existsSync(destPath)) {
    if (fs.statSync(destPath).isDirectory()) {
      fs.rmSync(destPath, { recursive: true });
    } else {
      fs.unlinkSync(destPath);
    }
  }

  // Move the item
  fs.renameSync(srcPath, destPath);
  console.log(`  Moved: ${item}`);
}

// Remove the empty out directory
fs.rmSync(OUT_DIR, { recursive: true, force: true });
console.log("Removed out/ directory");

console.log("Post-build complete!");
