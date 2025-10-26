# Clear Commission Records - PowerShell Script
# This script clears all commission records from both dev and prod databases

Write-Host "🧹 Commission Records Cleanup Utility" -ForegroundColor Cyan
Write-Host "======================================`n" -ForegroundColor Cyan

# Change to backend directory
Set-Location -Path "c:\Users\Dave\OneDrive\Documents\Projects\SAAS_E-COMMERCE\saas-ecommerce-backend"

Write-Host "📁 Current directory: $PWD`n" -ForegroundColor Yellow

# Menu
Write-Host "Select database to clear:" -ForegroundColor White
Write-Host "1. Development Database (localhost)" -ForegroundColor Green
Write-Host "2. Production Database (MongoDB Atlas)" -ForegroundColor Red
Write-Host "3. Both Databases (Dev first, then Prod)" -ForegroundColor Magenta
Write-Host "4. Exit`n" -ForegroundColor Gray

$choice = Read-Host "Enter your choice (1-4)"

switch ($choice) {
    "1" {
        Write-Host "`n🔧 Clearing DEVELOPMENT database..." -ForegroundColor Green
        $env:DBURI = "mongodb://localhost:27017/saas-ecommerce-dev"
        node src/scripts/clearCommissionRecords.js
    }
    "2" {
        Write-Host "`n⚠️  Clearing PRODUCTION database..." -ForegroundColor Red
        # Using the correct production credentials from .env
        $env:DBURI = "mongodb+srv://AnansE:MXHs1t8F4gGTLGNe@mongodbcluster.kjbxxoj.mongodb.net/saas-ecommerce"
        node src/scripts/clearCommissionRecords.js
    }
    "3" {
        Write-Host "`n🔧 Clearing DEVELOPMENT database first..." -ForegroundColor Green
        $env:DBURI = "mongodb://localhost:27017/saas-ecommerce-dev"
        node src/scripts/clearCommissionRecords.js
        
        Write-Host "`n⚠️  Now clearing PRODUCTION database..." -ForegroundColor Red
        Start-Sleep -Seconds 2
        # Using the correct production credentials from .env
        $env:DBURI = "mongodb+srv://AnansE:MXHs1t8F4gGTLGNe@mongodbcluster.kjbxxoj.mongodb.net/saas-ecommerce"
        node src/scripts/clearCommissionRecords.js
    }
    "4" {
        Write-Host "`nExiting..." -ForegroundColor Gray
        exit
    }
    default {
        Write-Host "`n❌ Invalid choice. Exiting." -ForegroundColor Red
        exit
    }
}

Write-Host "`n✅ Process completed!`n" -ForegroundColor Green
