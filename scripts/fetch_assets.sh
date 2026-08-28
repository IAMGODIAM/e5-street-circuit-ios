#!/usr/bin/env bash
# Stage an upstream mirror snapshot for review. This never modifies the signed release bundle.
set -euo pipefail

if [ "${ALLOW_RELEASE_REFRESH:-0}" != "1" ]; then
  echo "Refusing mutable network refresh. Run 'npm run stage:upstream' and review the staged diff." >&2
  exit 2
fi

BASE="https://pub-1dfdb97841574c448cb7657c069dbdc6.r2.dev/drivegame"
THREE="https://cdn.jsdelivr.net/npm/three@0.160.0"
STAGE_ROOT="${UPSTREAM_STAGE_DIR:-review/upstream-release}"

case "$STAGE_ROOT" in
  ""|/|.|..|www|ios) echo "Unsafe staging target: $STAGE_ROOT" >&2; exit 2 ;;
esac
if [ -e "$STAGE_ROOT" ]; then
  echo "Staging target already exists: $STAGE_ROOT (move or rename it before retrying)." >&2
  exit 2
fi

WEB_DEST="$STAGE_ROOT/www"
ASSET_DEST="$STAGE_ROOT/assets"
mkdir -p "$WEB_DEST" "$ASSET_DEST"

grab() {
  mkdir -p "$WEB_DEST/$(dirname "$1")"
  curl -fsSL --retry 3 -o "$WEB_DEST/$1" "$BASE/$1"
}
vend() {
  mkdir -p "$WEB_DEST/vendor/$(dirname "$1")"
  curl -fsSL --retry 3 -o "$WEB_DEST/vendor/$1" "$THREE/$2"
}

for asset in icon-only.png splash.png splash-dark.png; do
  curl -fsSL --retry 3 -o "$ASSET_DEST/$asset" "$BASE/appicons/$asset"
done

release_files=(
  index.html sim.js seatlog.js courses.json packs/olive_drive.json cars_manifest.json
  canonical_record.json carbon_layer.json parcels_live.json records/race286.json
  cars/1_10_52.gltf cars/1_3_4.gltf cars/1_4_6.gltf cars/3_15_36.gltf
  cars/3_335_418.gltf cars/42_123_197.gltf cars/48_149_223.gltf
  cars/4_108_159.gltf cars/4_109_160.gltf cars/4_109_162.gltf
  cars/fin_1115822.jpg cars/fin_1128476.jpg cars/fin_2833663.jpg
  cars/fin_3268949.jpg cars/fin_5688125.jpg cars/fin_5689292.jpg
  cars/fin_5694823.jpg cars/fin_5704578.jpg cars/fin_5730747.jpg
  cars/fin_5873962.jpg cars/fin_6396813.jpg
  cars/thumb_1115822.png cars/thumb_1128476.png cars/thumb_2833663.png
  cars/thumb_3268949.png cars/thumb_5688125.png cars/thumb_5689292.png
  cars/thumb_5694823.png cars/thumb_5704578.png cars/thumb_5730747.png
  cars/thumb_5873962.png cars/thumb_6396813.png
)
for file in "${release_files[@]}"; do grab "$file"; done

vend three.module.js build/three.module.js
vend jsm/loaders/GLTFLoader.js examples/jsm/loaders/GLTFLoader.js
vend jsm/loaders/DRACOLoader.js examples/jsm/loaders/DRACOLoader.js
vend jsm/loaders/KTX2Loader.js examples/jsm/loaders/KTX2Loader.js
vend jsm/utils/BufferGeometryUtils.js examples/jsm/utils/BufferGeometryUtils.js
vend jsm/utils/WorkerPool.js examples/jsm/utils/WorkerPool.js
vend jsm/libs/ktx-parse.module.js examples/jsm/libs/ktx-parse.module.js
vend jsm/libs/zstddec.module.js examples/jsm/libs/zstddec.module.js
vend jsm/libs/draco/gltf/draco_decoder.js examples/jsm/libs/draco/gltf/draco_decoder.js
vend jsm/libs/draco/gltf/draco_decoder.wasm examples/jsm/libs/draco/gltf/draco_decoder.wasm
vend jsm/libs/draco/gltf/draco_wasm_wrapper.js examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js
vend jsm/libs/basis/basis_transcoder.js examples/jsm/libs/basis/basis_transcoder.js
vend jsm/libs/basis/basis_transcoder.wasm examples/jsm/libs/basis/basis_transcoder.wasm

sed -i.bak \
  -e 's#https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js#./vendor/three.module.js#g' \
  -e 's#https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/#./vendor/jsm/#g' \
  -e 's#/uplandskin/vendor/three/build/three.module.js#./vendor/three.module.js#g' \
  -e 's#/uplandskin/vendor/three/examples/jsm/#./vendor/jsm/#g' \
  -e 's#/uplandskin/vendor/draco/#./vendor/jsm/libs/draco/gltf/#g' \
  "$WEB_DEST/index.html"
rm -f "$WEB_DEST/index.html.bak"

(
  cd "$STAGE_ROOT"
  find . -type f -not -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256
) > "$STAGE_ROOT/SHA256SUMS"

echo "Upstream staged at $STAGE_ROOT. Review it against www/; signing workflows will not consume it."
