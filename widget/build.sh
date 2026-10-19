#!/bin/sh
# Genera el widget: extensión (Chrome/Safari) en extension/ y userscript en conquepago.user.js
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('./extension/manifest.json').version")
npx -y esbuild@0.24.0 src/widget.js --bundle --format=iife --target=safari15,chrome100 \
  --loader:.css=text --minify --legal-comments=none --outfile=extension/content.js
cp ../icon-192.png extension/icon-128.png
sips -z 48 48 ../icon-192.png --out extension/icon-48.png >/dev/null 2>&1 || cp ../icon-192.png extension/icon-48.png
{
  cat <<HDR
// ==UserScript==
// @name         ¿Con qué pago?
// @namespace    https://carcaa.github.io/conquepago/
// @version      $VERSION
// @description  Te dice con qué billetera o tarjeta conviene pagar en la tienda online donde estás.
// @match        *://*/*
// @exclude      *://carcaa.github.io/*
// @run-at       document-idle
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @connect      carcaa.github.io
// @updateURL    https://carcaa.github.io/conquepago/widget/conquepago.user.js
// @downloadURL  https://carcaa.github.io/conquepago/widget/conquepago.user.js
// ==/UserScript==
HDR
  cat extension/content.js
} > conquepago.user.js
ls -la extension conquepago.user.js
