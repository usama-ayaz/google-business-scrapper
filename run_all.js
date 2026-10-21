const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { scrapeGoogleMaps, CHROME_PATH } = require('./src/scraper');
const { exportCountryExcel, exportCSV, exportMasterFiles, EXCEL_DIR, CSV_DIR } = require('./src/exporter');

// 6 Target Markets and their cities/regions for comprehensive coverage
const MARKETS = [
  {
    country: 'Finland',
    cities: ['Helsinki', 'Espoo', 'Tampere', 'Vantaa', 'Oulu', 'Turku']
  },
  {
    country: 'Qatar',
    cities: ['Doha', 'Al Rayyan', 'Lusail', 'Al Wakrah', 'Al Khor']
  },
  {
    country: 'Pakistan',
    cities: ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar']
  },
  {
    country: 'UAE',
    cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Al Ain']
  },
  {
    country: 'Saudi Arabia',
    cities: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar']
  },
  {
    country: 'United Kingdom',
    cities: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Edinburgh', 'Liverpool']
  }
];

const NICHES = [
  {
    id: 'dental',
    name: 'Dental Clinics',
    searchTerm: 'dental clinics'
  },
  {
    id: 'aesthetic',
    name: 'Aesthetic Clinics',
    searchTerm: 'aesthetic clinics skin clinic'
  }
];

function logBanner(text) {
  const line = '='.repeat(60);
  console.log(`\n${line}\n ${text}\n${line}`);
}

async function run() {
  logBanner('FULL GOOGLE MAPS COMPREHENSIVE SCRAPER (NO LIMITS)');
  console.log('Markets (6):', MARKETS.map((m) => m.country).join(', '));
  console.log('Niches (2): Dental Clinics & Aesthetic Clinics\n');

  const startTime = Date.now();
  const allClinics = [];
  const countryDataMap = {};

  const browser = await puppeteer.launch({
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

  try {
    for (let mIdx = 0; mIdx < MARKETS.length; mIdx++) {
      const market = MARKETS[mIdx];
      logBanner(`MARKET [${mIdx + 1}/6]: ${market.country.toUpperCase()}`);

      const dentalList = [];
      const aestheticList = [];

      for (const nicheObj of NICHES) {
        console.log(`\n>>> Scraping Niche: [${nicheObj.name}] for ${market.country}...`);
        const seenNames = new Set();
        const targetList = nicheObj.id === 'dental' ? dentalList : aestheticList;

        // Query across all cities in this market
        for (const city of market.cities) {
          const query = `${nicheObj.searchTerm} in ${city} ${market.country}`;
          console.log(`  -> Querying: "${query}" (scrolling to end of feed)...`);

          const results = await scrapeGoogleMaps(query, {
            maxResults: 300, // No artificial 25-30 limit!
            country: market.country,
            city,
            niche: nicheObj.name,
            browserInstance: browser,
            onProgress: (msg) => console.log(`     ${msg}`)
          });

          let added = 0;
          for (const item of results) {
            const key = item.name.toLowerCase().trim();
            if (!seenNames.has(key)) {
              seenNames.add(key);
              targetList.push(item);
              allClinics.push(item);
              added++;
            }
          }

          console.log(`     [Done] Added +${added} unique clinics from ${city}. (Current Total ${nicheObj.name} in ${market.country}: ${targetList.length})`);
        }
      }

      countryDataMap[market.country] = [...dentalList, ...aestheticList];

      // Export individual Country Multi-Sheet Excel (.xlsx) with 2 sheets
      const excelPath = exportCountryExcel(market.country, dentalList, aestheticList);
      console.log(`\n[Excel Saved] 2-Sheet Workbook: ${path.basename(excelPath)} (Dental: ${dentalList.length}, Aesthetic: ${aestheticList.length}, Total: ${dentalList.length + aestheticList.length})`);

      // Export individual CSVs
      const safeCountry = market.country.replace(/\s+/g, '_');
      const dentalCsvPath = exportCSV(`${safeCountry}_Dental_Clinics.csv`, dentalList);
      const aestheticCsvPath = exportCSV(`${safeCountry}_Aesthetic_Clinics.csv`, aestheticList);
      const combinedCsvPath = exportCSV(`${safeCountry}_All_Clinics.csv`, [...dentalList, ...aestheticList]);
      console.log(`[CSV Saved] ${path.basename(dentalCsvPath)} (${dentalList.length} rows) & ${path.basename(aestheticCsvPath)} (${aestheticList.length} rows)`);

      // Update intermediate master files
      exportMasterFiles(allClinics, countryDataMap);
      fs.writeFileSync(path.join(__dirname, 'exports', 'clinics_data.js'), 'window.CLINICS_DATA = ' + JSON.stringify(allClinics) + ';');
    }

    // Final Master Export
    logBanner('FINALIZING MASTER EXPORTS');
    const { masterExcelPath, masterCsvPath, jsonPath } = exportMasterFiles(allClinics, countryDataMap);
    fs.writeFileSync(path.join(__dirname, 'exports', 'clinics_data.js'), 'window.CLINICS_DATA = ' + JSON.stringify(allClinics) + ';');

    const totalMinutes = ((Date.now() - startTime) / 60000).toFixed(1);
    logBanner(`ALL 6 MARKETS COMPLETED IN ${totalMinutes} MINUTES!`);
    console.log(`Total Unique Clinics Collected: ${allClinics.length}`);
    for (const [cName, list] of Object.entries(countryDataMap)) {
      console.log(`  - ${cName}: ${list.length} clinics`);
    }
  } catch (err) {
    console.error('Fatal Scraper Error:', err);
  } finally {
    await browser.close().catch(() => {});
  }
}

run().catch(console.error);
