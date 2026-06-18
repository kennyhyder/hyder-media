#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROPOSAL_PATH = path.join(REPO_ROOT, 'clients/falconlabs/proposal.html');
const OUTPUT_PATH = path.join(REPO_ROOT, 'clients/falconlabs/falcon-labs-proposal.pdf');
const PASSWORD = 'FLPROPOSAL';

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

const fileUrl = `file://${PROPOSAL_PATH}`;
console.log(`Loading: ${fileUrl}`);
await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 60000 });

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

const footerTemplate = `
    <div style="
        width: 100%;
        font-size: 8px;
        color: #94a3b8;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        padding: 0 0.5in;
        display: flex;
        justify-content: space-between;
        align-items: center;
    ">
        <span style="color: #475569;">Hyder Media &times; Falcon Labs</span>
        <span style="color: #94a3b8;">Multi-Channel Growth Partnership Proposal</span>
        <span style="color: #94a3b8;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
`;

console.log('Generating PDF...');
await page.pdf({
    path: OUTPUT_PATH,
    format: 'Letter',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate,
    margin: { top: '0.5in', bottom: '0.65in', left: '0.5in', right: '0.5in' },
    preferCSSPageSize: false
});

await browser.close();
console.log(`PDF generated: ${OUTPUT_PATH}`);
