# PowerShell script for seeding super admin to production database

# Production API endpoint
$API_BASE_URL = "https://saas-ecommerce-backend-chi.vercel.app"

# Super admin credentials
$ADMIN_EMAIL = "admin@saastleplay.com"
$ADMIN_PASSWORD = "Admin@123"
$ADMIN_NAME = "Super Admin"
$ADMIN_PHONE = "+233500000000"

Write-Host "Seeding Super Admin to Production Database..." -ForegroundColor Green
Write-Host "API Base URL: $API_BASE_URL" -ForegroundColor Cyan
Write-Host "Admin Email: $ADMIN_EMAIL" -ForegroundColor Cyan
Write-Host ""

# Register super admin
Write-Host "Registering super admin..." -ForegroundColor Yellow

$body = @{
    fullName = $ADMIN_NAME
    email = $ADMIN_EMAIL
    phone = $ADMIN_PHONE
    password = $ADMIN_PASSWORD
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$API_BASE_URL/api/auth/register/super-admin" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body

    Write-Host "Response: $($response | ConvertTo-Json -Depth 10)" -ForegroundColor White
    Write-Host ""

    if ($response.success -eq $true -and $response.accessToken) {
        Write-Host "Super admin registered successfully!" -ForegroundColor Green
        Write-Host "Access Token: $($response.accessToken)" -ForegroundColor Cyan
        Write-Host ""

        # Save token to file for next script
        $response.accessToken | Out-File -FilePath ".admin_token.txt" -Encoding utf8
        Write-Host "Access token saved to .admin_token.txt" -ForegroundColor Blue
        Write-Host ""

        Write-Host "Super admin seeding completed!" -ForegroundColor Green
        Write-Host "You can now run the provider seeding script." -ForegroundColor Yellow
    } else {
        Write-Host "Failed to register super admin" -ForegroundColor Red
        Write-Host "Response: $($response | ConvertTo-Json -Depth 10)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "Error occurred: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Response: $($_.Exception.Response)" -ForegroundColor Red
    exit 1
}
