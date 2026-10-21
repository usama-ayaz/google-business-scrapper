const fs = require('fs');
const data = require('./exports/clinics_data.json');

// Find an aesthetic clinic in Pakistan with missing website
const sample = data.find(d => d.country === 'Pakistan' && d.niche.includes('Aesthetic') && !d.website && d.mapsUrl);
console.log('Testing clinic:', sample.name, 'Maps URL:', sample.mapsUrl);

async function testFetch() {
  const res = await fetch(sample.mapsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await res.text();
  console.log('HTML size:', html.length);

  // Look for APP_INITIALIZATION_STATE
  const match = html.match(/window\.APP_INITIALIZATION_STATE\s*=\s*(.*?);/);
  if (match) {
    console.log('APP_INITIALIZATION_STATE found!');
    fs.writeFileSync('place_state.json', match[1]);

    // Search for website and phone in the state
    const str = match[1];
    // Find websites (http not google)
    const urls = Array.from(str.matchAll(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\\\"'\s]*/g))
      .map(m => m[0])
      .filter(u => !u.includes('google') && !u.includes('gstatic') && !u.includes('schema.org') && !u.includes('w3.org') && !u.includes('chromium') && !u.includes('android'));

    console.log('Extracted URLs:', [...new Set(urls)]);

    // Find phones
    const phones = Array.from(str.matchAll(/(?:\+?\d{1,4}[ -]?)?\(?\d{2,5}\)?[ -]?\d{3,5}[ -]?\d{3,5}/g))
      .map(m => m[0])
      .filter(p => p.replace(/\D/g, '').length >= 9 && p.replace(/\D/g, '').length <= 14);

    console.log('Extracted Phones:', [...new Set(phones)]);
  } else {
    console.log('No state found');
  }
}

testFetch().catch(console.error);
