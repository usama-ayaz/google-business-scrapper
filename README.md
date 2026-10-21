# Google Maps Clinics Scraper (Multi-Market Intelligence)

Automated Google Maps Scraper and Intelligence Data Pipeline covering **6 Global Markets** and **2 Target Niches**:

### 🎯 Target Niches:
1. **Dental Clinics (ڈینٹل کلینکس)**
2. **Aesthetic Clinics (ایستھیٹک کلینکس)**

### 🌍 Target Markets / Countries:
1. **Finland (فن لینڈ)** - Helsinki, Espoo, Tampere, Turku
2. **Qatar (قطر)** - Doha, Al Rayyan, Lusail, Al Wakrah
3. **Pakistan (پاکستان)** - Lahore, Karachi, Islamabad, Rawalpindi
4. **United Arab Emirates (UAE)** - Dubai, Abu Dhabi, Sharjah, Ajman
5. **Saudi Arabia (سعودی عرب)** - Riyadh, Jeddah, Dammam, Khobar
6. **United Kingdom (برطانیہ)** - London, Manchester, Birmingham, Edinburgh

---

## 📁 File Structure & Exports

As requested, each country has a dedicated multi-sheet Excel file (`.xlsx`) containing 2 sheets:
- **Sheet 1**: `Dental Clinics`
- **Sheet 2**: `Aesthetic Clinics`

### 1. Country Workbooks (2 Sheets Each)
- `exports/excel/Finland.xlsx`
- `exports/excel/Qatar.xlsx`
- `exports/excel/Pakistan.xlsx`
- `exports/excel/UAE.xlsx`
- `exports/excel/Saudi_Arabia.xlsx`
- `exports/excel/United_Kingdom.xlsx`

### 2. Individual CSV Files (`exports/csv/`)
For direct import into Google Sheets, CRM, or marketing tools:
- `Finland_Dental_Clinics.csv` & `Finland_Aesthetic_Clinics.csv`
- `Qatar_Dental_Clinics.csv` & `Qatar_Aesthetic_Clinics.csv`
- `Pakistan_Dental_Clinics.csv` & `Pakistan_Aesthetic_Clinics.csv`
- `UAE_Dental_Clinics.csv` & `UAE_Aesthetic_Clinics.csv`
- `Saudi_Arabia_Dental_Clinics.csv` & `Saudi_Arabia_Aesthetic_Clinics.csv`
- `United_Kingdom_Dental_Clinics.csv` & `United_Kingdom_Aesthetic_Clinics.csv`
- Combined country CSVs (e.g. `Pakistan_All_Clinics.csv`)

### 3. Master Aggregated Files
- `exports/All_Markets_Clinics_Master.xlsx`: Master Excel with All Clinics tab + tabs for every single country.
- `exports/All_Markets_Clinics_Master.csv`: Master CSV for universal database import.
- `exports/clinics_data.json`: Raw structured JSON.

---

## 📊 Extracted Data Fields
Every record contains all essential data points:
- **Clinic Name**: Official registered name on Google Maps
- **Target Niche**: Dental Clinic / Aesthetic Clinic
- **Category / Specialty**: Specific Google Maps categorization (Dentist, Skin Care, Cosmetic Surgeon, etc.)
- **Rating (Stars)**: Exact Google star rating (e.g., 4.9)
- **Review Count**: Total number of patient reviews
- **Phone Number**: International phone number with country dialing code
- **Website URL**: Direct clinic homepage / booking portal link
- **Full Address**: Complete physical location with building, street, and postal code
- **City & Country**: Market mapping
- **Operating Status**: Open / Closed / Operating hours
- **Google Maps Link**: Direct URL to view the clinic listing on Google Maps

---

## 🚀 How to Run the Scraper

### 1. Run Full 6-Country Scraping Batch
To scrape all 6 countries across both niches and regenerate all Excel and CSV files:
```bash
npm start
```

### 2. Custom Scraper CLI (Any City, Country, or Niche)
You can scrape any custom query on Google Maps anytime:
```bash
# Example 1: Search by query
npm run cli -- "dental clinics in birmingham uk" --limit 30

# Example 2: Search with specific tags
npm run cli -- --country "UAE" --city "Dubai" --niche "Aesthetic Clinics" --query "aesthetic clinics in jumeirah dubai" --limit 20
```

---

## 🖥️ Interactive Dashboard
An interactive UI dashboard is included in `dashboard.html`.
- Double-click `dashboard.html` to open it in Chrome or Edge.
- Filter by Country and Niche with 1 click.
- Real-time search across clinic names, phones, and addresses.
- Direct clickable phone calls (`tel:`) and website links.
- Instant filtered CSV export.
