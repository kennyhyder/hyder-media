#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { existsSync, createReadStream, statSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'clients/falconlabs/falcon-labs-paid-channel-proposal.pdf');
const PASSWORD = 'FLPROPOSAL';
const SERVE_PORT = 47823;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/falcon-revised' || urlPath === '/falcon-revised/') {
        urlPath = '/clients/falconlabs/proposal-revised.html';
    } else if (urlPath.endsWith('/')) {
        urlPath += 'index.html';
    } else if (!path.extname(urlPath)) {
        urlPath += '.html';
    }
    const filePath = path.join(REPO_ROOT, urlPath);
    if (!filePath.startsWith(REPO_ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(SERVE_PORT, resolve));
const PROPOSAL_URL = `http://localhost:${SERVE_PORT}/falcon-revised`;
console.log(`Local server running at http://localhost:${SERVE_PORT}`);

const CHROME_CANDIDATES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

function findChrome() {
    for (const candidate of CHROME_CANDIDATES) {
        if (existsSync(candidate)) return candidate;
    }
    throw new Error('No Chrome/Chromium found. Install Chrome or set CHROME_PATH env var.');
}

const executablePath = process.env.CHROME_PATH || findChrome();
console.log(`Using browser: ${executablePath}`);

const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
});

const page = await browser.newPage();

console.log(`Loading: ${PROPOSAL_URL}`);
await page.goto(PROPOSAL_URL, { waitUntil: 'networkidle0', timeout: 60000 });

// Authenticate
console.log('Entering password...');
await page.waitForSelector('#authInput', { visible: true });
await page.type('#authInput', PASSWORD);
await page.click('button.auth-btn');

// Wait for proposal content to be visible
await page.waitForFunction(
    () => document.documentElement.classList.contains('authenticated'),
    { timeout: 5000 }
);

// Wait for fonts
await page.evaluateHandle('document.fonts.ready');

// Switch to print media so the light-theme @media print styles activate
await page.emulateMediaType('print');

// Small delay for any final font/image loading
await new Promise(r => setTimeout(r, 1500));

console.log('Generating PDF...');
await page.pdf({
    path: OUTPUT_PATH,
    format: 'Letter',
    printBackground: true,
    displayHeaderFooter: false,
    margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' },
    preferCSSPageSize: false
});

await browser.close();
server.close();
console.log(`PDF generated: ${OUTPUT_PATH}`);
