# Unfilled Forms Tracker - Implementation Guide

## 📋 Overview

This feature tracks merchants from Google Sheet who don't have forms filled by FSEs. It helps identify which FSEs are forgetting to submit forms and maintains data accuracy between Google Sheet and MongoDB.

---

## 🎯 Problem Solved

**Before:**
- Google Sheet shows 183 Tide Insurance entries
- MongoDB has only 132 forms
- Gap of 51 missing forms (unknown which FSEs forgot)

**After:**
- System automatically detects 51 unfilled forms
- Shows them under "Dheeraj Anand" in Merchant Forms page
- When FSE fills form late → Marks as duplicate → Admin can identify lazy FSE

---

## 📂 Files Created/Modified

### ✅ NEW FILES (4 files):

1. **`vegavruddhi-employee-panel/backend/models/UnfilledForm.js`**
   - MongoDB schema for unfilled forms
   - Stores: phone, name, product, month, year, status, uniqueKey
   - Methods: `markAsFilledLate()`, `markAsResolved()`

2. **`vegavruddhi-admin-panel/backend/sync_unfilled_forms.py`**
   - Python script to sync unfilled forms
   - Compares Google Sheet vs MongoDB
   - Uses verification rules (same as verify API)
   - Can run manually or via cron

3. **`vegavruddhi-employee-panel/backend/routes/unfilledForms.js`**
   - API endpoints to read unfilled forms
   - GET `/api/unfilled-forms/list` - Get all unfilled forms
   - GET `/api/unfilled-forms/stats` - Get statistics
   - GET `/api/unfilled-forms/for-merchant-forms` - For frontend display
   - PUT `/api/unfilled-forms/:id/resolve` - Mark as resolved

4. **`vegavruddhi-employee-panel/backend/UNFILLED_FORMS_IMPLEMENTATION.md`**
   - This documentation file

### ✅ UPDATED FILES (3 files):

1. **`vegavruddhi-employee-panel/backend/server.js`**
   - Added: `app.use('/api/unfilled-forms', require('./routes/unfilledForms'))`

2. **`vegavruddhi-employee-panel/backend/routes/forms.js`**
   - Added: Duplicate detection after form submission
   - Checks if merchant exists in UnfilledForms
   - Marks as "filled_late" if found

3. **`vegavruddhi-admin-panel/backend/api/cron_sync.py`**
   - Added: Step 3 - Sync unfilled forms after main sync
   - Runs automatically with daily cron job

---

## 🔄 How It Works

### **Automatic Daily Sync (Cron Job):**

```
11:59 PM Daily
    ↓
Cron job runs cron_sync.py
    ↓
Step 1: Sync Google Sheet → MongoDB (existing)
    ↓
Step 2: Pre-compute verification cache (existing)
    ↓
Step 3: Sync unfilled forms (NEW)
    ├─ Read Google Sheet for current month
    ├─ Read MongoDB FormResponse for current month
    ├─ Compare using verification rules
    ├─ Find missing entries (in Sheet but not in DB)
    └─ Save to UnfilledForms collection
    ↓
Next day: Admin opens Merchant Forms page
    ↓
Frontend fetches unfilled forms automatically
    ↓
Shows under "Dheeraj Anand" with ⚠️ badge
```

### **Manual Sync (When Needed):**

```bash
# Sync for specific month/year
python sync_unfilled_forms.py --month May --year 2026

# Sync for current month/year
python sync_unfilled_forms.py
```

### **Late Submission Detection:**

```
FSE submits form (late)
    ↓
forms.js checks UnfilledForms collection
    ↓
If merchant exists in UnfilledForms:
    ├─ Mark as "filled_late"
    ├─ Link to new form
    └─ Log: "⚠️ LATE SUBMISSION: FSE X filled form late"
    ↓
Admin sees BOTH entries in Merchant Forms:
    1. Dheeraj Anand - ⚠️ UNFILLED (original)
    2. FSE Name - ✅ FILLED LATE (new)
```

---

## 🧪 Testing

### **1. Test Python Script (Manual):**

```bash
cd vegavruddhi-admin-panel/backend

# Test for current month
python sync_unfilled_forms.py

# Test for specific month
python sync_unfilled_forms.py --month May --year 2026
```

**Expected Output:**
```
🚀 SYNCING UNFILLED FORMS FOR MAY 2026
📊 Reading Google Sheet data for May 2026...
✅ Found 183 entries in Google Sheet for May 2026
📊 Reading MongoDB FormResponse for May 2026...
✅ Found 132 forms in MongoDB for May 2026
🔍 Comparing Sheet vs MongoDB to find unfilled forms...
⚠️ Found 51 unfilled forms
💾 Saving 51 unfilled forms to MongoDB...
✅ Inserted 51 unfilled forms
✅ SYNC COMPLETE
```

### **2. Test API Endpoints:**

```bash
# Get unfilled forms list
curl http://localhost:4000/api/unfilled-forms/list?month=May&year=2026

# Get statistics
curl http://localhost:4000/api/unfilled-forms/stats?month=May&year=2026

# Get for Merchant Forms page
curl http://localhost:4000/api/unfilled-forms/for-merchant-forms?month=May&year=2026
```

### **3. Test Duplicate Detection:**

1. Run sync script to create unfilled forms
2. Submit a form for a merchant that's in unfilled forms
3. Check logs for: `⚠️ LATE SUBMISSION DETECTED`
4. Verify unfilled form status changed to "filled_late"

### **4. Test Cron Job:**

The cron job runs automatically daily at 11:59 PM. To test manually:

```bash
cd vegavruddhi-admin-panel/backend
python api/cron_sync.py
```

---

## 📊 Database Schema

### **UnfilledForms Collection:**

```javascript
{
  _id: ObjectId,
  customerPhone: "9876543210",
  customerName: "Rajesh Kumar",
  product: "Tide Insurance",
  expectedMonth: "May",
  expectedYear: 2026,
  assignedTo: "Dheeraj Anand",
  status: "unfilled",  // or "filled_late", "resolved", "invalid"
  uniqueKey: "9876543210_rajesh kumar_tide insurance_may_2026",
  verificationRule: {
    matchFields: ["phone", "name"],
    timeWindow: "same_month"
  },
  sheetTabName: "Tide Onboarding",
  sheetRowNumber: 145,
  filledFormId: null,  // Links to FormResponse if filled later
  filledAt: null,
  filledByEmployee: null,
  createdAt: Date,
  syncedAt: Date
}
```

---

## 🎨 Frontend Integration (Next Step)

**File to Update:** `vegavruddhi-admin-panel/fse-dashboard/src/pages/MerchantForms.js`

**Changes Needed:**
1. Fetch unfilled forms from API
2. Show under "Dheeraj Anand" section
3. Add special badge: "⚠️ UNFILLED"
4. Show count in KPIs
5. Different color for unfilled forms (orange/yellow)

**API Call:**
```javascript
const response = await fetch(
  `${EMP_API}/unfilled-forms/for-merchant-forms?month=${selectedMonth}&year=${selectedYear}`
);
const data = await response.json();
// data.unfilledForms - array of unfilled forms
// data.groupedByAssigned - grouped by assigned person
```

---

## 🔧 Verification Rules

The system uses the same verification rules as the verify API:

```python
VERIFICATION_RULES = {
    'tide': {
        'matchFields': ['phone', 'name'],
        'timeWindow': 'same_month'
    },
    'tide insurance': {
        'matchFields': ['phone', 'name'],
        'timeWindow': 'same_month'
    },
    'tide msme': {
        'matchFields': ['phone'],  # Phone only
        'timeWindow': 'same_month'
    },
    'tide credit card': {
        'matchFields': ['phone', 'name'],
        'timeWindow': 'same_month'
    },
    'tide bt': {
        'matchFields': ['phone', 'name'],
        'timeWindow': 'same_month'
    }
}
```

**Unique Key Creation:**
- If rule uses `['phone', 'name']`: `phone_name_product_month_year`
- If rule uses `['phone']`: `phone_product_month_year`

---

## 📈 Benefits

1. ✅ **Data Accuracy**: Sheet count = MongoDB count (filled + unfilled)
2. ✅ **Accountability**: FSEs can't skip forms
3. ✅ **Identify Issues**: Know exactly who forgot to fill forms
4. ✅ **Historical Tracking**: Keep record of late submissions
5. ✅ **Admin Control**: Can mark forms as resolved/invalid

---

## 🚀 Deployment

### **Backend (Node.js):**
- No changes needed - routes auto-registered in server.js
- Restart backend to load new routes

### **Backend (Python):**
- Deploy `sync_unfilled_forms.py` to Vercel
- Ensure it's in same directory as `sync_sheet.py`
- Cron job will run automatically

### **Frontend:**
- Update MerchantForms.js (next step)
- Deploy to Vercel

---

## 🐛 Troubleshooting

### **Issue: Sync script not finding unfilled forms**
- Check Google Sheet has data for the month
- Check MongoDB has forms for the month
- Verify phone numbers are normalized correctly
- Check verification rules match product names

### **Issue: Duplicate detection not working**
- Check UnfilledForm model is imported in forms.js
- Check uniqueKey creation matches sync script
- Verify form submission includes customerNumber and formFillingFor

### **Issue: Cron job not running**
- Check cron_sync.py imports sync_unfilled_forms correctly
- Check environment variables (MONGO_URI, GOOGLE_SHEET_ID)
- Check Vercel cron job configuration

---

## 📝 Next Steps

1. ✅ Backend implementation (DONE)
2. ⏳ Frontend implementation (MerchantForms.js)
3. ⏳ Testing with real data
4. ⏳ Deploy to production
5. ⏳ Monitor for 1 week

---

## 🎯 Success Metrics

- **Before**: 183 Sheet entries, 132 MongoDB forms, 51 unknown gap
- **After**: 183 Sheet entries, 132 filled + 51 unfilled = 183 total ✅
- **FSE Accountability**: Can identify who forgot to fill forms
- **Data Integrity**: 100% match between Sheet and system

---

**Implementation Date:** May 18, 2026  
**Status:** Backend Complete ✅ | Frontend Pending ⏳
