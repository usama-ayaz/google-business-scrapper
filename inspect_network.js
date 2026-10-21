const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
  });

  const page = await browser.newPage();
  
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('google.com/maps/preview/place') || url.includes('google.com/maps/rpc') || url.includes('/maps/vt/data')) {
      console.log('Interesting RPC URL:', url.substring(0, 150));
      try {
        const text = await res.text();
        if (text.includes('nurskinclinic') || text.includes('8698766')) {
          console.log('>>> FOUND MATCH IN RPC URL:', url);
          require('fs').writeFileSync('rpc_match.txt', text);
        }
      } catch (_) {}
    }
  });

  const placeUrl = 'https://www.google.com/maps/place/NUR+SKIN+%26+AESTHETICS/data=!4m7!3m6!1s0x3919010aa7a5a967:0xc5833d998110d4f7!8m2!3d31.4543655!4d74.2754545!16s%2Fg%2F11shpr8jrs!19sChIJZ6mlpwoBGTkR99QQgZk9g8U?authuser=0&hl=en';
  await page.goto(placeUrl, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  await browser.close();
})();
