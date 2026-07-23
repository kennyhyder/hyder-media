const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
    const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: 'new',
    });
    const page = await browser.newPage();
    const filePath = path.resolve(__dirname, 'kenny-hyder-expert-cv.html');
    await page.goto('file://' + filePath, { waitUntil: 'networkidle0' });
    await page.pdf({
        path: path.resolve(__dirname, 'kenny-hyder-expert-cv.pdf'),
        format: 'Letter',
        displayHeaderFooter: false,
        printBackground: true,
        margin: {
            top: '0.75in',
            right: '0.85in',
            bottom: '0.75in',
            left: '0.85in',
        },
    });
    await browser.close();
    console.log('PDF generated successfully.');
})();
