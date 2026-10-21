 
 
 
 const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXPORTS_DIR = path.resolve(__dirname, 'exports');
const EXCEL_DIR = path.join(EXPORTS_DIR, 'excel');
const CSV_DIR = path.join(EXPORTS_DIR, 'csv');
const DATA_JSON = path.join(EXPORTS_DIR, 'clinics_data.json');
const FAILED_JSON = path.resolve(__dirname, 'enrich_failed.json');

const SKIP_EMAIL_DOMAINS = ['sentry.io', 'wixpress.com', 'example.com', 'w3.org', 'schema.org', 'email.com', 'yourdomain', 'domain.com', 'email@', 'info@example', 'sentry', 'godaddy', 'squarespace-cdn', 'shopify'];
const GENERIC_CATEGORIES = new Set(['clinic', 'clinics', 'medical clinic', 'health']);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- CLI args ----------
const args = process.argv.slice(2);
function argVal(flag, def) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}
const LIMIT = parseInt(argVal('--limit', '0'), 10) || 0;
const ONLY_COUNTRY = argVal('--country', '');
const CONCURRENCY = parseInt(argVal('--concurrency', '6'), 10) || 6;

// ---------- Field extraction from /maps/preview/place RPC (data[6]) ----------
function deepFindString(node, test, depth = 0) {
  if (depth > 8 || node == null) return '';
  if (typeof node === 'string') return test(node) ? node : '';
  if (Array.isArray(node)) {
    for (const v of node) { const r = deepFindString(v, test, depth + 1); if (r) return r; }
  }
  return '';
}

function extractFromPlace(p) {
  if (!Array.isArray(p)) return null;
  const out = {};

  // Name sanity
  if (typeof p[11] === 'string') out.name = p[11];

  // Rating
  const rating = p[4]?.[7];
  if (typeof rating === 'number' && rating > 0 && rating <= 5) out.rating = rating;

  // Review count (p[37][1] observed; fall back to p[4][8])
  const rc = p[37]?.[1] ?? p[4]?.[8];
  if (typeof rc === 'number' && rc >= 0) out.reviewsCount = rc;

  // Website
  const web = p[7]?.[0];
  if (typeof web === 'string' && web.startsWith('http')) out.website = web;

  // Phone: p[178][0][0] is the international formatted number
  const ph = p[178]?.[0]?.[0];
  if (typeof ph === 'string' && ph.replace(/\D/g, '').length >= 7) out.phone = ph;

  // Address: p[39] is full address w/o name; p[18] includes "Name, addr"; p[2] parts
  if (typeof p[39] === 'string' && p[39].length > 5) {
    out.address = p[39];
  } else if (typeof p[18] === 'string' && p[18].length > 5) {
    const namePrefix = out.name ? out.name + ', ' : '';
    out.address = p[18].startsWith(namePrefix) ? p[18].slice(namePrefix.length) : p[18];
  } else if (Array.isArray(p[2]) && p[2].length) {
    out.address = p[2].filter(s => typeof s === 'string').join(', ');
  }

  // Categories
  if (Array.isArray(p[13]) && p[13].length) out.categories = p[13].filter(s => typeof s === 'string');

  // Operating status: p[203][1] contains ["Closes soon · 10:30 PM · Opens 12 PM Tue", ...] and ["Open"]
  const statusArr = p[203]?.[1];
  if (Array.isArray(statusArr)) {
    const simple = statusArr[8]?.[0];
    const desc = statusArr.find(s => typeof s === 'string' && /·|open|clos/i.test(s));
    out.status = (typeof desc === 'string' ? desc : (typeof simple === 'string' ? simple : ''));
  }

  // Plus code: somewhere under p[183], e.g. "F73G+P5 Lahore, Pakistan" or global "8J3PF73G+P5"
  const pc = deepFindString(p[183], s => /[A-Z0-9]{4}\+[A-Z0-9]{2,3}/.test(s) && s.length < 40);
  if (pc) {
    const m = pc.match(/[A-Z0-9]{4}\+[A-Z0-9]{2,3}/);
    if (m) out.plusCode = pc.includes(' ') ? pc : m[0];
  }

  return out;
}

// ---------- DOM fallback when RPC is not captured ----------
async function extractFromDOM(page) {
  try {
    return await page.evaluate(() => {
      const out = {};
      const phoneBtn = document.querySelector('button[data-item-id^="phone:"], button[data-item-id^="phone"]');
      if (phoneBtn) out.phone = (phoneBtn.getAttribute('aria-label') || '').replace(/^Phone:\s*/i, '').trim();
      const addrBtn = document.querySelector('button[data-item-id="address"]');
      if (addrBtn) out.address = (addrBtn.getAttribute('aria-label') || '').replace(/^Address:\s*/i, '').trim();
      const webA = document.querySelector('a[data-item-id="authority"]');
      if (webA) out.website = webA.href;
      const ratingEl = document.querySelector('.F7nice span[aria-label*="star"], span[role="img"][aria-label*="star"]');
      if (ratingEl) {
        const m = (ratingEl.getAttribute('aria-label') || '').match(/(\d+(?:\.\d+)?)/);
        if (m) out.rating = parseFloat(m[1]);
      }
      const revEl = document.querySelector('.F7nice span[aria-label*="review"], button[aria-label*="review" i], span[aria-label*="reviews"]');
      if (revEl) {
        const m = (revEl.getAttribute('aria-label') || '').replace(/,/g, '').match(/(\d+)/);
        if (m) out.reviewsCount = parseInt(m[1], 10);
      }
      const catBtn = document.querySelector('button[jsaction*="category"], .DkEaL');
      if (catBtn) out.categories = [catBtn.innerText.trim()];
      return out;
    });
  } catch (_) { return {}; }
}

// ---------- Enrich one mapsUrl in a page ----------
function enrichViaRPC(page, mapsUrl) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); page.off('response', onResp); resolve(v); } };

    // Give the place RPC the full window to fire; DOM scrape is the last resort.
    const timer = setTimeout(() => {
      extractFromDOM(page).then(dom => finish(Object.keys(dom).length ? { dom } : null));
    }, 16000);

    const onResp = async (response) => {
      if (done) return;
      const url = response.url();
      if (!(url.includes('/maps/preview/place') || url.includes('/maps/rpc') || url.includes('SingleImageSearch'))) return;
      try {
        const text = await response.text();
        if (text.length < 800) return;
        const cleaned = text.replace(/^\)\]\}'\s*/, '');
        const data = JSON.parse(cleaned);
        const p = data?.[6];
        const ext = p && extractFromPlace(p);
        if (ext && (ext.name || ext.phone || ext.address)) finish(ext);
      } catch (_) {}
    };
    page.on('response', onResp);

    page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 25000 })
      .catch(() => {
        // Navigation failed — still try the DOM once before giving up
        sleep(2500).then(() => extractFromDOM(page)).then(dom => finish(Object.keys(dom).length ? { dom } : null));
      });
  });
}

function isBadAddress(addr) {
  if (!addr) return true;
  if (addr.length < 15) return true;
  if (/\d{1,2}(:\d{2})?\s*(AM|PM)/i.test(addr)) return true;
  if (/^\d+(\.\d+)?\(\d+\)$/.test(addr)) return true;                    // "4.8(12)"
  if (/clinic|dentist|dental|dermatologist|orthodontist|spa|doctor|hospital|centre|center/i.test(addr) && !/\d|road|rd\.|street|st\.|block|phase|town|city|avenue|ave\.|lane|plaza|floor|suite|ste\.|boulevard|blvd/i.test(addr)) return true; // category not address
  if (/^\+?[\d\s()-]{7,18}$/.test(addr)) return true;                    // phone stored as address
  return false;
}

function applyEnrichment(rec, ext) {
  if (!ext) return false;
  let changed = false;
  const set = (key, val, overwrite = false) => {
    if (val == null || val === '') return;
    if (overwrite || !rec[key]) { rec[key] = val; changed = true; }
  };
  set('phone', ext.phone);
  set('website', ext.website);
  set('rating', ext.rating);
  set('reviewsCount', ext.reviewsCount);
  set('plusCode', ext.plusCode);
  if (ext.status) set('status', ext.status, rec.status === 'Active' || !rec.status);
  if (ext.address && (isBadAddress(rec.address) || rec.address !== ext.address)) {
    rec.address = ext.address; changed = true;
  }
  if (ext.categories && ext.categories.length) {
    const cur = (rec.category || '').toLowerCase();
    if (!rec.category || GENERIC_CATEGORIES.has(cur)) {
      // prefer a category matching the niche keywords
      const nicheWords = (rec.niche || '').toLowerCase().includes('dental') ? ['dental', 'dentist', 'orthodont'] : ['aesthetic', 'skin', 'cosmetic', 'beauty', 'spa', 'dermatolog', 'hair'];
      rec.category = ext.categories.find(c => nicheWords.some(w => c.toLowerCase().includes(w))) || ext.categories[0];
      changed = true;
    }
  }
  return changed;
}

// ---------- Email extraction ----------
async function extractEmailFromWebsite(url) {
  if (!url || !url.startsWith('http')) return '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow'
    });
    clearTimeout(timer);
    const html = await res.text();
    const mailto = Array.from(html.matchAll(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,8})/gi)).map(m => m[1]);
    const raw = (html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,8}/g) || []);
    const all = [...new Set([...mailto, ...raw])].filter(e => {
      const lower = e.toLowerCase();
      if (/\.(png|jpg|jpeg|gif|webp|svg|css|js|woff|woff2|mp4|ico)$/i.test(e)) return false;
      return !SKIP_EMAIL_DOMAINS.some(s => lower.includes(s));
    });
    return all[0] || '';
  } catch (_) { return ''; }
}

// ---------- Export ----------
function recordToRow(item) {
  return {
    'Clinic Name': item.name || '',
    'Target Niche': item.niche || '',
    'Category / Specialty': item.category || '',
    'Rating (Stars)': item.rating !== '' ? Number(item.rating) || item.rating : '',
    'Review Count': item.reviewsCount !== '' ? Number(item.reviewsCount) || item.reviewsCount : '',
    'Phone Number': item.phone || '',
    'Email Address': item.email || '',
    'Website URL': item.website || '',
    'Full Address': item.address || '',
    'City': item.city || '',
    'Country': item.country || '',
    'Plus Code / Location ID': item.plusCode || '',
    'Operating Status': item.status || '',
    'Google Maps Link': item.mapsUrl || ''
  };
}

function createSheet(data) {
  const ws = XLSX.utils.json_to_sheet(data.map(recordToRow));
  ws['!cols'] = [35, 20, 25, 15, 15, 22, 30, 40, 45, 18, 20, 25, 25, 50].map(w => ({ wch: w }));
  return ws;
}

function writeXlsxSafe(wb, filePath) {
  try { XLSX.writeFile(wb, filePath); return filePath; }
  catch (err) {
    if (err.code === 'EBUSY') {
      const fallback = filePath.replace('.xlsx', '_new.xlsx');
      XLSX.writeFile(wb, fallback);
      console.log(`  [Notice] ${path.basename(filePath)} locked (open in Excel). Wrote ${path.basename(fallback)}`);
      return fallback;
    }
    throw err;
  }
}

function writeTextSafe(filePath, content) {
  try { fs.writeFileSync(filePath, content, 'utf8'); return filePath; }
  catch (err) {
    if (err.code === 'EBUSY') {
      const fallback = filePath.replace(/\.(\w+)$/, '_new.$1');
      fs.writeFileSync(fallback, content, 'utf8');
      return fallback;
    }
    throw err;
  }
}

function saveCountryFiles(country, dentalData, aestheticData) {
  const safe = country.replace(/\s+/g, '_');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, createSheet(dentalData), 'Dental Clinics');
  XLSX.utils.book_append_sheet(wb, createSheet(aestheticData), 'Aesthetic Clinics');
  writeXlsxSafe(wb, path.join(EXCEL_DIR, `${safe}.xlsx`));
  const toCSV = (d) => '﻿' + XLSX.utils.sheet_to_csv(createSheet(d));
  writeTextSafe(path.join(CSV_DIR, `${safe}_Dental_Clinics.csv`), toCSV(dentalData));
  writeTextSafe(path.join(CSV_DIR, `${safe}_Aesthetic_Clinics.csv`), toCSV(aestheticData));
  writeTextSafe(path.join(CSV_DIR, `${safe}_All_Clinics.csv`), toCSV([...dentalData, ...aestheticData]));
  console.log(`  [Saved] ${safe}.xlsx (Dental: ${dentalData.length}, Aesthetic: ${aestheticData.length})`);
}

function saveMasterFiles(allData, countryGrouped) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, createSheet(allData), 'All Markets Master');
  for (const [c, records] of Object.entries(countryGrouped)) {
    XLSX.utils.book_append_sheet(wb, createSheet(records), c.substring(0, 31));
  }
  writeXlsxSafe(wb, path.join(EXPORTS_DIR, 'All_Markets_Clinics_Master.xlsx'));
  writeTextSafe(path.join(EXPORTS_DIR, 'All_Markets_Clinics_Master.csv'), '﻿' + XLSX.utils.sheet_to_csv(createSheet(allData)));
  writeTextSafe(path.join(EXPORTS_DIR, 'clinics_data.js'), 'window.CLINICS_DATA = ' + JSON.stringify(allData.map(({ _enriched, ...r }) => r)) + ';');
}

// ---------- Main ----------
async function main() {
  console.log('\n======================================================');
  console.log(' ENRICHER v2: Complete every field for every clinic');
  console.log('======================================================');

  const allData = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
  console.log(`Loaded ${allData.length} records. Concurrency=${CONCURRENCY} Limit=${LIMIT || 'all'} Country=${ONLY_COUNTRY || 'all'}`);

  // Which records still need enrichment
  const needs = (d) => {
    if (!d.mapsUrl) return false;
    if (ONLY_COUNTRY && d.country !== ONLY_COUNTRY) return false;
    if (d._enriched) return false;                     // resume support
    return isBadAddress(d.address) || !d.phone || !d.website || !d.reviewsCount || !d.plusCode;
  };
  let targets = allData.filter(needs);
  if (LIMIT) targets = targets.slice(0, LIMIT);
  console.log(`Records needing enrichment: ${targets.length}`);

  // Deduplicate by mapsUrl
  const byUrl = new Map();
  for (const rec of targets) {
    if (!byUrl.has(rec.mapsUrl)) byUrl.set(rec.mapsUrl, []);
    byUrl.get(rec.mapsUrl).push(rec);
  }
  const uniqueUrls = [...byUrl.keys()];
  console.log(`Unique place URLs to fetch: ${uniqueUrls.length}`);

  let processed = 0, filled = 0;
  const failed = [];
  const checkpoint = () => {
    try { fs.writeFileSync(DATA_JSON, JSON.stringify(allData), 'utf8'); } catch (_) {}
  };

  const launchBrowser = () => puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=en-US']
  });

  const CHUNK = 220;        // fresh browser profile every N requests (session throttle)
  const MAX_ROUNDS = 3;

  const processOne = async (page, url) => {
    const recs = byUrl.get(url);
    let ext = null;
    for (let attempt = 0; attempt < 2 && !ext; attempt++) {
      try { ext = await enrichViaRPC(page, url); } catch (_) {}
      if (!ext && attempt === 0) await sleep(600);
    }
    if (ext && ext.dom) { // RPC failed but DOM worked
      if (Object.keys(ext.dom).length) {
        for (const rec of recs) { if (applyEnrichment(rec, ext.dom)) filled++; rec._enriched = 1; }
        return true;
      }
      return false;
    }
    if (ext) {
      for (const rec of recs) { if (applyEnrichment(rec, ext)) filled++; rec._enriched = 1; }
      return true;
    }
    return false;
  };

  let pendingUrls = [...uniqueUrls];
  let round = 0;
  while (pendingUrls.length && round < MAX_ROUNDS) {
    round++;
    if (round > 1) console.log(`\n[Retry round ${round}] ${pendingUrls.length} places left`);
    const roundQueue = [...pendingUrls];
    const roundFailed = [];

    while (roundQueue.length) {
      const browser = await launchBrowser();
      const makePage = async () => {
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const t = req.resourceType();
          if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet') req.abort().catch(() => {});
          else req.continue().catch(() => {});
        });
        return page;
      };

      let budget = CHUNK;
      await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
        let page = await makePage();
        let pageUses = 0;
        while (roundQueue.length && budget-- > 0) {
          if (pageUses >= 60) {
            await page.close().catch(() => {});
            page = await makePage();
            pageUses = 0;
          }
          const url = roundQueue.shift();
          const ok = await processOne(page, url);
          pageUses++;
          if (!ok) {
            roundFailed.push(url);
            for (const rec of byUrl.get(url)) rec._enriched = 0;
          }
          processed++;
          if (processed % 50 === 0) {
            checkpoint();
            console.log(`  [${processed}/${uniqueUrls.length}] ${(processed / uniqueUrls.length * 100).toFixed(1)}% — filled ${filled}, failed ${roundFailed.length} this round`);
          }
          await sleep(250 + Math.random() * 500);
        }
        await page.close().catch(() => {});
      }));

      await browser.close().catch(() => {});
      checkpoint();
      if (roundQueue.length) console.log(`  [Fresh browser] continuing ${processed}/${uniqueUrls.length}`);
    }

    pendingUrls = roundFailed;
  }

  for (const url of pendingUrls) {
    failed.push({ url, names: (byUrl.get(url) || []).map(r => r.name).slice(0, 2) });
  }
  checkpoint();
  fs.writeFileSync(FAILED_JSON, JSON.stringify(failed, null, 2), 'utf8');
  console.log(`\n[Done] ${processed} places visited, ${filled} records updated, ${failed.length} permanently failed (see enrich_failed.json)`);

  // ---------- Email pass ----------
  console.log('\n[Email] Checking clinic websites for emails...');
  const withWebsite = allData.filter(d => d.website && !d.email);
  console.log(`Websites to check: ${withWebsite.length}`);
  let emailsFilled = 0;
  const EMAIL_CONC = 12;
  for (let i = 0; i < withWebsite.length; i += EMAIL_CONC) {
    const batch = withWebsite.slice(i, i + EMAIL_CONC);
    const results = await Promise.allSettled(batch.map(r => extractEmailFromWebsite(r.website)));
    results.forEach((res, idx) => { if (res.status === 'fulfilled' && res.value) { batch[idx].email = res.value; emailsFilled++; } });
    if ((i + EMAIL_CONC) % 120 === 0 || i + EMAIL_CONC >= withWebsite.length) {
      console.log(`  [Email] ${Math.min(i + EMAIL_CONC, withWebsite.length)}/${withWebsite.length} checked — ${emailsFilled} found`);
      checkpoint();
    }
  }
  console.log(`[Done] Emails filled: ${emailsFilled}`);
  checkpoint();

  // ---------- Re-export canonical files ----------
  console.log('\n[Export] Regenerating all Excel/CSV/JSON files...');
  const countries = ['Finland', 'Qatar', 'Pakistan', 'UAE', 'Saudi Arabia', 'United Kingdom'];
  const countryGrouped = {};
  for (const country of countries) {
    const dental = allData.filter(d => d.country === country && d.niche && d.niche.includes('Dental'));
    const aesthetic = allData.filter(d => d.country === country && d.niche && d.niche.includes('Aesthetic'));
    countryGrouped[country] = [...dental, ...aesthetic];
    saveCountryFiles(country, dental, aesthetic);
  }
  saveMasterFiles(allData, countryGrouped);
  // Final JSON without internal flags
  writeTextSafe(DATA_JSON, JSON.stringify(allData.map(({ _enriched, ...r }) => r), null, 2), 'utf8');

  // ---------- Final stats ----------
  const stat = (k) => allData.filter(d => d[k] && String(d[k]).trim()).length;
  const goodAddr = allData.filter(d => !isBadAddress(d.address)).length;
  console.log('\n======================================================');
  console.log(' ENRICHMENT COMPLETE');
  console.log('======================================================');
  console.log(`Total records     : ${allData.length}`);
  console.log(`With phone        : ${stat('phone')} (${(stat('phone') / allData.length * 100).toFixed(1)}%)`);
  console.log(`With website      : ${stat('website')} (${(stat('website') / allData.length * 100).toFixed(1)}%)`);
  console.log(`With email        : ${stat('email')} (${(stat('email') / allData.length * 100).toFixed(1)}%)`);
  console.log(`With reviews      : ${stat('reviewsCount')} (${(stat('reviewsCount') / allData.length * 100).toFixed(1)}%)`);
  console.log(`With valid address: ${goodAddr} (${(goodAddr / allData.length * 100).toFixed(1)}%)`);
}

if (require.main === module) {
  main().catch(err => { console.error('Enricher fatal error:', err); process.exit(1); });
}

module.exports = { isBadAddress, applyEnrichment, saveCountryFiles, saveMasterFiles, createSheet, recordToRow, DATA_JSON, EXPORTS_DIR, EXCEL_DIR, CSV_DIR };
