$values = @{}
Get-Content '.env.local' | ForEach-Object {
  if ($_ -match '^\s*([^#=][^=]*)=(.*)$') { $values[$Matches[1].Trim()] = $Matches[2].Trim().Trim('"').Trim("'") }
}
$required = @('SUPABASE_URL','SUPABASE_EXPECTED_PROJECT_REF','SUPABASE_SECRET_KEYS','SUPABASE_PUBLISHABLE_KEY','LIVE_PIPELINE_ACCEPTANCE_TEST','PIPELINE_ACCEPTANCE_FIXTURE_TOKEN','EXTRACT_SOURCE_TOKEN','INDEX_SOURCE_TOKEN','RECONCILE_EVENT_TOKEN','GEMINI_API_KEY')
foreach ($name in $required) { if ([string]::IsNullOrWhiteSpace($values[$name])) { throw "Missing required process env name: $name" } }
$ref = ([Uri]$values.SUPABASE_URL).Host.Split('.')[0]
if ($ref -ne $values.SUPABASE_EXPECTED_PROJECT_REF -or $ref -ne 'uelezensmkxfyexcwqzb') { throw 'SUPABASE_EXPECTED_PROJECT_REF does not match SUPABASE_URL' }
if ($values.LIVE_PIPELINE_ACCEPTANCE_TEST -ne 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION') { throw 'LIVE_PIPELINE_ACCEPTANCE_TEST is not exact' }
if (-not ($values.SUPABASE_SECRET_KEYS | ConvertFrom-Json).default) { throw 'SUPABASE_SECRET_KEYS.default missing' }
$tokens = @($values.PIPELINE_ACCEPTANCE_FIXTURE_TOKEN,$values.EXTRACT_SOURCE_TOKEN,$values.INDEX_SOURCE_TOKEN,$values.RECONCILE_EVENT_TOKEN)
if (($tokens | Select-Object -Unique).Count -ne $tokens.Count) { throw 'Pipeline fixture and worker tokens are not distinct' }
'ENV_GATES=PASS'; "PROJECT_REF=$ref"; 'TOKENS_DISTINCT=PASS'
