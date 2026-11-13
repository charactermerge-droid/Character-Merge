# Deploys the fusion server to Google Cloud Run, reading its catalog from the Google Sheet.
#
#   .\deploy-cloudrun.ps1 -Project <gcp-project-id> [-Region asia-south1]
#
# Safe to re-run: it creates what is missing and redeploys. Prerequisites (one-time, see
# docs/cloud-run-and-google-sheet.md): gcloud installed + `gcloud auth login`, and billing
# linked to the project.
#
# No service-account KEY is created. The service runs AS the fusion-server service account,
# and Google's client libraries pick that identity up automatically.
param(
    [Parameter(Mandatory = $true)] [string] $Project,
    [string] $Region = 'asia-south1',
    [string] $Service = 'fusion-server',
    [string] $SheetId = '1UfYZ1OclLClZyjYr330JikW95HbJdO5uDnBjA69edWk',
    [string] $Storage = 'local',      # placeholder videos ship inside the container
    [int]    $MaxInstances = 2        # hard cap on scale-out, so cost can never run away
)
# Not 'Stop': in Windows PowerShell 5.1 gcloud's normal stderr progress output would become a
# terminating error. Failures are caught explicitly through $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args -join ' ') failed ($LASTEXITCODE)" } }

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    # The per-user installer cannot always update PATH; use its default location.
    $sdkBin = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin'
    if (Test-Path (Join-Path $sdkBin 'gcloud.cmd')) { $env:Path = "$sdkBin;$env:Path" }
    else { throw 'gcloud not found. Install the Google Cloud CLI, then run: gcloud auth login' }
}
$account = (& gcloud config get-value account 2>$null)
if (-not $account) { throw 'Not signed in. Run: gcloud auth login' }
Write-Host "gcloud account: $account   project: $Project   region: $Region"

Step 'Selecting project'
Gcloud config set project $Project --quiet | Out-Null
# Needed to read billing status; unlike the APIs below it can be enabled before billing exists.
Gcloud services enable cloudbilling.googleapis.com --quiet
$billing = (& gcloud billing projects describe $Project --format='value(billingEnabled)' 2>$null)
if ($billing -ne 'True') {
    throw "Billing is not enabled on $Project. Cloud Run needs a billing account linked even for free-tier use: https://console.cloud.google.com/billing/linkedaccount?project=$Project"
}

Step 'Enabling APIs (Cloud Run, Cloud Build, Artifact Registry, Sheets)'
Gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com sheets.googleapis.com --quiet

$saName = 'fusion-server'
$saEmail = "$saName@$Project.iam.gserviceaccount.com"
Step "Service account $saEmail"
& gcloud iam service-accounts describe $saEmail --format='value(email)' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Gcloud iam service-accounts create $saName --display-name 'Fusion server (reads the content sheet)' --quiet
} else { Write-Host 'exists' }

# Secrets are generated once and reused, so redeploys do not invalidate signed URLs or the admin secret.
# With more than one instance, every instance must share the signing secret.
$secretsFile = Join-Path $PSScriptRoot '.cloudrun-secrets.json'
if (Test-Path $secretsFile) {
    $secrets = Get-Content $secretsFile -Raw | ConvertFrom-Json
} else {
    $rand = {
        $bytes = New-Object byte[] 48
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes); $rng.Dispose()
        -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
    }
    $secrets = [pscustomobject]@{ adminSecret = (& $rand); signingSecret = (& $rand) }
    $secrets | ConvertTo-Json | Set-Content $secretsFile -Encoding utf8
    Write-Host "Generated secrets -> $secretsFile (gitignored; keep it)"
}

$envVars = @(
    'SHEET_SOURCE=google', "SHEET_ID=$SheetId", "GOOGLE_SA_EMAIL=$saEmail",
    "STORAGE=$Storage", "ADMIN_SECRET=$($secrets.adminSecret)", "LOCAL_SIGNING_SECRET=$($secrets.signingSecret)",
    'SHEET_REFRESH_SECONDS=300'
) -join ','

Step "Building from source and deploying $Service (a few minutes the first time)"
Gcloud run deploy $Service --source . --region $Region --service-account $saEmail `
    --allow-unauthenticated --min-instances 0 --max-instances $MaxInstances --memory 512Mi --cpu 1 `
    --set-env-vars $envVars --quiet

$url = (& gcloud run services describe $Service --region $Region --format='value(status.url)')
Step "Pointing signed URLs at $url"
# The server bakes this into every signed thumbnail/video URL, so it must be the public HTTPS URL.
Gcloud run services update $Service --region $Region --update-env-vars "PUBLIC_BASE_URL=$url" --quiet

Step 'Health check'
try {
    $h = Invoke-RestMethod "$url/health" -TimeoutSec 60
    Write-Host ($h | ConvertTo-Json -Compress)
} catch {
    Write-Warning "Health check failed: $($_.Exception.Message)"
    Write-Warning "If the log says the sheet is not shared: share the sheet with $saEmail as Viewer, then rerun."
    Write-Warning "Logs: gcloud run services logs read $Service --region $Region --limit 50"
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  Server:         $url"
Write-Host "  Share sheet with (Viewer): $saEmail"
Write-Host "  Unity:          FusionConfig > Staging > Server Origin = $url, Environment = Staging"
Write-Host "  Admin refresh:  curl -X POST $url/admin/refresh -H `"x-admin-secret: <adminSecret from .cloudrun-secrets.json>`""
