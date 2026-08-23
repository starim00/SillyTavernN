[CmdletBinding()]
param(
  [string]$NasHost = "192.168.50.244",
  [string]$NasUser = "hutiance",
  [string]$DeployDirectory = "/volume1/docker/sillytavern-n/app",
  [string]$GitProxy = "http://127.0.0.1:7890",
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Assert-Matches {
  param(
    [Parameter(Mandatory)] [string]$Value,
    [Parameter(Mandatory)] [string]$Pattern,
    [Parameter(Mandatory)] [string]$Name
  )

  if ($Value -notmatch $Pattern) {
    throw "Invalid $Name value: $Value"
  }
}

Assert-Matches $NasHost '^[A-Za-z0-9.-]+$' 'NasHost'
Assert-Matches $NasUser '^[A-Za-z0-9_-]+$' 'NasUser'
Assert-Matches $DeployDirectory '^/[A-Za-z0-9_./@-]+$' 'DeployDirectory'
Assert-Matches $GitProxy '^https?://[A-Za-z0-9.:-]+$' 'GitProxy'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$branch = git -C $repositoryRoot branch --show-current
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
  throw "Run this script from the SillyTavernN main branch."
}

$localChanges = git -C $repositoryRoot status --porcelain
if ($LASTEXITCODE -ne 0 -or $localChanges) {
  throw "The local worktree must be clean before updating the NAS."
}

git -C $repositoryRoot fetch --no-tags origin main
if ($LASTEXITCODE -ne 0) {
  throw "Could not refresh origin/main before updating the NAS."
}
$localRevision = git -C $repositoryRoot rev-parse HEAD
$remoteRevision = git -C $repositoryRoot rev-parse origin/main
if ($localRevision -ne $remoteRevision) {
  throw "Local main must exactly match origin/main. Commit, pull, or push first."
}

$checkOnlyValue = if ($CheckOnly) { '1' } else { '0' }
$remoteScript = @"
set -euo pipefail

DEPLOY_DIR='$DeployDirectory'
GIT_PROXY='$GitProxy'
CHECK_ONLY='$checkOnlyValue'
PROJECT_NAME='sillytavern-n'
PANEL_DB='/volume1/@appstore/com.ugreen.docker/db/docker_info_log.db'

cd "`$DEPLOY_DIR"

if [ "`$(git branch --show-current)" != 'main' ]; then
  echo 'NAS checkout is not on main.' >&2
  exit 1
fi

if [ -n "`$(git status --porcelain --untracked-files=no)" ]; then
  echo 'NAS checkout has tracked local changes; refusing to overwrite them.' >&2
  git status --short
  exit 1
fi

before_revision="`$(git rev-parse --short HEAD)"
echo "Current NAS revision: `$before_revision"

if [ "`$CHECK_ONLY" != '1' ]; then
  git -c http.proxy="`$GIT_PROXY" fetch --no-tags origin main
  git merge --ff-only origin/main
  docker compose config --quiet
  docker compose build
  docker compose up -d
fi

expected_services="`$(docker compose config --services | wc -l)"
attempt=1
while [ "`$attempt" -le 30 ]; do
  healthy_services=0
  for service in `$(docker compose config --services); do
    container_id="`$(docker compose ps -q "`$service")"
    if [ -z "`$container_id" ]; then
      continue
    fi
    state="`$(docker inspect "`$container_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
    if [ "`$state" = 'healthy' ] || [ "`$state" = 'running' ]; then
      healthy_services=`$((healthy_services + 1))
    fi
  done
  if [ "`$healthy_services" -eq "`$expected_services" ]; then
    break
  fi
  if [ "`$attempt" -eq 30 ]; then
    docker compose ps
    docker compose logs --no-color --tail=80
    echo 'Services did not become healthy in time.' >&2
    exit 1
  fi
  sleep 5
  attempt=`$((attempt + 1))
done

curl --fail --silent --show-error --output /dev/null http://127.0.0.1:4173/
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:4711/health

server_id="`$(docker compose ps -q server)"
data_mount="`$(docker inspect "`$server_id" --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}')"
if [ "`$data_mount" != "`$DEPLOY_DIR/data" ]; then
  echo "Unexpected data mount: `$data_mount" >&2
  exit 1
fi

panel_count="`$(sqlite3 -readonly "`$PANEL_DB" "SELECT COUNT(*) FROM compose WHERE name='sillytavern-n' AND path='`$DEPLOY_DIR/compose.yaml';")"
if [ "`$panel_count" != '1' ]; then
  echo 'The project is missing or duplicated in the UGREEN Docker panel database.' >&2
  exit 1
fi

after_revision="`$(git rev-parse --short HEAD)"
docker compose ps
echo "NAS update verified: `$before_revision -> `$after_revision"
echo "Data mount verified: `$data_mount"
echo 'UGREEN Docker panel registration verified.'
"@

$encodedScript = [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes($remoteScript)
)
$sshTarget = "$NasUser@$NasHost"

& ssh $sshTarget "echo '$encodedScript' | base64 -d | bash"
if ($LASTEXITCODE -ne 0) {
  throw "NAS update failed with exit code $LASTEXITCODE."
}
