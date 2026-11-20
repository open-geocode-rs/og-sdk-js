#!/bin/sh
# Builds the two Packs the og-backed suites run on and serves og on each.
#
#   Monaco, for the vendor suites (OG_URL).
#   Rhode Island, calibrated, for the company flows (OG_RI_URL). It has
#   regions, US addresses and towns that share a word.
#
# The Rhode Island Pack is built from OSM alone, so the OpenAddresses rows
# in ri-addresses.geojson.gz are held out from it and calibrate its scores.
#
# Usage: ecosystem-tests/og/serve.sh OG_BINARY WORK_DIR MONACO_PORT RI_PORT
# Prints the two URLs to export once both answer.
set -eu

og=$1
work=$2
monaco_port=$3
ri_port=$4
here=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$work"
fetch() {
	[ -s "$work/$1.osm.pbf" ] || curl -sfL --retry 5 -o "$work/$1.osm.pbf" "$2"
}
fetch monaco https://download.geofabrik.de/europe/monaco-latest.osm.pbf
fetch ri https://download.geofabrik.de/north-america/us/rhode-island-latest.osm.pbf

"$og" pack build --input "$work/monaco.osm.pbf" --pack "$work/monaco" --fresh >"$work/build-monaco.log" 2>&1
"$og" pack build --input "$work/ri.osm.pbf" --pack "$work/ri" --fresh >"$work/build-ri.log" 2>&1
"$og" geocode calibrate --pack "$work/ri" --addresses "ri=$here/ri-addresses.geojson.gz" --rows 1000 \
	>"$work/calibrate-ri.json" 2>"$work/calibrate-ri.log"

serve() {
	mkdir -p "$work/jobs-$1"
	"$og" serve --pack "$work/$1" --bind "127.0.0.1:$2" --job-dir "$work/jobs-$1" \
		--hook-host 127.0.0.1 >"$work/serve-$1.log" 2>&1 &
	tries=0
	until curl -sf "http://127.0.0.1:$2/geocode?q=a" >/dev/null; do
		tries=$((tries + 1))
		[ "$tries" -lt 120 ] || {
			cat "$work/serve-$1.log"
			exit 1
		}
		sleep 1
	done
}
serve monaco "$monaco_port"
serve ri "$ri_port"

echo "OG_URL=http://127.0.0.1:$monaco_port"
echo "OG_RI_URL=http://127.0.0.1:$ri_port"
