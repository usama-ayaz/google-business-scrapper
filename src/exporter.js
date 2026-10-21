const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const EXPORTS_DIR = path.resolve(__dirname, '..', 'exports');
const EXCEL_DIR = path.join(EXPORTS_DIR, 'excel');
const CSV_DIR = path.join(EXPORTS_DIR, 'csv');

// Ensure output directories exist
[EXPORTS_DIR, EXCEL_DIR, CSV_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Standard column headers for clinics
 */
const COLUMNS = [
  { header: 'Clinic Name', key: 'name', width: 35 },
  { header: 'Target Niche', key: 'niche', width: 20 },
  { header: 'Category / Specialty', key: 'category', width: 25 },
  { header: 'Rating (Stars)', key: 'rating', width: 15 },
  { header: 'Review Count', key: 'reviewsCount', width: 15 },
  { header: 'Phone Number', key: 'phone', width: 22 },
  { header: 'Website URL', key: 'website', width: 35 },
  { header: 'Full Address', key: 'address', width: 45 },
  { header: 'City', key: 'city', width: 18 },
  { header: 'Country', key: 'country', width: 20 },
  { header: 'Plus Code / Location ID', key: 'plusCode', width: 25 },
  { header: 'Operating Status', key: 'status', width: 25 },
  { header: 'Google Maps Link', key: 'mapsUrl', width: 50 }
];

/**
 * Convert objects array to Worksheet with styling and column widths
 */
function createWorksheet(data) {
  const formattedRows = data.map((item) => ({
    'Clinic Name': item.name || '',
    'Target Niche': item.niche || '',
    'Category / Specialty': item.category || '',
    'Rating (Stars)': item.rating !== '' ? Number(item.rating) : '',
    'Review Count': item.reviewsCount !== '' ? Number(item.reviewsCount) : '',
    'Phone Number': item.phone || '',
    'Website URL': item.website || '',
    'Full Address': item.address || '',
    'City': item.city || '',
    'Country': item.country || '',
    'Plus Code / Location ID': item.plusCode || '',
    'Operating Status': item.status || '',
    'Google Maps Link': item.mapsUrl || ''
  }));

  const ws = XLSX.utils.json_to_sheet(formattedRows);

  // Set column widths
  ws['!cols'] = COLUMNS.map((col) => ({ wch: col.width }));

  return ws;
}

/**
 * Export Country Multi-Sheet Excel File (.xlsx)
 * Contains 2 sheets: "Dental Clinics" and "Aesthetic Clinics"
 */
function exportCountryExcel(countryName, dentalData, aestheticData) {
  const sanitizedCountry = countryName.replace(/\s+/g, '_');
  const filePath = path.join(EXCEL_DIR, `${sanitizedCountry}.xlsx`);

  const wb = XLSX.utils.book_new();

  // Sheet 1: Dental Clinics
  const wsDental = createWorksheet(dentalData);
  XLSX.utils.book_append_sheet(wb, wsDental, 'Dental Clinics');

  // Sheet 2: Aesthetic Clinics
  const wsAesthetic = createWorksheet(aestheticData);
  XLSX.utils.book_append_sheet(wb, wsAesthetic, 'Aesthetic Clinics');

  try {
    XLSX.writeFile(wb, filePath);
    return filePath;
  } catch (err) {
    if (err.code === 'EBUSY') {
      const fallback = path.join(EXCEL_DIR, `${sanitizedCountry}_new.xlsx`);
      XLSX.writeFile(wb, fallback);
      console.log(`\n[Notice] ${filePath} is open in Excel. Saved updated data to: ${fallback}`);
      return fallback;
    }
    throw err;
  }
}

/**
 * Export CSV File helper
 */
function exportCSV(filename, data) {
  const filePath = path.join(CSV_DIR, filename);
  const ws = createWorksheet(data);
  const csvContent = XLSX.utils.sheet_to_csv(ws);
  try {
    fs.writeFileSync(filePath, '\uFEFF' + csvContent, 'utf8');
    return filePath;
  } catch (err) {
    if (err.code === 'EBUSY') {
      const fallback = path.join(CSV_DIR, filename.replace('.csv', '_new.csv'));
      fs.writeFileSync(fallback, '\uFEFF' + csvContent, 'utf8');
      return fallback;
    }
    throw err;
  }
}

/**
 * Export Master Files with all 6 countries and 2 niches combined
 */
function exportMasterFiles(allData, countryGrouped) {
  // 1. Master Excel
  const masterExcelPath = path.join(EXPORTS_DIR, 'All_Markets_Clinics_Master.xlsx');
  const wb = XLSX.utils.book_new();

  // Master Sheet
  const wsMaster = createWorksheet(allData);
  XLSX.utils.book_append_sheet(wb, wsMaster, 'All Markets Master');

  // Individual sheets per country
  for (const [country, records] of Object.entries(countryGrouped)) {
    const wsCountry = createWorksheet(records);
    XLSX.utils.book_append_sheet(wb, wsCountry, country.substring(0, 31));
  }

  try {
    XLSX.writeFile(wb, masterExcelPath);
  } catch (err) {
    if (err.code === 'EBUSY') {
      const fallback = path.join(EXPORTS_DIR, 'All_Markets_Clinics_Master_new.xlsx');
      XLSX.writeFile(wb, fallback);
    }
  }

  // 2. Master CSV
  const masterCsvPath = path.join(EXPORTS_DIR, 'All_Markets_Clinics_Master.csv');
  const csvContent = XLSX.utils.sheet_to_csv(wsMaster);
  try {
    fs.writeFileSync(masterCsvPath, '\uFEFF' + csvContent, 'utf8');
  } catch (err) {
    if (err.code === 'EBUSY') {
      fs.writeFileSync(path.join(EXPORTS_DIR, 'All_Markets_Clinics_Master_new.csv'), '\uFEFF' + csvContent, 'utf8');
    }
  }

  // 3. JSON export for dashboard
  const jsonPath = path.join(EXPORTS_DIR, 'clinics_data.json');
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(allData, null, 2), 'utf8');
  } catch (_) {}

  return { masterExcelPath, masterCsvPath, jsonPath };
}

module.exports = {
  exportCountryExcel,
  exportCSV,
  exportMasterFiles,
  EXPORTS_DIR,
  EXCEL_DIR,
  CSV_DIR
};
