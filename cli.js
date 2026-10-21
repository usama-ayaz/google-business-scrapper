const { scrapeGoogleMaps } = require('./src/scraper');
const { exportCSV } = require('./src/exporter');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag, def) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
  };

  const query = getArg('--query', '') || args.filter(a => !a.startsWith('--')).join(' ');
  const limit = parseInt(getArg('--limit', '20'), 10);
  const country = getArg('--country', '');
  const city = getArg('--city', '');
  const niche = getArg('--niche', '');
  const outFile = getArg('--output', '');

  if (!query) {
    console.log(`
Google Maps Scraper CLI
=======================
Usage:
  node cli.js "<search query>" [options]
  node cli.js --query "dental clinics in dubai" --limit 25
  node cli.js --country Pakistan --city Lahore --niche "Aesthetic Clinics"

Options:
  --query <str>       Full search query
  --limit <num>       Maximum results to fetch (default: 20)
  --country <str>     Country tag
  --city <str>        City tag
  --niche <str>       Niche tag
  --output <filename> Custom CSV output filename
`);
    process.exit(0);
  }

  console.log(`\nStarting Google Maps Scrape: "${query}" (limit: ${limit})...`);
  const results = await scrapeGoogleMaps(query, {
    maxResults: limit,
    country,
    city,
    niche,
    enrichDetails: true,
    onProgress: (m) => console.log(`  ${m}`)
  });

  console.log(`\nSuccessfully scraped ${results.length} listings!`);
  const filename = outFile || `custom_scrape_${Date.now()}.csv`;
  const savedPath = exportCSV(filename, results);
  console.log(`Saved output to: ${savedPath}`);
}

main().catch(console.error);
