const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
    });
    const page = await browser.newPage();
    const filePath = path.resolve(__dirname, 'expert-rebuttal-report-v2.html');
    await page.goto('file://' + filePath, { waitUntil: 'networkidle0' });
    await page.pdf({
        path: path.resolve(__dirname, 'expert-rebuttal-report-v2.pdf'),
        format: 'Letter',
        displayHeaderFooter: false,
        printBackground: true,
        margin: {
            top: '1in',
            right: '1in',
            bottom: '1in',
            left: '1in',
        },
    });
    await browser.close();
    console.log('Rebuttal V2 PDF generated successfully.');
})();
