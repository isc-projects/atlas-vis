$(function() {

	"use strict";

	const apiUrl = 'https://atlas.ripe.net/api/v2';

	// which root letters to consider
	const letters = new Set([ 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm' ]);

	// map of RIPE (IPv4) root system tests per root-letter
	const measurements = {
		'a': 10309,
		'b': 10310,
		'c': 10311,
		'd': 10312,
		'e': 10313,
		'f': 10304,
		'g': 10314,
		'h': 10315,
		'i': 10305,
		'j': 10316,
		'k': 10301,
		'l': 10308,
		'm': 10306
	};

	// map of RSO names
	const rso = {
		'a': 'Verisign',
		'b': 'ISI',
		'c': 'Cogent',
		'd': 'UMD',
		'e': 'NASA',
		'f': 'ISC',
		'g': 'DISA',
		'h': 'ARL',
		'i': 'Netnod',
		'j': 'Verisign',
		'k': 'RIPE',
		'l': 'ICANN',
		'm': 'WIDE'
	};

	// map of regexes that extract the RSO's site-specific code from a hostname.bind string
	const regexes = {
		'a': [
			/^(?:rootns-|nnn1-)([a-z]{3})\d+$/,
			/^(?:rootns-|nnn1-)el([a-z]{3})\d+$/,
			/^(?:rootns-|nnn1-)(?:[a-z]{2})([a-z]{3})-\d+[a-z]?$/,
		],
		'b': /^b\d-([a-z]{3})$/,
		'c': /^([a-z]{3})\d[a-z]\.c\.root-servers\.org$/,
		'd': /^([a-z]{4})\d\.droot\.maxgigapop\.net$/,
		'e': /^(?:[a-z]\d+)\.([a-z]{3})[a-z0-9]?\.eroot$/,
		'f': /^([a-z]{3})(?:\d[a-z]|\.cf)\.f\.root-servers\.org$/,
		'g': /^groot-?-(.*?)-.*?(\.net)?$/,
		'h': /^\d+\.([a-z]{3})\.h\.root-servers\.org$/,
		'i': /^s\d\.([a-z]{3})$/,
		'j': [
			/^(?:rootns-|nnn1-)([a-z]{3})\d+$/,
			/^(?:rootns-|nnn1-)el([a-z]{3})\d+$/,
			/^(?:rootns-|nnn1-)(?:[a-z]{2})([a-z]{3})-\d+[a-z]?$/,
		],
		'k': /^.*?\.([a-z]{2}-[a-z]{3})\.k\.ripe\.net$/,
		'l': /^([a-z]{2}-[a-z]{3})-[a-z]{2}$/,
		'm': /^m-([a-z]{3})(-[a-z]+)?-\d$/
	};

	// persistent state, to go in the URL
	const state = { proto: 4 };

	// local variables
	const props = { 4: {}, 6: {}};	// per-probe data
	const loaded = { 4: new Set(), 6: new Set() };
	let pending = new Set();
	let view, map;			// openlayers
	let probes;			// openlayers data source object

	//------------------------------------------------------------------
	//
	// persistent state handling functions
	//
	function getDefaults() {
		$.extend(true, state, {
			zoom: 3,
			center: [0, 30],
			top: 1,
			scale: 100,
			proto: 4,
			letter: letters.size === 1 ? Array.from(letters)[0] : undefined,
			site: undefined,
		});
	}

	function getState() {
		var hash = window.location.hash.substr(1);
		if (hash) {
			$.extend(true, state, JSON.parse(window.unescape(hash)));
		}

		if (state.proto !== 4 && state.proto !== 6) {
			state.proto = 4;
		}

		// write back to hash
		putState();
	}

	function putState() {
		window.location.hash = JSON.stringify(state);
	}

	//------------------------------------------------------------------
	//
	// functions to handle and record hostname.bind records that do
	// not match the expected regexes
	//
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
			for (let [letter, list] of new Map([...map].sort())) {
				console.log('  ' + letter + ':', JSON.stringify(list))
			}
		}
	}

	//------------------------------------------------------------------
	//
	// progress bar handling
	//
	function showPending() {
		$('#progress').show();
		$('#pending').show().text(`Loading IPv${state.proto}: ` + Array.from(pending.values()).join(' ').toUpperCase());
	}

	function hidePending() {
		$('#progress,#pending').hide();
	}

	//------------------------------------------------------------------
	//
	// AJAX and data handling
	//
	function updateMeasurements(proto, probe, letter, hostname, ms) {
		if (!hostname) return;
		hostname = hostname.toLowerCase();

		const re = regexes[letter];
		const a = Array.isArray(re) ? re : [ re ];

		for (let re of a) {
			const match = re.exec(hostname);
			if (match) {
				const site = match[1];
				const p = props[proto][probe] = props[proto][probe] || { detail: {} };

				p.detail[letter] = { site, ms };

				// cache fastest entry found
				if (p.fast === undefined || ms < p.fast.ms) {
					p.fast = { letter, site, ms };
				}
				return;
			}
		}

		logMismatch(probe, letter, hostname);
	}

	async function loadMeasurements(proto, letter) {

		let m = measurements[letter];
		if (proto === 6) {
			m += 1000;
		}

		const url = `${apiUrl}/measurements/${m}/latest/?fields=responses.0.response_time,responses.0.abuf.answers.0.data.0&freshness=900&use_keys=true`;

		return fetch(url).then(res => res.json()).then(r => {
			for (let [probe, [[ms, site]]] of Object.entries(r)) {
				updateMeasurements(proto, +probe, letter, site, ms);
			}
		}).then(() => {
			if (letter === state.letter) {
				buildSiteCodes();
			}
			loaded[proto].add(letter);
			pending.delete(letter);
			showPending();
		}).then(redraw);

	}

	let loading = false;

	async function loadAllMeasurements() {
		if (loading) return;
		loading = true;

		$('#proto').prop('disabled', true);
		const proto = state.proto;
		pending = letters.difference(loaded[proto]);
		const needed = Array.from(pending);

		showPending();
		try {
			const promises = needed.map(letter => loadMeasurements(proto, letter));
			await Promise.all(promises);
		} catch (e) {
			console.trace(e);
		}
		hidePending();

		$('#proto').prop('disabled', false);
		loading = false;

		showMismatches();
	}

	//------------------------------------------------------------------
	//
	// per-probe meta-data handling
	//
	const meta = new Map();

	function loadProbeMeta(prb_id) {
		if (!meta.has(prb_id)) {
			const url = `${apiUrl}/probes/${prb_id}/`;
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
	//
	// per-probe styling
	//
	const styles = new Map();						// style cache

	function getColour(ms, scale) {
		let r = Math.min(ms, scale) / scale;	// 0 .. 1
		r = Math.pow(r, 0.8);					// non-linear
		const h = Math.floor(120 * (1 - r));	// 120 .. 0

		return [h, `hsla(${h}, 80%, 50%, 0.6)`];
	}

	function getProbeStyle(feature, resolution) {

		const id = feature.getId();
		const p = props[state.proto][id];
		if (!p) return;

		// vary circle size by zoom factor
		let size = Math.max(3, Math.min(6, Math.floor(20000 / resolution)));
		size = Math.floor(10 * size) / 10.0;

		let ms;

		if (state.letter) {
			const d = p.detail[state.letter];
			if (!d) return;
			if (state.site && (state.site !== d.site)) return;
			ms = d.ms;
		} else if (state.top === 1) {						// short cut
			ms = p.fast.ms;
		} else {
			const times = Object.values(p.detail).map(o => o.ms).sort((a, b) => a - b);
			const index = Math.min(state.top - 1, times.length - 1);
			ms = times[index];
		}

		const [h, col] = getColour(ms, state.scale);
		const key = (state.letter || '#') + '|' + state.scale + '|' + h + '|' + size.toFixed(1);

		if (!styles.has(key)) {
			const s = new ol.style.Style({
				image: new ol.style.Circle({
					radius: size,
					fill: new ol.style.Fill({color: col}),
				}),
				zIndex: ms
			});
			styles.set(key, s);
		}

		return styles.get(key);
	}

	//------------------------------------------------------------------

	function escapeHtml(text) {
		return text.replace(/[\"&<>]/g, function (a) {
			return { '"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;' }[a];
		});
	}

	function showProbeMeasurements(prb_id) {
		const p = props[state.proto][prb_id];
		if (!p) return;

		const { letter, ms, site } = p.fast;

		const detail = Array.from(Object.entries(p.detail))
			.sort((a, b) => a[1].ms - b[1].ms)
			.map(([k, v]) => [k, escapeHtml(`${k.toUpperCase()}: ${v.ms.toFixed(1)} (${v.site.toUpperCase()})`)])
			.map(([k, v]) => (state.letter === k) ? `<b>${v}</b>` : v)
			.join(', ');

		$('#measurements').html(detail);
	}

	function buildMap() {

		const scaleLine = new ol.control.ScaleLine({
			units: 'metric',
			bar: true,
			steps: 4,
			minWidth: 200,
			maxWidth: 300,
		});

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
			controls: [
				scaleLine,
				new ol.control.Zoom()
			],
			view: view
		});

		$('#progress').show();
		$('#pending').show().text('Loading: probe locations');

		/*
		 * loader for RIPE's archived location files, converting to geoJSON
		 *
		 * uses bzip2 library from https://github.com/antimatter15/bzip2.js
		 */
		const loader = async (extent, resolution, projection, success, failure) => {
			let url = 'https://ftp.ripe.net/ripe/atlas/probes/archive/meta-latest';

			const res = await fetch(url);
			const buf = await res.arrayBuffer();
			const bytes = new Uint8Array(buf);
			const data = bzip2.simple(bzip2.array(bytes));
			const json = JSON.parse(data);

			const geoJSON = json.objects
				.filter(o => o.status === 1)
				.map(o => {
					return {
						id: o.id,
						type: 'Feature',
						geometry: {
							type: 'Point',
							coordinates: [ o.longitude, o.latitude ]
						}
					}
				});

			const features = probes.getFormat().readFeatures({
				type: 'FeatureCollection',
				features: geoJSON
			}, { featureProjection: projection });

			probes.addFeatures(features);
		}

		probes = new ol.source.Vector({
			loader,
			format: new ol.format.GeoJSON(),
			attributions: 'Data from <a href="https://atlas.ripe.net/" target="_blank">RIPE Atlas</a>.'
		});

		map.addLayer(
			new ol.layer.Vector({
					renderMode: 'image',
					source: probes,
					style: getProbeStyle
			})
		);

		map.on('pointermove', mouseOver);

		view.on(['change:center', 'change:resolution'], _.debounce(changeView, 250));
	}

	// force the probe layer to be redrawn by faking a 'change' event
	function redraw() {
		if (probes) {
			probes.dispatchEvent('change');
		}
	}

	//------------------------------------------------------------------
	//
	// event handlers
	//

	function changeView(evt) {
		var view = evt.target;
		state.zoom = view.getZoom();
		state.center = ol.proj.toLonLat(view.getCenter());
		putState();
	}

	function changeTop(evt) {
		state.top = +evt.target.value;
		putState();
		redraw();
	}

	function changeScale(evt) {
		state.scale = +evt.target.value;
		putState();
		redraw();
	}

	function changeLetter(evt) {
		state.letter = evt.target.value || undefined;
		state.site = undefined;
		$('#rinput').prop('disabled', !!state.letter);
		$('#site').parent().toggle(!!state.letter);
		buildSiteCodes();
		putState();
		redraw();
	}

	async function changeProto(evt) {
		state.proto = +evt.target.value || 4;
		await loadAllMeasurements();
		putState();
		redraw();
	}

	function changeSite(evt) {
		state.site = evt.target.value || undefined;
		putState();
		redraw();
	}

	function displayTop() {
		let v = +this.value;

		let suff = "th";
		switch (v) {
			case 1: suff = ""; v = ""; break;
			case 2: suff = "nd"; break;
			case 3: suff = "rd"; break;
		}

		$('label[for="rinput"]').text(`Color by ${v}${suff} Fastest`);
	}

	function displayScale() {
		$('label[for="sinput"]').text(`Latency range 0 - ${this.value} ms`);
	}

	function mouseOver(evt) {

		const prb_id = this.forEachFeatureAtPixel(evt.pixel, (feature, layer) => feature.getId());
		if (prb_id === undefined) {
			$('#map').css('cursor', '');
			$('#meta,#measurements').hide();
		} else {
			$('#map').css('cursor', 'pointer');
			$('#meta,#measurements').show();
			showProbeMeta(prb_id);
			showProbeMeasurements(prb_id);
		}
	}

	//------------------------------------------------------------------

	function setupLegend() {
		const canvas = document.getElementById('legend');
		const ctx = canvas.getContext('2d');
		for (let x = 0; x < canvas.width; ++x) {
			const [h, col] = getColour(x, canvas.width - 1);
			ctx.strokeStyle = col;
			ctx.strokeRect(x, 0, x, canvas.height);
		}
	}

	//------------------------------------------------------------------

	function setupTopSlider() {

		const n = letters.size;

		// populate option data
		for (let i = 1; i <= n; ++i) {
			$('<option>', { value: i, label: (i % 2 == 1) ? i : undefined}).appendTo('#rticks');
		}

		$('#rinput')
			.on('change', changeTop)
			.on('change input', displayTop)
			.attr('max', n)
			.val(state.top)
			.trigger('input');
	}

	function setupScaleSlider() {
		$('#sinput')
			.on('change', changeScale)
			.on('change input', displayScale)
			.val(state.scale)
			.trigger('input');
	}

	//------------------------------------------------------------------

	function getSiteCodes() {
		const sites = new Set();
		Object.values(props[state.proto]).forEach(p => {
			let d = p.detail[state.letter];
			if (d) {
				sites.add(d.site);
			}
		});
		return Array.from(sites).sort();
	}

	function buildSiteCodes() {

		// fill default "all" option
		$('#site').empty();
		$('<option>', {
			value: '',
			text: '- all -',
			selected: !state.site
		}).appendTo('#site');

		// populate dropdown
		for (const s of getSiteCodes()) {
			$('<option>', {
				value: s,
				text: s.toUpperCase(),
				selected: state.site == s
			}).appendTo('#site');
		}
	}

	function setupSiteCodes() {
		buildSiteCodes();
		$('#site')
			.on('change', changeSite)
			.val(state.site);
	}

	//------------------------------------------------------------------

	function setupLetters() {

		// populate dropdown
		for (const letter of letters) {
			$('<option>', {
				value: letter,
				text: `${letter.toUpperCase()} (${rso[letter]})`,
				selected: state.letter == letter
			}).appendTo('#letter');
		}

		$('#letter')
			.on('change', changeLetter)
			.val(state.letter)
			.trigger('change');
	}

	//------------------------------------------------------------------

	function setupProto() {
		$('#proto option').each(el => {
			$(el).attr('selected', state.proto === +el.value);
		});

		$('#proto')
			.on('change', changeProto)
			.val(state.proto.toString()).
			trigger('change');
	}

	//------------------------------------------------------------------
	//
	// main application startup
	//
	getDefaults();
	getState();
	setupLegend();
	setupProto();
	setupScaleSlider();
	setupSiteCodes();

	if (letters.size > 1) {
		setupTopSlider();
		setupLetters();
		$('#multi').show();
	} else {
		$('#sclabel,#site').show();
	}

	buildMap();

	// once the main data source has loaded, one-off trigger to get the other data
	probes.once('change', async () => {
		await loadAllMeasurements();
	});
});
