@echo off
setlocal
if exist "%~dp0CodeDeck.exe" goto packaged
node "%~dp0..\dist-electron\electron\agent-cli.js" %*
exit /b %ERRORLEVEL%

:packaged
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0CodeDeck.exe" "%~dp0resources\app.asar\dist-electron\electron\agent-cli.js" %*
exit /b %ERRORLEVEL%
