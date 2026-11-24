# Verify that every GitHub Action used in the deploy workflow is off Node.js 20.
#
# Background: GitHub deprecated the Node.js 20 runtime on Actions runners
# (2025-09-19). Any action still targeting node20 emits a deprecation warning
# in the build log. This script fetches each action's action.yml and reads its
# `runs.using` field; for composite actions it also checks the sub-actions
# they invoke.
#
# Usage:  npm run test:actions
# Exit:   0 = all actions are node24+; 1 = at least one still uses node20
#
# NOTE: kept ASCII-only on purpose so it runs under both Windows PowerShell 5.1
# and PowerShell 7 (5.1 reads BOM-less files as ANSI and would mangle UTF-8).

$hdr = @{ 'User-Agent' = 'dsh' }

function Get-ActionYml($owner, $repo, $ref) {
  try {
    $url = "https://raw.githubusercontent.com/$owner/$repo/$ref/action.yml"
    $r = Invoke-WebRequest -Uri $url -Headers $hdr -UseBasicParsing
    return $r.Content
  } catch {
    return $null
  }
}

function Get-Runtime($owner, $repo, $ref) {
  $txt = Get-ActionYml $owner $repo $ref
  if ($null -eq $txt) { return 'ERR' }
  foreach ($line in ($txt -split "`n")) {
    $t = $line.Trim()
    if ($t.StartsWith('using:')) {
      return $t.Substring(6).Trim().Trim("'", '"')
    }
  }
  return '?'
}

$wfPath = Join-Path $PSScriptRoot '..\.github\workflows\deploy.yml'
# Read as UTF-8 explicitly: Windows PowerShell 5.1 otherwise decodes the file
# with the ANSI code page and mangles the Chinese comments, which can corrupt
# the line structure the parser below relies on.
$wf = [System.IO.File]::ReadAllText($wfPath, [System.Text.Encoding]::UTF8)

# ---------------------------------------------------------------------------
# Structural check.
#
# The Pages artifact must be uploaded in a DIFFERENT job from the one that
# deploys it. actions/deploy-pages looks the artifact up through the artifact
# metadata API, scoped to the current workflow run. When the upload and the
# deploy live in the same job, the freshly uploaded artifact is sometimes not
# yet visible to that API and the deploy fails with:
#
#   No artifacts named "github-pages" were found for this workflow run.
#
# Splitting the two into separate jobs joined by `needs:` is the shape
# GitHub's own Pages starter workflow uses, and it removes the race.
# ---------------------------------------------------------------------------
$structErrors = @()

$jobNames = @()
$jobBlocks = @{}
$curJob = $null
$inJobs = $false

foreach ($l in ($wf -split "`n")) {
  $t = $l.Trim().TrimEnd("`r")
  if ($t -eq '') { continue }                # blank lines carry no indent info
  if ($t.StartsWith('#')) { continue }       # comment lines are skipped everywhere
  $indent = $l.Length - $l.TrimStart().Length

  if ($t -eq 'jobs:') { $inJobs = $true; continue }
  if (-not $inJobs) { continue }
  if ($indent -eq 0) { $inJobs = $false; continue }   # left the jobs: block

  if ($indent -eq 2 -and $t.EndsWith(':')) {
    $curJob = $t.TrimEnd(':')
    $jobNames += $curJob
    $jobBlocks[$curJob] = @{ needs = ''; steps = @() }
    continue
  }
  if (-not $curJob) { continue }

  if ($indent -eq 4 -and $t.StartsWith('needs:')) {
    $jobBlocks[$curJob].needs = $t.Substring(6).Trim()
    continue
  }
  if ($indent -eq 6 -and $t.StartsWith('- name:')) {
    $jobBlocks[$curJob].steps += $t.Substring(8).Trim()
    continue
  }
}

'Workflow structure:'
foreach ($j in $jobNames) {
  '  job {0}{1}' -f $j, $(if ($jobBlocks[$j].needs) { '  (needs: ' + $jobBlocks[$j].needs + ')' } else { '' })
  foreach ($s in $jobBlocks[$j].steps) { '      - ' + $s }
}

if ($jobNames -notcontains 'build') { $structErrors += 'missing build job' }
if ($jobNames -notcontains 'deploy') { $structErrors += 'missing deploy job' }

if ($jobNames -contains 'deploy') {
  $d = $jobBlocks['deploy']
  if (-not $d.needs) {
    $structErrors += 'deploy job has no needs:'
  } elseif ($d.needs -notmatch '\bbuild\b') {
    $structErrors += 'deploy needs: does not point at build'
  }
  if ($d.steps -contains 'Upload artifact') {
    $structErrors += 'deploy job uploads the artifact (must be a separate job)'
  }
  if ($d.steps -notcontains 'Deploy to GitHub Pages') {
    $structErrors += 'deploy job has no Deploy step'
  }
}

if ($jobNames -contains 'build') {
  $b = $jobBlocks['build']
  if ($b.steps -notcontains 'Upload artifact') {
    $structErrors += 'build job has no Upload artifact step'
  }
  if ($b.steps -contains 'Deploy to GitHub Pages') {
    $structErrors += 'build job deploys (must be a separate job)'
  }
}

# Required permissions for the Pages OIDC deployment.
foreach ($p in @('contents: read', 'pages: write', 'id-token: write')) {
  if ($wf -notmatch [regex]::Escape($p)) { $structErrors += "missing permission: $p" }
}
if ($wf -notmatch 'name:\s*github-pages') {
  $structErrors += 'missing github-pages environment'
}

if ($structErrors.Count) {
  foreach ($e in $structErrors) { '  <== ' + $e }
} else {
  '  OK: build/deploy are separate jobs, deploy needs build'
}

# Only look at real code lines, not the commented usage examples.
$inCode = ($wf -split "`n") | Where-Object { $_ -notmatch '^\s*#' }
$refs = @()
foreach ($l in $inCode) {
  foreach ($m in [regex]::Matches($l, 'uses:\s*([^\s#]+)')) { $refs += $m.Groups[1].Value }
}

$bad = 0
foreach ($ref in $refs) {
  if ($ref -like './*' -or $ref -like 'docker://*') {
    '  {0,-45} local/custom' -f $ref
    continue
  }

  # Split "owner/repo@ref" into owner, repo and ref.
  $at = $ref -split '@'
  $path = $at[0]
  $ver = if ($at.Count -gt 1) { $at[1] } else { 'main' }
  $seg = $path -split '/'
  $owner = $seg[0]
  $repo = $seg[1]

  $rt = Get-Runtime $owner $repo $ver
  $note = ''
  if ($rt -eq 'node20') {
    $note = '  <== node20, will emit the deprecation warning'
    $bad++
  }
  elseif ($rt -eq 'composite') {
    $txt = Get-ActionYml $owner $repo $ver
    $deps = @()
    if ($txt) {
      foreach ($m in [regex]::Matches($txt, 'uses:\s*([^\s]+)')) {
        $sub = $m.Groups[1].Value
        if ($sub -like 'actions/*') {
          $sa = $sub -split '@'
          $sp = $sa[0] -split '/'
          $sv = if ($sa.Count -gt 1) { $sa[1] } else { 'main' }
          $srt = Get-Runtime $sp[0] $sp[1] $sv
          $deps += ('{0}@{1}({2})' -f $sp[1], $sv, $srt)
          if ($srt -eq 'node20') { $bad++ }
        }
      }
    }
    $note = '  [composite -> ' + ($deps -join ', ') + ']'
  }
  '  {0,-45} {1}{2}' -f $ref, $rt, $note
}

''
'Result: {0} action(s) checked, {1} still depend on node20' -f $refs.Count, $bad
if ($structErrors.Count) {
  'Structure: {0} problem(s) found' -f $structErrors.Count
  exit 1
}
'Structure: OK'
if ($bad -gt 0) { exit 1 } else { exit 0 }
