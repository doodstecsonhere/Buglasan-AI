Get-Content '.env.local' | ForEach-Object {
  if ($_ -match '^\s*([^#=][^=]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim().Trim('"').Trim("'"), 'Process')
  }
}
$mode = if ($args.Count -gt 0) { $args[0] } else { '--acceptance' }
if ($mode -eq '--verify-cleanup') {
  node --experimental-strip-types scripts/orchestration-live.ts --verify-cleanup
  exit $LASTEXITCODE
}
npm run pipeline:acceptance
$acceptanceCode = $LASTEXITCODE
if ($acceptanceCode -ne 0) {
  npm run pipeline:cleanup
  $cleanupCode = $LASTEXITCODE
  if ($cleanupCode -ne 0) { exit $cleanupCode }
  exit $acceptanceCode
}
