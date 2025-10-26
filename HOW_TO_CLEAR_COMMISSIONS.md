# 🧹 Clear All Commission Records - Quick Guide

## ✨ What I've Created For You

I've created two tools to safely clear all commission records:

### 1. **Node.js Script** (`src/scripts/clearCommissionRecords.js`)

- Comprehensive safety checks
- Confirmation prompts
- Production database extra security
- Shows before/after counts

### 2. **PowerShell Helper** (`clear-commissions.ps1`)

- Easy menu-driven interface
- Clear both databases with one script
- Color-coded for safety

---

## 🚀 Quick Start (Recommended)

### Option A: Use PowerShell Helper (Easiest)

1. Open PowerShell in the backend directory
2. Run the helper script:

```powershell
cd saas-ecommerce-backend
.\clear-commissions.ps1
```

3. Choose from menu:
   - `1` = Clear Dev Database
   - `2` = Clear Prod Database
   - `3` = Clear Both Databases
   - `4` = Exit

### Option B: Run Manually

#### Clear Development Database:

```powershell
cd saas-ecommerce-backend
$env:DBURI = "mongodb://localhost:27017/saas-ecommerce-dev"
node src/scripts/clearCommissionRecords.js
```

#### Clear Production Database:

```powershell
cd saas-ecommerce-backend
$env:DBURI = "mongodb+srv://AnansE:MXHs1t8F4gGTLGNe@mongodbcluster.kjbxxoj.mongodb.net/saas-ecommerce"
node src/scripts/clearCommissionRecords.js
```

---

## 📋 What Will Happen

1. **Script connects** to the database
2. **Shows current counts**:
   - Commission Records: X
   - Monthly Summaries: Y
3. **Asks for confirmation**: Type `yes` to continue
4. **Production Safety** (for prod DB only): Type `DELETE ALL COMMISSIONS`
5. **Deletes all records**
6. **Shows final counts** (should be 0)
7. **Confirms success**

---

## 🔒 Safety Features

✅ **Double Confirmation**: Asks "Are you sure?" before deleting  
✅ **Production Lock**: Requires exact text match for production  
✅ **Shows DB Info**: Displays database name and host  
✅ **Verification**: Shows before/after counts  
✅ **No Accidents**: Script exits if you type anything other than "yes"

---

## ⚠️ Important Notes

### What Gets Deleted:

- ✅ All commission records (pending, paid, rejected, cancelled)
- ✅ All monthly summary records

### What Stays Intact:

- ✅ Commission settings (rates)
- ✅ User accounts
- ✅ Order history
- ✅ All other data

### After Clearing:

- Generate new commissions using the "Generate Monthly" button in the UI
- Start fresh with commissions from this month forward
- All historical commission data will be gone

---

## 🎯 Example Session

```
🧹 Commission Records Cleanup Script
=====================================

🔌 Connecting to database...
✅ Connected to database: saas-ecommerce-dev
📍 Database host: localhost

📊 Current Commission Data:
   - Commission Records: 150
   - Monthly Summaries: 5

⚠️  WARNING: This action will permanently delete ALL commission records!
   This includes:
   - All commission records (pending, paid, rejected, cancelled)
   - All monthly summary records
   - This action CANNOT be undone!

❓ Are you sure you want to continue? (yes/no): yes

🗑️  Deleting commission records...
   ✅ Deleted 150 commission records
   ✅ Deleted 5 monthly summaries

📊 Final Count:
   - Commission Records: 0
   - Monthly Summaries: 0

✨ SUCCESS! All commission records have been cleared.
   You now have a clean sheet for commissions.

👋 Database connection closed.
```

---

## 🛠️ Troubleshooting

### "Cannot find module"

- Make sure you're in the `saas-ecommerce-backend` directory
- Run `npm install` if dependencies are missing

### "Connection refused" (Dev DB)

- Start MongoDB: `mongod` or check if MongoDB service is running
- Verify MongoDB is running on port 27017

### "Authentication failed" (Prod DB)

- Check the database URI in the script
- Verify credentials are correct

### Script hangs at confirmation

- Just type `yes` and press Enter
- For production, type exactly: `DELETE ALL COMMISSIONS`

---

## 🎬 Ready to Clear?

Run the PowerShell helper:

```powershell
cd saas-ecommerce-backend
.\clear-commissions.ps1
```

Then follow the prompts!

---

**Need Help?** Check `src/scripts/CLEAR_COMMISSIONS_README.md` for detailed documentation.
