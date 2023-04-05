#!/bin/bash

NODE_MODULES="./node_modules"

if [ ! -d "$NODE_MODULES" ]; then
  echo Setting up the dependencies...
  npm install
  npm install electron-rebuild
  npx electron-rebuild
  echo Successfully installed dependencies!
  echo Please rerun this script to run the app!
  exit
fi

npx electron .