@echo off
if not exist "./node_modules" (
  echo Setting up the dependencies...
  npm install
  npm install electron-rebuild
  npx electron-rebuild
  echo Successfully installed dependencies!
  echo Please rerun this script to run the app!
  pause
  exit
)

npx electron .