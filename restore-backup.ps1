# Restore Database from Backup - PowerShell Script
# This script restores data from a backup JSON file to your local or production database

Write-Host "🔄 Database Restoration Utility" -ForegroundColor Cyan
Write-Host "================================`n" -ForegroundColor Cyan

# Change to backend directory
Set-Location -Path "c:\Users\Dave\OneDrive\Documents\Projects\SAAS_E-COMMERCE\saas-ecommerce-backend"

Write-Host "📁 Current directory: $PWD`n" -ForegroundColor Yellow

# Find all backup files
$backupFiles = Get-ChildItem -Path "backups" -Filter "*.json" | Sort-Object LastWriteTime -Descending

if ($backupFiles.Count -eq 0) {
    Write-Host "❌ No backup files found in the backups directory.`n" -ForegroundColor Red
    exit
}

Write-Host "📦 Available backup files:" -ForegroundColor White
for ($i = 0; $i -lt $backupFiles.Count; $i++) {
    $file = $backupFiles[$i]
    $size = [math]::Round($file.Length / 1MB, 2)
    Write-Host "$($i + 1). $($file.Name) ($size MB) - Modified: $($file.LastWriteTime)" -ForegroundColor Gray
}

Write-Host "`nSelect backup file to restore:" -ForegroundColor White
$backupChoice = Read-Host "Enter number (1-$($backupFiles.Count))"

$selectedBackupIndex = [int]$backupChoice - 1
if ($selectedBackupIndex -lt 0 -or $selectedBackupIndex -ge $backupFiles.Count) {
    Write-Host "`n❌ Invalid choice. Exiting." -ForegroundColor Red
    exit
}

$selectedBackup = $backupFiles[$selectedBackupIndex]
$backupPath = $selectedBackup.FullName

Write-Host "`n✅ Selected backup: $($selectedBackup.Name)`n" -ForegroundColor Green

# Menu for database selection
Write-Host "Select target database:" -ForegroundColor White
Write-Host "1. Development Database (localhost)" -ForegroundColor Green
Write-Host "2. Production Database (MongoDB Atlas)" -ForegroundColor Red
Write-Host "3. Exit`n" -ForegroundColor Gray

$choice = Read-Host "Enter your choice (1-3)"

switch ($choice) {
    "1" {
        Write-Host "`n🔧 Restoring to DEVELOPMENT database..." -ForegroundColor Green
        $env:DBURI = "mongodb://localhost:27017/saas-ecommerce-dev"
        node src/scripts/restoreFromBackup.js "$backupPath"
    }
    "2" {
        Write-Host "`n⚠️  Restoring to PRODUCTION database..." -ForegroundColor Red
        Write-Host "⚠️  WARNING: This will affect your live production data!" -ForegroundColor Red
        $confirm = Read-Host "Type 'RESTORE TO PRODUCTION' to continue"
        
        if ($confirm -eq "RESTORE TO PRODUCTION") {
            # Using the correct production credentials from .env
            $env:DBURI = "mongodb+srv://AnansE:MXHs1t8F4gGTLGNe@mongodbcluster.kjbxxoj.mongodb.net/saas-ecommerce"
            node src/scripts/restoreFromBackup.js "$backupPath"
        } else {
            Write-Host "`n❌ Confirmation text did not match. Exiting." -ForegroundColor Red
            exit
        }
    }
    "3" {
        Write-Host "`nExiting..." -ForegroundColor Gray
        exit
    }
    default {
        Write-Host "`n❌ Invalid choice. Exiting." -ForegroundColor Red
        exit
    }
}

Write-Host "`n✅ Process completed!`n" -ForegroundColor Green
