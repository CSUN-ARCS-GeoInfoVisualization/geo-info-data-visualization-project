# Database Setup Script for Windows
# Run this with: powershell -ExecutionPolicy Bypass -File setup_database.ps1

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Database Branch Setup - Localhost" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if on correct branch
Write-Host "[1/6] Checking git branch..." -ForegroundColor Yellow
$currentBranch = git branch --show-current
if ($currentBranch -ne "core-database") {
    Write-Host "Switching to core-database branch..." -ForegroundColor Yellow
    git checkout core-database
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to switch to core-database branch" -ForegroundColor Red
        exit 1
    }
}
Write-Host "On core-database branch" -ForegroundColor Green
Write-Host ""

# Step 2: Create .env file
Write-Host "[2/6] Setting up environment variables..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host ".env file already exists. Skipping..." -ForegroundColor Yellow
} else {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env file from template" -ForegroundColor Green
    Write-Host ""
    Write-Host "IMPORTANT: Please edit .env and set your PostgreSQL password!" -ForegroundColor Red
    Write-Host "File location: $(Get-Location)\.env" -ForegroundColor Yellow
    Write-Host ""
    $response = Read-Host "Press Enter to open .env in notepad (or type 'skip' to continue)"
    if ($response -ne "skip") {
        notepad .env
        Write-Host "Waiting for you to save and close notepad..." -ForegroundColor Yellow
        Start-Sleep -Seconds 2
    }
}
Write-Host ""

# Step 3: Install Python dependencies
Write-Host "[3/6] Installing Python dependencies..." -ForegroundColor Yellow
Set-Location database
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to install Python dependencies" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Write-Host "Python dependencies installed" -ForegroundColor Green
Write-Host ""

# Step 4: Test database connection
Write-Host "[4/6] Testing database connection..." -ForegroundColor Yellow
$testResult = python -c "from connection import test_connection; import sys; sys.exit(0 if test_connection() else 1)"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Database connection failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please ensure:" -ForegroundColor Yellow
    Write-Host "  1. PostgreSQL is installed and running" -ForegroundColor Yellow
    Write-Host "  2. Database 'wildfire_prediction' exists" -ForegroundColor Yellow
    Write-Host "  3. .env file has correct credentials" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To create the database, run:" -ForegroundColor Cyan
    Write-Host "  psql -U postgres -c `"CREATE DATABASE wildfire_prediction;`"" -ForegroundColor Cyan
    Set-Location ..
    exit 1
}
Write-Host "Database connection successful" -ForegroundColor Green
Write-Host ""

# Step 5: Run migrations
Write-Host "[5/6] Running database migrations..." -ForegroundColor Yellow
Set-Location migrations
python run_migration.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "Migration failed!" -ForegroundColor Red
    Set-Location ..\..
    exit 1
}
Set-Location ..
Write-Host "Database migrations completed" -ForegroundColor Green
Write-Host ""

# Step 6: Summary
Write-Host "[6/6] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "SETUP SUMMARY" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Branch: core-database" -ForegroundColor Green
Write-Host "Environment: .env configured" -ForegroundColor Green
Write-Host "Dependencies: Installed" -ForegroundColor Green
Write-Host "Database: Connected" -ForegroundColor Green
Write-Host "Schema: Migrated" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Test the setup: python database\test_db.py" -ForegroundColor Cyan
Write-Host "  2. View documentation: database\README.md" -ForegroundColor Cyan
Write-Host "  3. Start importing data from ml-data-sources branch" -ForegroundColor Cyan
Write-Host ""

Set-Location ..
