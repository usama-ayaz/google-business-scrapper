const puppeteer = require('puppeteer-core');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function clean(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scrapes all available records from Google Maps for a query
 * Scrolls until the actual end of the list is reached.
 */
async function scrapeGoogleMaps(query, options = {}) {
  const {
    maxResults = 500, // High ceiling to capture all available results
    country = '',
    city = '',
    niche = '',
    browserInstance = null,
    onProgress = null
  } = options;

  let browser = browserInstance;
  let shouldCloseBrowser = false;

  if (!browser) {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--lang=en-US'
      ]
    });
    shouldCloseBrowser = true;
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  try {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
    if (onProgress) onProgress(`[Navigating] ${query}`);

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 35000 });

    // Handle Google consent if prompted
    try {
      const consentBtn = await page.$('button[aria-label="Accept all"], form[action*="consent"] button');
      if (consentBtn) {
        await consentBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 6000 }).catch(() => {});
      }
    } catch (_) {}

    // Wait for feed container
    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
    } catch (_) {
      if (onProgress) onProgress(`[Notice] No feed found for "${query}"`);
      return [];
    }

    // Scroll until END of list or no new items
    let prevItemCount = 0;
    let sameCountAttempts = 0;
    const maxScrollAttempts = 35; // Allows loading up to 120+ items (Google's max per query)

    for (let s = 0; s < maxScrollAttempts; s++) {
      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollTop = feed.scrollHeight;
      });
      await sleep(1000);

      const status = await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        const count = feed ? feed.querySelectorAll('div[role="article"], a.hfpxzc').length : 0;
        const reachedEnd = document.body.innerText.includes("You've reached the end of the list") || 
                           !!document.querySelector('.HlvSq');
        return { count, reachedEnd };
      });

      if (status.reachedEnd) {
        if (onProgress) onProgress(`[End Reached] Total ${status.count} listings loaded.`);
        break;
      }

      if (status.count === prevItemCount) {
        sameCountAttempts++;
        if (sameCountAttempts >= 3) {
          if (onProgress) onProgress(`[Feed Exhausted] No new items after 3 attempts (${status.count} listings).`);
          break;
        }
      } else {
        sameCountAttempts = 0;
      }

      prevItemCount = status.count;
    }

    // Extract all loaded items from DOM
    const items = await page.evaluate((targetLimit) => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return [];

      const cards = Array.from(feed.querySelectorAll('div[role="article"], div[jsaction*="mouseover"]'));
      const parsed = [];
      const seen = new Set();

      for (const card of cards) {
        if (parsed.length >= targetLimit) break;

        const link = card.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
        const name = (link?.getAttribute('aria-label') || card.querySelector('.qBF1Pd')?.innerText || '').trim();

        if (!name || seen.has(name) || name.length < 2 || name === 'Results') continue;
        seen.add(name);

        const mapsUrl = link ? link.href : '';

        // Rating
        const ratingEl = card.querySelector('.MW4etd, span[aria-label*="stars"]');
        let rating = '';
        if (ratingEl) {
          const rText = ratingEl.innerText || ratingEl.getAttribute('aria-label') || '';
          const m = rText.match(/(\d+\.\d+|\d+)/);
          if (m) rating = m[1];
        }

        // Reviews Count
        const revEl = card.querySelector('.UY7F9, span[aria-label*="reviews"]');
        let reviews = '';
        if (revEl) {
          const m = (revEl.innerText || revEl.getAttribute('aria-label') || '').replace(/,/g, '').match(/(\d+)/);
          if (m) reviews = m[1];
        } else {
          const m = card.innerText.match(/\((\d+(?:,\d+)?)\)/);
          if (m) reviews = m[1].replace(/,/g, '');
        }

        // Website Link
        const webEl = card.querySelector('a[data-value="Website"], a[aria-label*="website" i], a[href*="http"]:not([href*="google.com"]):not([href*="gstatic.com"])');
        let website = webEl ? webEl.href : '';
        if (website.includes('google.com/url?q=')) {
          const m = website.match(/url\?q=([^&]+)/);
          if (m) website = decodeURIComponent(m[1]);
        }

        // Parse lines for category, address, phone
        const lines = Array.from(card.querySelectorAll('.W4Efsd')).map(l => l.innerText.trim()).filter(Boolean);
        let category = '';
        let address = '';
        let phone = '';

        lines.forEach(line => {
          const parts = line.split('·').map(p => p.trim()).filter(Boolean);
          parts.forEach(p => {
            if (/(?:\+?\d{1,4}[ -]?)?\(?\d{2,5}\)?[ -]?\d{3,5}[ -]?\d{3,5}/.test(p) && p.replace(/\D/g, '').length >= 7) {
              if (!phone) phone = p;
            } else if (/clinic|dentist|dental|skin|aesthetic|doctor|hospital|care|cosmetic|centre|center|spa/i.test(p) && !category) {
              category = p;
            } else if (p.length > 3 && !address
              && !/open|closed|opens|closes|mins|km|miles|wheelchair/i.test(p)
              && !/^\d+(\.\d+)?$/.test(p)
              && !/\d{1,2}(:\d{2})?\s*(AM|PM)/i.test(p)           // closing times like "10:30 PM"
              && !/^\d+(\.\d+)?\(\d+\)$/.test(p)                 // rating fragments like "4.8(12)"
              && p !== category) {
              address = p;
            }
          });
        });

        if (!phone) {
          const phMatch = card.innerText.match(/(?:\+?\d{1,4}[ -]?)?\(?\d{2,5}\)?[ -]?\d{3,5}[ -]?\d{3,5}/);
          if (phMatch && phMatch[0].replace(/\D/g, '').length >= 7) {
            phone = phMatch[0].trim();
          }
        }

        parsed.push({
          name,
          category: category || 'Clinic',
          rating,
          reviews,
          phone,
          address,
          website,
          mapsUrl
        });
      }

      return parsed;
    }, maxResults);

    if (onProgress) onProgress(`[Parsed] Extracted ${items.length} clinics from "${query}"`);

    // Format final records
    const finalResults = items.map(item => ({
      name: clean(item.name),
      niche: niche || (query.toLowerCase().includes('dental') ? 'Dental Clinic' : 'Aesthetic Clinic'),
      category: clean(item.category) || (niche || 'Clinic'),
      rating: item.rating ? parseFloat(item.rating) || item.rating : '',
      reviewsCount: item.reviews ? parseInt(item.reviews, 10) || item.reviews : '',
      phone: clean(item.phone),
      website: clean(item.website),
      address: clean(item.address),
      city: city || '',
      country: country || '',
      mapsUrl: item.mapsUrl || '',
      plusCode: item.plusCode || '',
      status: item.status || 'Active'
    }));

    return finalResults;
  } catch (error) {
    if (onProgress) onProgress(`[Error] Failed scraping "${query}": ${error.message}`);
    return [];
  } finally {
    await page.close().catch(() => {});
    if (shouldCloseBrowser && browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  scrapeGoogleMaps,
  CHROME_PATH
};
