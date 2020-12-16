$(function() {

	"use strict";

	const measurements = {
		'a':  10309,
		'b':  10310,
		'c':  10311,
		'd':  10312,
		'e':  10313,
		'f':  10304,
		'g':  10314,
		'h':  10315,
		'i':  10305,
		'j':  10316,
		'k':  10301,
		'l':  10308,
		'm':  10306
	};

	const regexes = {
		'a': /^(?:rootns-|nnn1-)([a-z]{3})\d$/,
		'b': /^b\d-([a-z]{3})$/,
		'c': /^([a-z]{3})\d[a-z]\.c\.root-servers\.org$/,
		'd': /^([a-z]{4})\d\.droot\.maxgigapop\.net$/,
		'e': /^(?:[a-z]\d+)\.([a-z]{3}[a-z]?)\.eroot$/,
		'f': /^([a-z]{3})(?:\d[a-z]|\.cf)\.f\.root-servers\.org$/,
		'g': /^groot-?-(.*?)-.*?(\.net)?$/,
		'h': /^\d+\.([a-z]{3})\.h\.root-servers\.org$/,
		'i': /^s\d\.([a-z]{3})$/,
		'j': /^(?:rootns-(?:el)?|nnn1-)([a-z]{3})\d$/,
		'k': /^.*?\.([a-z]{2}-[a-z]{3})\.k\.ripe\.net$/,
		'l': /^([a-z]{2}-[a-z]{3})-[a-z]{2}$/,
		// 'l': /^[a-z]{2}\.([a-z]{2}-[a-z]{3})\.l\.root$/,
		'm': /^m-([a-z]{3})(-[a-z]+)?-\d$/
	};

	// persistent state
	var state = {};

	// local variables
	var view, map, probeSource, props = {};

	//------------------------------------------------------------------
	// state handling functions
	//
	function getDefaults() {
		state = $.extend(true, {}, {
			zoom: 3,
			center: [0, 30],
			range: 1,
			scale: 100
		});
	}

	function getState() {
		var hash = window.location.hash.substr(1);
		if (hash) {
			$.extend(true, state, JSON.parse(window.unescape(hash)));
		}

		// write back to hash
		putState();
	}

	function putState() {
		window.location.hash = JSON.stringify(state);
	}

	//------------------------------------------------------------------

	const mismatches = new Map();

	function logMismatch(probe, letter, hostname) {
		// console.log(`probe ${probe} returned ${hostname} for ${letter}`);
		if (!mismatches.has(hostname)) {
			mismatches.set(hostname, new Map());
		}
		const map = mismatches.get(hostname)

		if (!map.has(letter)) {
			map.set(letter, new Array());
		}
		map.get(letter).push(probe);
	}

	function showMismatches() {
		const hostnames = Array.from(mismatches.keys()).sort();
		for (let hostname of hostnames) {
			const map = mismatches.get(hostname);
			console.log(hostname);
			for (let [letter, list] of map) {
				console.log(letter, list)
			}
		}
	}

	//------------------------------------------------------------------

	function showProbeMeasurements(prb_id) {
		const p = props[prb_id];
		const { letter, ms, site } = p.fast;

		const detail = Array.from(Object.entries(p.detail))
			.sort((a, b) => a[1].ms - b[1].ms)
			.map(([k, v]) => `${k.toUpperCase()}: ${v.ms.toFixed(1)} (${v.site.toUpperCase()})`)
			.join(', ');

		$('#measurements').text(detail);
	}

	function updateMeasurements(probe, letter, hostname, ms) {
		if (!hostname) return;
		hostname = hostname.toLowerCase();

		const match = regexes[letter].exec(hostname);
		if (!match) {
			logMismatch(probe, letter, hostname);
			return;
		}

		const site = match[1];
		const p = props[probe] = props[probe] || { detail: {} };

		p.detail[letter] = { site, ms };
		if (p.fast === undefined || ms < p.fast.ms) {
		  p.fast = { letter, site, ms };
		}
	}

	const pending = Object.keys(measurements).reduce((p, c) => (p[c] = 1, p), {});

	function showPending() {
		$('#progress').show();
		$('#pending').show().text('Loading: ' + Object.keys(pending).join(' ').toUpperCase());
	}

	function hidePending() {
		$('#progress,#pending').hide();
	}

	async function loadMeasurements(letter) {

		const m = measurements[letter];
		const url = `https://atlas.ripe.net/api/v2/measurements/${m}/latest/?fields=responses.0.response_time,responses.0.abuf.answers.0.data.0&freshness=1800`;

		showPending();

		return fetch(url).then(res => res.json()).then(r => {
			for (let [probe, [[ms, site]]] of Object.entries(r)) {
				updateMeasurements(+probe, letter, site, ms);
			}
		}).then(() => {
			delete pending[letter];
			showPending();
		}).then(redraw);

	}

	function loadAllMeasurements() {
		const promises = Object.keys(measurements).map(loadMeasurements);
		return Promise.all(promises);
	}

	//------------------------------------------------------------------

	const meta = new Map();

	function loadProbeMeta(prb_id) {
		if (!meta.has(prb_id)) {
			const url = `https://atlas.ripe.net/api/v2/probes/${prb_id}/`;
			const data = fetch(url).then(res => res.json());
			meta.set(prb_id, data);
		}
		return meta.get(prb_id);
	}

	function showProbeMeta(prb_id) {

		let output = `Probe #${prb_id}`;
		$('#meta').text(output);

		loadProbeMeta(prb_id).then(meta => {
			output += `, AS${meta.asn_v4}`;
			$('#meta').text(output);
		});
	}

	//------------------------------------------------------------------

	const style = {};

	function getProbeStyle(feature, resolution) {

		const id = feature.getId();
		const p = props[id];
		if (!p) return;

		let size = Math.max(3, Math.min(6, Math.floor(20000 / resolution)));
		size = Math.floor(10 * size) / 10.0;

		let ms;
		if (state.range === 1) {
			ms = p.fast.ms;
		} else {
			const times = Object.values(p.detail).map(o => o.ms).sort((a, b) => a - b);
			const index = Math.min(state.range - 1, times.length - 1);
			ms = times[index];
		}

		let scale = Math.min(ms, state.scale) / state.scale;
		scale = Math.pow(scale, 0.8);				// non-linear
		const h = Math.floor(120 * (1 - scale));	// 120 .. 0

		const col = 'hsla(' + [h, '80%', '50%', 0.6] + ')';
		const key = state.scale + '|' + h + '|' + size.toFixed(1);

		if (!(key in style)) {
			style[key] = new ol.style.Style({
				image: new ol.style.Circle({
					radius: size,
					fill: new ol.style.Fill({color: col}),
					// stroke: new ol.style.Stroke({color: 'rgba(0, 0, 0, 0.3)', width: 0.5})
				}),
				zIndex: ms
			});
		}

		return style[key];
	}

	//------------------------------------------------------------------

	function buildMap() {

		view = new ol.View({
			center: ol.proj.fromLonLat(state.center),
			zoom: state.zoom,
			minZoom: 2,
			maxZoom: 14,
			loadTilesWhileInteracting: true
		});

		map = new ol.Map({
			target: 'map',
			layers: [
				new ol.layer.Tile({
					source: new ol.source.OSM({
						url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
					})
				})
			],
			view: view
		});

		$('#progress').show();
		$('#pending').show().text('Loading: probe locations');

		probeSource = new ol.source.Vector({
			url: 'https://atlas.ripe.net/api/v2/cartography/locations/',
			// url: 'data/locations.json',
			format: new ol.format.GeoJSON(),
			attributions: 'Data from <a href="https://atlas.ripe.net/" target="_blank">RIPE Atlas</a>.'
		});

		map.addLayer(
			new ol.layer.Vector({
					renderMode: 'image',
					source: probeSource,
					style: getProbeStyle
			})
		);

		map.on('pointermove', mouseOver);

		view.on(['change:center', 'change:resolution'], _.debounce(changeView, 250));
	}

	// forces the probe layer to be redrawn by faking a 'change' event
	function redraw() {
		probeSource.dispatchEvent('change');
	}

	//------------------------------------------------------------------

	function calculateStats(x) {

		// Welford's single pass algorithm for standard deviation
		var n = 0, mean = 0, M2 = 0;
		for (var i = 0; i < x.length; ++i) {
			++n;
			var delta = x[i] - mean;
			mean += delta / n;
			M2 += delta * (x[i] - mean);
		}

		var variance = M2 / (n - 1);
		var stddev = Math.sqrt(variance);

		// find median
		x.sort(function(a, b) { return a - b });
		var mid = Math.floor(n / 2);
		var median = x[mid];
		if (n % 2) {
			median += x[++mid];
			median /= 2;
		}

		return { median: median, mean: mean, stddev : stddev };
	}

	//------------------------------------------------------------------
	// event handlers
	//

	function changeView(evt) {
		var view = evt.target;
		state.zoom = view.getZoom();
		state.center = ol.proj.toLonLat(view.getCenter());
		putState();
	}

	function changeRange(evt) {
		state.range = +evt.target.value;
		putState();
		redraw();
	}

	function changeScale(evt) {
		state.scale = +evt.target.value;
		putState();
		redraw();
	}

	function displayRange() {
		$('#rlabel').text('Fastest ' + this.value);
	}

	function displayScale() {
		$('#slabel').text('Latency range ' + this.value);
	}

	function mouseOver(evt) {

		const prb_id = this.forEachFeatureAtPixel(evt.pixel, (feature, layer) => feature.getId());
		if (prb_id === undefined) {
			$('#map').css('cursor', '');
			$('#meta,#measurements').hide();
			return;
		}

		$('#map').css('cursor', 'pointer');
		$('#meta,#measurements').show();
		showProbeMeta(prb_id);
		showProbeMeasurements(prb_id);
	}

	//------------------------------------------------------------------

	function setupRange() {
		const n = Object.keys(measurements).length;

		for (let i = 1; i <= n; ++i) {
			$('<option>', { value: i, label: (i % 2 == 1) ? i : undefined}).appendTo('#ticks');
		}

		$('#rinput')
			.on('change', changeRange)
			.on('change input', displayRange)
			.attr('max', n)
			.val(state.range)
			.trigger('input');

		$('#sinput')
			.on('change', changeScale)
			.on('change input', displayScale)
			.val(state.scale)
			.trigger('input');
	}

	//------------------------------------------------------------------

	getDefaults();
	getState();
	setupRange();

	buildMap();

	probeSource.once('change', async () => {
		await loadAllMeasurements();
		showMismatches();
		hidePending();
	});
});
