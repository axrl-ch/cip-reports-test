# publish.ps1 - generate reports, build the site, and push it to GitHub Pages.
# Run it by hand or from Task Scheduler. It publishes to THIS repo (its own git remote),
# so the push target is simply whichever repo this script lives in. To change the target
# later, drop this file + build-index.js into the new repo clone; nothing else changes.
$ErrorActionPreference = "Stop"

# ---- edit these ----
$base   = "C:\cip-workspace"          # parent folder holding one subfolder per track (local report data)
$tracks = @("partner")                # add "customer","prospect" once their accounts are configured
$claude = "claude"                    # full path to claude.exe if it is not on the scheduled PATH
# --------------------

$repo = $PSScriptRoot                  # this repo clone (contains build-index.js and docs/)

# 1) GENERATE - run the skill once per track, each in its own workspace so nothing collides
foreach ($t in $tracks) {
  $env:CIP_WORKDIR = Join-Path $base $t
  & $claude -p "Run the $t Commercial Intelligence Program, --track $t"
}

# 2) BUILD - turn all per-track reports into the static site under docs/
$env:CIP_WORKDIR  = $base
$env:CIP_SITE_DIR = Join-Path $repo "docs"
node (Join-Path $repo "build-index.js")

# 3) PUSH - publish docs/ to GitHub (Pages redeploys automatically)
Set-Location $repo
git add docs
git diff --cached --quiet
if (-not $?) {
  git commit -m "reports $(Get-Date -Format yyyy-MM-dd)"
  git push
  Write-Host "Published to $(git remote get-url origin)"
} else {
  Write-Host "No changes to publish."
}
