@echo off
setlocal

REM Configurable service names (override before running if needed)
if "%PG_SERVICE_NAME%"=="" set "PG_SERVICE_NAME=postgresql-x64-16"
if "%REDIS_SERVICE_NAME%"=="" set "REDIS_SERVICE_NAME=Redis"
if "%REDIS_URL%"=="" set "REDIS_URL=redis://127.0.0.1:6379"
if "%INSTALL_MISSING%"=="" set "INSTALL_MISSING=true"

echo [0/4] Ensuring PostgreSQL and Redis are installed...
where pg_isready >nul 2>&1
if errorlevel 1 (
  echo PostgreSQL client tools not found in PATH.
  if /I "%INSTALL_MISSING%"=="true" (
    where winget >nul 2>&1
    if not errorlevel 1 (
      echo Attempting install: winget install -e --id PostgreSQL.PostgreSQL
      winget install -e --id PostgreSQL.PostgreSQL --silent
    ) else (
      where choco >nul 2>&1
      if not errorlevel 1 (
        echo Attempting install: choco install postgresql -y
        choco install postgresql -y
      ) else (
        echo WARNING: No winget/choco found. Install PostgreSQL manually.
      )
    )
  )
)

where redis-cli >nul 2>&1
if errorlevel 1 (
  echo Redis CLI not found in PATH.
  if /I "%INSTALL_MISSING%"=="true" (
    where winget >nul 2>&1
    if not errorlevel 1 (
      echo Attempting install: winget install -e --id Memurai.MemuraiDeveloper
      winget install -e --id Memurai.MemuraiDeveloper --silent
    ) else (
      where choco >nul 2>&1
      if not errorlevel 1 (
        echo Attempting install: choco install redis-64 -y
        choco install redis-64 -y
      ) else (
        echo WARNING: No winget/choco found. Install Redis manually.
      )
    )
  )
)

echo [1/4] Starting PostgreSQL service: %PG_SERVICE_NAME%
net start "%PG_SERVICE_NAME%" >nul 2>&1
if errorlevel 1 (
  echo WARNING: Could not start PostgreSQL service "%PG_SERVICE_NAME%".
  echo Ensure PostgreSQL is installed as a Windows service.
) else (
  echo PostgreSQL service started.
)

echo [2/4] Starting Redis service: %REDIS_SERVICE_NAME%
net start "%REDIS_SERVICE_NAME%" >nul 2>&1
if errorlevel 1 (
  echo WARNING: Could not start Redis service "%REDIS_SERVICE_NAME%".
  echo Ensure Redis is installed as a Windows service.
) else (
  echo Redis service started.
)

echo [3/4] Checking PostgreSQL health...
where pg_isready >nul 2>&1
if errorlevel 1 (
  echo WARNING: pg_isready not found in PATH. Skipping PostgreSQL health check.
) else (
  pg_isready -h 127.0.0.1 -p 5432
)

echo [4/4] Checking Redis health...
where redis-cli >nul 2>&1
if errorlevel 1 (
  echo WARNING: redis-cli not found in PATH. Skipping Redis health check.
) else (
  redis-cli -u "%REDIS_URL%" ping
)

echo Tip: set INSTALL_MISSING=false to skip install attempts.
echo Done.
endlocal
