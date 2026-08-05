#!/usr/bin/env bash
# E5 Street Circuit — pull the live web bundle into www/ and vendor the render libs.
# The R2 mirror is the single source of truth for the game; this script snapshots it
# into the app binary (offline core game; live rails still reach the network).
set -euo pipefail
BASE="https://pub-1dfdb97841574c448cb7657c069dbdc6.r2.dev/drivegame"
THREE="https://cdn.jsdelivr.net/npm/three@0.160.0"
mkdir -p www
grab(){ mkdir -p "www/$(dirname "$1")"; curl -fsSL --retry 3 -o "www/$1" "$BASE/$1"; echo "  $1"; }
vend(){ mkdir -p "www/vendor/$(dirname "$1")"; curl -fsSL --retry 3 -o "www/vendor/$1" "$THREE/$2"; echo "  vendor/$1"; }

echo "== app art (icon + splash sources) =="
mkdir -p assets
for a in icon-only.png splash.png splash-dark.png; do
  curl -fsSL --retry 3 -o "assets/$a" "$BASE/appicons/$a"; echo "  assets/$a"
done

echo "== game bundle =="
grab "index.html"
grab "sim.js"
grab "seatlog.js"
grab "courses.json"
grab "packs/olive_drive.json"
grab "cars_manifest.json"
grab "canonical_record.json"
grab "carbon_layer.json"
grab "parcels_live.json"
grab "records/race286.json"
grab "cars/1_10_52.gltf"
grab "cars/1_3_4.gltf"
grab "cars/1_4_6.gltf"
grab "cars/3_15_36.gltf"
grab "cars/3_335_418.gltf"
grab "cars/42_123_197.gltf"
grab "cars/48_149_223.gltf"
grab "cars/4_108_159.gltf"
grab "cars/4_109_160.gltf"
grab "cars/4_109_162.gltf"
grab "cars/fin_1115822.jpg"
grab "cars/fin_1128476.jpg"
grab "cars/fin_2833663.jpg"
grab "cars/fin_3268949.jpg"
grab "cars/fin_5688125.jpg"
grab "cars/fin_5689292.jpg"
grab "cars/fin_5694823.jpg"
grab "cars/fin_5704578.jpg"
grab "cars/fin_5730747.jpg"
grab "cars/fin_5873962.jpg"
grab "cars/fin_6396813.jpg"
grab "cars/thumb_1115822.png"
grab "cars/thumb_1128476.png"
grab "cars/thumb_2833663.png"
grab "cars/thumb_3268949.png"
grab "cars/thumb_5688125.png"
grab "cars/thumb_5689292.png"
grab "cars/thumb_5694823.png"
grab "cars/thumb_5704578.png"
grab "cars/thumb_5730747.png"
grab "cars/thumb_5873962.png"
grab "cars/thumb_6396813.png"

echo "== vendored render stack (offline + review-safe) =="
vend "three.module.js"                     "build/three.module.js"
vend "jsm/loaders/GLTFLoader.js"           "examples/jsm/loaders/GLTFLoader.js"
vend "jsm/loaders/DRACOLoader.js"          "examples/jsm/loaders/DRACOLoader.js"
vend "jsm/loaders/KTX2Loader.js"           "examples/jsm/loaders/KTX2Loader.js"
vend "jsm/utils/BufferGeometryUtils.js"    "examples/jsm/utils/BufferGeometryUtils.js"
vend "jsm/utils/WorkerPool.js"             "examples/jsm/utils/WorkerPool.js"
vend "jsm/libs/ktx-parse.module.js"        "examples/jsm/libs/ktx-parse.module.js"
vend "jsm/libs/zstddec.module.js"          "examples/jsm/libs/zstddec.module.js"
vend "jsm/libs/draco/gltf/draco_decoder.js"      "examples/jsm/libs/draco/gltf/draco_decoder.js"
vend "jsm/libs/draco/gltf/draco_decoder.wasm"    "examples/jsm/libs/draco/gltf/draco_decoder.wasm"
vend "jsm/libs/draco/gltf/draco_wasm_wrapper.js" "examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js"
vend "jsm/libs/basis/basis_transcoder.js"        "examples/jsm/libs/basis/basis_transcoder.js"
vend "jsm/libs/basis/basis_transcoder.wasm"      "examples/jsm/libs/basis/basis_transcoder.wasm"

echo "== rewire the app copy to the vendored stack =="
# Handle EVERY vendor-path family the web build has ever used (CDN and the
# uplandskin mirror). Absolute paths cannot resolve inside the app bundle.
sed -i.bak \
  -e 's#https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js#./vendor/three.module.js#g' \
  -e 's#https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/#./vendor/jsm/#g' \
  -e 's#/uplandskin/vendor/three/build/three.module.js#./vendor/three.module.js#g' \
  -e 's#/uplandskin/vendor/three/examples/jsm/#./vendor/jsm/#g' \
  -e 's#/uplandskin/vendor/draco/#./vendor/jsm/libs/draco/gltf/#g' \
  www/index.html && rm -f www/index.html.bak

echo "== sanity =="
test -s www/index.html && test -s www/sim.js && test -s www/packs/olive_drive.json
grep -q '"three": *"./vendor/three.module.js"' www/index.html || grep -q '"three":"./vendor/three.module.js"' www/index.html || { echo "importmap not vendored!"; exit 1; }
! grep -q "cdn.jsdelivr.net" www/index.html || { echo "CDN refs remain!"; exit 1; }
! grep -q "/uplandskin/" www/index.html || { echo "uplandskin absolute refs remain!"; exit 1; }
echo "bundle OK: $(du -sh www | cut -f1)"
