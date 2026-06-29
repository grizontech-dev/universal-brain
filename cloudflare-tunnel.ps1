# cloudflare-tunnel.ps1
# Script to download cloudflared and start quick tunnels for Grizon AI frontend (3000) and backend (8001).

$CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
$CLOUDFLARED_PATH = Join-Path $PSScriptRoot "cloudflared.exe"

# 1. Download cloudflared.exe if it doesn't exist
if (-not (Test-Path $CLOUDFLARED_PATH)) {
    Write-Host "Cloudflared binary not found. Downloading from Cloudflare..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $CLOUDFLARED_URL -OutFile $CLOUDFLARED_PATH
    Write-Host "Downloaded successfully to $CLOUDFLARED_PATH" -ForegroundColor Green
} else {
    Write-Host "Using existing cloudflared binary at $CLOUDFLARED_PATH" -ForegroundColor Green
}

# 2. Kill any existing cloudflared processes
Write-Host "Cleaning up old cloudflared processes..." -ForegroundColor Yellow
Stop-Process -Name "cloudflared" -ErrorAction SilentlyContinue

# 3. Create log files
$FRONTEND_LOG = Join-Path $PSScriptRoot "tunnel_frontend.log"
$BACKEND_LOG = Join-Path $PSScriptRoot "tunnel_backend.log"
Remove-Item $FRONTEND_LOG -ErrorAction SilentlyContinue
Remove-Item $BACKEND_LOG -ErrorAction SilentlyContinue

# 4. Start frontend tunnel (port 3000)
Write-Host "Starting frontend quick tunnel (port 3000)..." -ForegroundColor Cyan
Start-Process -FilePath $CLOUDFLARED_PATH -ArgumentList "tunnel", "--url", "http://localhost:3000" -RedirectStandardError $FRONTEND_LOG -NoNewWindow -PassThru

# 5. Start backend tunnel (port 8001)
Write-Host "Starting backend quick tunnel (port 8001)..." -ForegroundColor Cyan
Start-Process -FilePath $CLOUDFLARED_PATH -ArgumentList "tunnel", "--url", "http://127.0.0.1:8001" -RedirectStandardError $BACKEND_LOG -NoNewWindow -PassThru

# 6. Wait for URLs to appear in logs
Write-Host "Waiting for tunnel URLs to be assigned..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

$frontend_url = ""
$backend_url = ""

for ($i = 0; $i -lt 10; $i++) {
    if (Test-Path $FRONTEND_LOG) {
        $content = Get-Content $FRONTEND_LOG
        $match = $content | Select-String -Pattern "https://[\w-]+\.trycloudflare\.com"
        if ($match) {
            $frontend_url = [regex]::Match($match.Line, "https://[\w-]+\.trycloudflare\.com").Value
        }
    }
    if (Test-Path $BACKEND_LOG) {
        $content = Get-Content $BACKEND_LOG
        $match = $content | Select-String -Pattern "https://[\w-]+\.trycloudflare\.com"
        if ($match) {
            $backend_url = [regex]::Match($match.Line, "https://[\w-]+\.trycloudflare\.com").Value
        }
    }
    if ($frontend_url -and $backend_url) {
        break
    }
    Start-Sleep -Seconds 2
}

if ($frontend_url -and $backend_url) {
    Write-Host "`n==================================================" -ForegroundColor Green
    Write-Host "TUNNEL CREATED SUCCESSFULLY!" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "Frontend Tunnel URL : $frontend_url" -ForegroundColor Green
    Write-Host "Backend Tunnel URL  : $backend_url" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "`nUpdate the following environment variables in backend .env:" -ForegroundColor Yellow
    Write-Host "FRONTEND_URL=$frontend_url" -ForegroundColor Yellow
    Write-Host "API_BASE_URL=$backend_url" -ForegroundColor Yellow
    Write-Host "SUPABASE_REDIRECT_URI=$backend_url/connect-supabase/oauth2/callback" -ForegroundColor Yellow
    Write-Host "`nUpdate the redirect URI in your Supabase App settings to:" -ForegroundColor Cyan
    Write-Host "$backend_url/connect-supabase/oauth2/callback" -ForegroundColor Cyan
} else {
    Write-Host "Failed to retrieve tunnel URLs. Please check logs:" -ForegroundColor Red
    Write-Host "Frontend Log: $FRONTEND_LOG" -ForegroundColor Red
    Write-Host "Backend Log: $BACKEND_LOG" -ForegroundColor Red
}
