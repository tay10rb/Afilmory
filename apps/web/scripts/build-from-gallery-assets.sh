#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
git clone --depth 1 --branch main https://github.com/tay10rb/gallery-assets.git assets-git

mkdir -p src/data
ln -s ../../assets-git/photos-manifest.json src/data/photos-manifest.json
ln -s ../assets-git/thumbnails public/thumbnails

cd ../..
pnpm --filter @afilmory/web exec vite build
