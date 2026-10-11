#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Build if dist doesn't exist or dist-electron is missing
if [ ! -d "dist" ] || [ ! -d "dist-electron" ]; then
  npm run build
fi

# Launch Focus
./node_modules/.bin/electron .
