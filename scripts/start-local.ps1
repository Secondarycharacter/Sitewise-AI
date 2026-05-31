# FAM 로컬 개발 서버 실행
$Root = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $Root "apps\api"
$WebDir = Join-Path $Root "apps\web"

if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
    Write-Host ".env 파일을 생성했습니다."
}

# 기존 Python/Node 서버 정리 (포트 충돌 방지)
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Remove-Item Env:FAM_DEMO_MODE -ErrorAction SilentlyContinue

Write-Host "Backend: http://127.0.0.1:8000"
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$ApiDir'; pip install -r requirements.txt -q; Remove-Item Env:FAM_DEMO_MODE -ErrorAction SilentlyContinue; python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
)

Start-Sleep -Seconds 2

Write-Host "Frontend: http://localhost:3000 (사용 중이면 3001)"
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$WebDir'; if (-not (Test-Path node_modules)) { npm install }; npm run dev"
)

Write-Host ""
Write-Host "브라우저에서 프론트 URL을 열고 지번 입력 후 [분석]을 클릭하세요."
Write-Host "API 문서: http://127.0.0.1:8000/docs"
