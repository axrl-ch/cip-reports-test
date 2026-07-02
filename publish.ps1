# publish.ps1 - generate CIP reports (the skill runs in YOUR own workspace), build the site,
# and push it to the hardcoded reports repo. This script can live anywhere; it manages the repo
# clone itself. The skill's workspace and the reports repo are independent - only $repoUrl/$repoDir
# decide where the site is published. To change the target later, edit those two lines.
$ErrorActionPreference = "Stop"

# ---- settings ----
$repoUrl = "https://github.com/axrl-ch/cip-reports-test.git"   # target repo (change later)
$repoDir = "C:\cip-reports-test"                                # local clone (anywhere)
$base    = "C:\cip-workspace"                                   # skill workspace parent (anywhere; one subfolder per track)
$tracks  = @("partner")                                         # add "customer","prospect" when configured
$claude  = "claude"                                             # full path to claude.exe if not on the scheduled PATH
# ------------------

# Make sure the reports repo is present and up to date (clone on first run)
if (-not (Test-Path (Join-Path $repoDir ".git"))) { git clone $repoUrl $repoDir } else { git -C $repoDir pull --ff-only }

# 1) GENERATE - the skill runs in YOUR workspace, not in the repo
foreach ($t in $tracks) {
  $env:CIP_WORKDIR = Join-Path $base $t
  & $claude -p "Run the $t Commercial Intelligence Program, --track $t"
}

# 2) BUILD - render every per-track report into the repo's docs/
$env:CIP_WORKDIR  = $base
$env:CIP_SITE_DIR = Join-Path $repoDir "docs"
node (Join-Path $repoDir "build-index.js")

# 3) PUSH - publish to the hardcoded repo (GitHub Pages redeploys automatically)
git -C $repoDir add docs
git -C $repoDir diff --cached --quiet
if (-not $?) {
  git -C $repoDir commit -m "reports $(Get-Date -Format yyyy-MM-dd)"
  git -C $repoDir push
  Write-Host "Published to $repoUrl"
} else {
  Write-Host "No changes to publish."
}
