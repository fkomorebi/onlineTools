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
$wf = Get-Content $wfPath -Raw

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
if ($bad -gt 0) { exit 1 } else { exit 0 }
