# Historical Forms Data Directory

## 📂 Purpose

This directory is for placing Excel files to import historical merchant forms data.

## 📋 Required File

Place your Excel file here with the name: **`historical_forms.xlsx`**

## 📊 Excel File Format

Your Excel file should have these columns (in any order):

| Column Name | Description | Example |
|-------------|-------------|---------|
| Employee Name | FSE name from sheet | "Sujeet Saroj" |
| Employee Email | FSE email (optional) | "sujeet@example.com" |
| Employee Phone | FSE phone (optional) | "9876543210" |
| Team Leader | TL name (optional) | "Rahul Kumar" |
| TL Phone | TL phone (optional) | "9123456789" |
| TL Email | TL email (optional) | "rahul@example.com" |
| Customer Name | Merchant name | "ABC Store" |
| Customer Phone | Merchant phone | "9999888877" |
| Location | Merchant location | "Delhi" |
| Visit Status | Form status | "Ready for Onboarding" |
| Product | Product name | "Tide" |
| Verification Status | (ignored, will be calculated) | "Fully Verified" |
| Tide QR Posted | For Tide product | "Yes" |
| Tide UPI Txn Done | For Tide product | "Yes" |
| Insurance Vehicle No | For Insurance | "DL01AB1234" |
| Insurance Vehicle Type | For Insurance | "Two Wheeler" |
| Insurance Type | For Insurance | "Comprehensive" |
| PineLab Card Txn | For PineLab | "Yes" |
| PineLab WiFi Connected | For PineLab | "Yes" |
| Credit Card Name | For Credit Card | "HDFC Regalia" |
| Tide Insurance Type | For Tide Insurance | "Accidental" |
| Submitted On | Date format: "09 January 2026" | "15 March 2026" |

## 🚀 Usage

1. **Place your Excel file here:**
   ```
   backend/data/historical_forms.xlsx
   ```

2. **Run dry-run first (no database changes):**
   ```bash
   cd backend
   node scripts/importHistoricalForms.js --dry-run
   ```

3. **Test with small batch:**
   ```bash
   node scripts/importHistoricalForms.js --limit 10
   ```

4. **Full import:**
   ```bash
   node scripts/importHistoricalForms.js
   ```

5. **Rollback if needed:**
   ```bash
   node scripts/rollbackHistoricalImport.js --confirm
   ```

## ⚠️ Important Notes

- The import script will fuzzy match FSE names (80% similarity threshold)
- Unmatched FSEs will be assigned to "Dheeraj Anand"
- Historical forms will appear in all dashboards automatically
- Verification will run automatically on next page load
- Current forms are never affected by import/rollback

## 📝 Example Row

```
Employee Name: Sujeet Saroj
Customer Name: ABC Traders
Customer Phone: 9876543210
Location: Delhi
Visit Status: Ready for Onboarding
Product: Tide
Tide QR Posted: Yes
Tide UPI Txn Done: Yes
Submitted On: 15 January 2026
```
