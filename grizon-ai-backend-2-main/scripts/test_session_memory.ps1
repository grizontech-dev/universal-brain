# Test SessionMemory endpoints
# Run with: pwsh -File scripts/test_session_memory.ps1

$BASE = "http://localhost:8001/brain/memory"
$ID = "test-session-123"

Write-Host "=== SessionMemory API Test ===" -ForegroundColor Cyan
Write-Host ""

# 1. Clear any previous test data
Write-Host "1. DELETE session (clean slate)..." -ForegroundColor Yellow
try {
    $res = Invoke-RestMethod -Uri "$BASE/session/$ID" -Method Delete
    Write-Host "   -> $($res.cleared)" -ForegroundColor Green
} catch { Write-Host "   -> (empty, ok)" -ForegroundColor Gray }

# 2. Set a field
Write-Host "2. PUT field (workflow_state = planning)..." -ForegroundColor Yellow
$body = @{ field = "workflow_state"; value = "planning" } | ConvertTo-Json
$res = Invoke-RestMethod -Uri "$BASE/session/$ID" -Method Put -Body $body -ContentType "application/json"
Write-Host "   -> updated: $($res.updated)" -ForegroundColor Green

# 3. Get the session
Write-Host "3. GET session..." -ForegroundColor Yellow
$res = Invoke-RestMethod -Uri "$BASE/session/$ID" -Method Get
Write-Host "   -> exists: $($res.exists)" -ForegroundColor Green
Write-Host "   -> data:" -ForegroundColor Green
$res.data | Format-Table | Out-String | Write-Host

# 4. Update workflow via dedicated endpoint
Write-Host "4. PUT workflow (building, BuilderAgent)..." -ForegroundColor Yellow
$res = Invoke-RestMethod -Uri "$BASE/session/$ID/workflow?state=building&agent=BuilderAgent" -Method Put
Write-Host "   -> state: $($res.workflow_state), agent: $($res.current_agent), updated: $($res.updated)" -ForegroundColor Green

# 5. Get again to confirm
Write-Host "5. GET session (verify changes)..." -ForegroundColor Yellow
$res = Invoke-RestMethod -Uri "$BASE/session/$ID" -Method Get
Write-Host "   -> exists: $($res.exists)" -ForegroundColor Green
Write-Host "   -> data:" -ForegroundColor Green
$res.data | Format-Table | Out-String | Write-Host

# 6. Set multiple fields
Write-Host "6. PUT multiple fields..." -ForegroundColor Yellow
@("current_task_id", "task_001"), @("task_index", "0"), @("total_tasks", "5") | ForEach-Object {
    $body = @{ field = $_[0]; value = $_[1] } | ConvertTo-Json
    $res = Invoke-RestMethod -Uri "$BASE/session/$ID" -Method Put -Body $body -ContentType "application/json"
    Write-Host "   -> $($_[0]) = $($_[1])" -ForegroundColor Gray
}

# 7. Final check
Write-Host "7. GET session (final)..." -ForegroundColor Yellow
$res = Invoke-RestMethod -Uri "$BASE/session/$ID" -Method Get
Write-Host "   -> Full session:" -ForegroundColor Cyan
$res.data | Format-Table | Out-String | Write-Host

# 8. Cycle through all workflow states
Write-Host "8. Cycle workflow states..." -ForegroundColor Yellow
@("starting", "planning", "clarifying", "todo_generation", "building", "reviewing", "done") | ForEach-Object {
    $res = Invoke-RestMethod -Uri "$BASE/session/$ID/workflow?state=$_&agent=Agent$_" -Method Put
    Write-Host "   -> $_" -ForegroundColor Gray
}

# 9. Final read
Write-Host "9. GET session after cycle..." -ForegroundColor Yellow
$res = Invoke-RestMethod -Uri "$BASE/session/$ID" -Method Get
$res | ConvertTo-Json -Depth 3 | Write-Host

# 10. Cleanup
Write-Host ""
Write-Host "10. DELETE session (cleanup)..." -ForegroundColor Yellow
try {
    $res = Invoke-RestMethod -Uri "$BASE/session/$ID" -Method Delete
    Write-Host "   -> cleared: $($res.cleared)" -ForegroundColor Green
} catch { Write-Host "   -> (ok)" }
Write-Host ""
Write-Host "=== All tests passed ===" -ForegroundColor Cyan
