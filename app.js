/* Pick – Was essen wir heute?
   Swipe-Karten: rechts = machen wir, links = nö.
   Daten liegen lokal (localStorage, Fotos in IndexedDB) und werden – wenn eingerichtet –
   über Supabase zwischen euren Handys synchronisiert (siehe config.js / README). */
(() => {
  'use strict';

  // ---------- Konstanten ----------
  const STORE_KEY = 'hunger.v1';   // alter Schlüssel bleibt, damit nichts verloren geht
  const DISH_EMOJI = ['🍝','🍛','🍲','🥘','🫕','🍜','🍕','🍔','🌮','🌯','🥙','🥗','🍳','🥞','🍣','🍱','🥟','🍗','🥩','🐟','🍤','🥔','🍚','🧆','🥪','🌭','🍠','🥦','🌶️','🧀','🥚','🍰'];
  const PLACE_EMOJI = ['🍽️','🛵','🌮','🥙','🍕','🍣','🍜','🍔','🍛','🥡','🍝','🥗','🍗','🍺','☕','🏮'];
  const CUISINES = ['Deutsch','Italienisch','Pizza','Mexikanisch','Türkisch','Griechisch','Asiatisch','Japanisch','Vietnamesisch','Thai','Chinesisch','Indisch','Burger','Amerikanisch','Spanisch','Levantinisch','Fastfood'];
  const EFFORT = { quick: 'Schnell', normal: 'Normal', long: 'Aufwendig' };
  const TASTE = { savory: '🧂 Herzhaft', sweet: '🍰 Süß' };
  // Ältere Einträge ohne Angabe: Stichwort "Süß" → süß, sonst herzhaft
  const tasteOf = (it) => it.taste || ((it.tags || []).some(t => t.toLowerCase() === 'süß') ? 'sweet' : 'savory');
  const PLACE_TYPE = { restaurant: 'Restaurant', delivery: 'Lieferdienst' };
  // Zufall: was darf drankommen? (Standard: selbst kochen oder ins Restaurant)
  const MIX_KINDS = { dish: '🍳 Selbst kochen', restaurant: '🍽️ Restaurant', delivery: '🛵 Lieferdienst' };
  const MIX_DEFAULT = ['dish', 'restaurant'];
  const WEEKDAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']];   // JS: 0 = Sonntag
  const GRADIENTS = [   // Kartenfarben ohne Foto – abgeleitet aus dem Logo
    ['#7AF0D7', '#16C5E7'], ['#FF9F8A', '#FF6B6B'], ['#1E5AB1', '#0B3F87'], ['#16C5E7', '#1E5AB1'],
    ['#FFD9CB', '#FF7C6C'], ['#4FD8C8', '#0FA3C9'], ['#2B6CC4', '#062A63'], ['#FF8E7B', '#E5534B']
  ];
  const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.5.8-1.3 2.3-2.5 4.4-2.5 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>';
  const ICON_FILTER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';

  // ---------- Hilfen ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  };
  const now = () => Date.now();
  const DAY = 86400000;
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const normTag = (t) => cap(String(t).trim().replace(/\s+/g, ' '));
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function grad(id) {
    let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const g = GRADIENTS[h % GRADIENTS.length];
    return `--g1:${g[0]};--g2:${g[1]}`;
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (_) { return ''; }
  }
  function relDay(ts) {
    const d = Math.floor((new Date().setHours(0,0,0,0) - new Date(ts).setHours(0,0,0,0)) / DAY);
    if (d <= 0) return 'Heute';
    if (d === 1) return 'Gestern';
    if (d < 7) return `vor ${d} Tagen`;
    return new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  }

  // ---------- Fotos (IndexedDB) ----------
  const imgCache = new Map();
  let idbP = null;
  function idb() {
    if (!idbP) idbP = new Promise((res, rej) => {
      const r = indexedDB.open('pick-images', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('img');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null);
    return idbP;
  }
  async function imgPut(id, data) {
    imgCache.set(id, data);
    const d = await idb(); if (!d) return;
    await new Promise((res) => { const tx = d.transaction('img', 'readwrite'); tx.objectStore('img').put(data, id); tx.oncomplete = res; tx.onerror = res; });
  }
  async function imgGet(id) {
    if (!id) return null;
    if (imgCache.has(id)) return imgCache.get(id);
    const d = await idb(); if (!d) return null;
    const v = await new Promise((res) => { const r = d.transaction('img').objectStore('img').get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
    if (v) imgCache.set(id, v);
    return v;
  }
  // Foto eines Eintrags: eigenes Foto (IndexedDB) oder fest eingebautes Beispielfoto
  const hasPhoto = (it) => !!(it.photo || it.photoUrl);
  function photoTag(it, extra = '') {
    if (it.photo) return `<img class="ph" data-img="${esc(it.photo)}" alt="" ${extra}>`;
    if (it.photoUrl && /^images\/[\w\/.-]+$/.test(it.photoUrl))
      return `<img class="ph" src="${esc(it.photoUrl)}" alt="" ${extra} onload="this.classList.add('loaded')" onerror="this.remove()">`;
    return '';
  }
  // Bilder in gerendertem HTML nachladen
  async function hydrate(root = document) {
    for (const el of $$('img[data-img]', root)) {
      const data = await imgGet(el.dataset.img);
      if (data && el.isConnected) {
        el.onload = () => el.classList.add('loaded');
        el.src = data;
      }
    }
  }
  // Foto verkleinern → JPEG-DataURL (ca. 100–200 KB)
  async function compressImage(file) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const w = src.width, h = src.height, max = 1100;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s); c.height = Math.round(h * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    let q = 0.8, out = c.toDataURL('image/jpeg', q);
    while (out.length > 350000 && q > 0.5) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
    return out;
  }


  // ---------- Beispiel-Inhalte ----------
  // Fotos liegen fest in images/seed/ – fehlt eine Datei, zeigt die Karte einfach das Emoji.
  const SEED = {
    'Spaghetti Bolognese': { photoUrl: 'images/seed/bolognese.jpg',
      ingredients: ['200 g Spaghetti', '250 g Rinderhackfleisch', '1 Zwiebel', '2 Knoblauchzehen', '1 Möhre', '1 EL Tomatenmark', '400 g passierte Tomaten', '1 TL getrockneter Oregano', '2 EL Olivenöl', 'Salz, Pfeffer', 'Parmesan zum Servieren'],
      steps: ['Zwiebel, Knoblauch und Möhre fein würfeln.', 'Hackfleisch im Olivenöl krümelig anbraten, das Gemüse dazugeben und 3 Minuten mitbraten.', 'Tomatenmark kurz mitrösten, dann passierte Tomaten und Oregano dazugeben.', 'Die Soße 20 Minuten leise köcheln lassen und mit Salz und Pfeffer abschmecken.', 'Spaghetti in Salzwasser nach Packungsangabe kochen.', 'Nudeln abgießen, mit der Soße anrichten und Parmesan darüberreiben.'] },
    'Chili con Carne': { photoUrl: 'images/seed/chili.jpg',
      ingredients: ['250 g Rinderhackfleisch', '1 Zwiebel', '1 Knoblauchzehe', '1 rote Paprika', '1 Dose Kidneybohnen (400 g)', '1 kleine Dose Mais (140 g)', '400 g gehackte Tomaten', '1 EL Tomatenmark', '1 TL Kreuzkümmel', '1 TL Paprikapulver', '½ TL Chiliflocken', '1 EL Öl', 'Salz, Pfeffer'],
      steps: ['Zwiebel, Knoblauch und Paprika würfeln.', 'Hackfleisch im Öl anbraten, Zwiebel und Knoblauch dazugeben.', 'Tomatenmark und Gewürze 1 Minute mitrösten.', 'Tomaten und Paprika dazugeben und 15 Minuten köcheln lassen.', 'Bohnen und Mais abspülen, unterrühren und weitere 10 Minuten köcheln.', 'Abschmecken und mit Reis, Brot oder einem Klecks Schmand servieren.'] },
    'Hähnchen-Curry': { photoUrl: 'images/seed/curry.jpg',
      ingredients: ['300 g Hähnchenbrust', '150 g Basmatireis', '400 ml Kokosmilch', '2 EL rote Currypaste', '1 rote Paprika', '1 Zwiebel', '1 Knoblauchzehe', '2 cm Ingwer', '1 EL Öl', '1 Spritzer Limettensaft', 'Koriander oder Frühlingszwiebeln', 'Salz'],
      steps: ['Reis nach Packungsangabe kochen.', 'Hähnchen würfeln, Zwiebel, Knoblauch und Ingwer fein hacken, Paprika in Streifen schneiden.', 'Hähnchen im Öl rundum anbraten und herausnehmen.', 'Zwiebel, Knoblauch und Ingwer anschwitzen, Currypaste 1 Minute mitrösten.', 'Kokosmilch und Paprika dazugeben, 8 Minuten köcheln, dann das Hähnchen 5 Minuten mitziehen lassen.', 'Mit Limettensaft und Salz abschmecken und mit Reis und Kräutern servieren.'] },
    'Ofengemüse mit Feta': { photoUrl: 'images/seed/ofengemuese.jpg',
      ingredients: ['500 g kleine Kartoffeln', '1 Zucchini', '1 rote Paprika', '1 rote Zwiebel', '200 g Kirschtomaten', '200 g Feta', '3 EL Olivenöl', '1 TL getrockneter Thymian oder Rosmarin', 'Salz, Pfeffer'],
      steps: ['Ofen auf 200 °C Umluft vorheizen.', 'Kartoffeln vierteln, das übrige Gemüse grob schneiden.', 'Alles mit Öl, Kräutern, Salz und Pfeffer mischen und auf einem Blech verteilen.', '25 Minuten backen.', 'Kirschtomaten und zerbröselten Feta darauf verteilen und weitere 10 Minuten backen.'] },
    'Lasagne': { photoUrl: 'images/seed/lasagne.jpg',
      ingredients: ['9 Lasagneplatten', '300 g Rinderhackfleisch', '1 Zwiebel', '1 Knoblauchzehe', '400 g passierte Tomaten', '1 EL Tomatenmark', '30 g Butter', '30 g Mehl', '400 ml Milch', '100 g geriebener Mozzarella', 'Muskat', 'Salz, Pfeffer'],
      steps: ['Zwiebel und Knoblauch würfeln, mit dem Hack anbraten, Tomatenmark und Tomaten dazugeben, 15 Minuten köcheln und würzen.', 'Für die Béchamel Butter schmelzen, Mehl einrühren, Milch nach und nach unterrühren und 5 Minuten köcheln. Mit Salz, Pfeffer und Muskat würzen.', 'Ofen auf 180 °C Umluft vorheizen.', 'In eine Auflaufform schichten: etwas Soße, Platten, Hacksoße, Béchamel – insgesamt 3 Lagen.', 'Mit Béchamel und Käse abschließen und 35–40 Minuten backen.', 'Vor dem Anschneiden 10 Minuten ruhen lassen.'] },
    'Wraps': { photoUrl: 'images/seed/wraps.jpg',
      ingredients: ['4 Weizentortillas', '250 g Hähnchenbrust', '1 TL Paprikapulver', '½ Eisbergsalat', '2 Tomaten', '½ Gurke', '50 g geriebener Käse', '4 EL Knoblauch- oder Joghurtsoße', '1 EL Öl', 'Salz, Pfeffer'],
      steps: ['Hähnchen in Streifen schneiden, mit Paprika, Salz und Pfeffer würzen und im Öl 6–8 Minuten braten.', 'Salat in Streifen schneiden, Tomaten und Gurke würfeln.', 'Tortillas kurz in der Pfanne oder Mikrowelle erwärmen.', 'Soße auf die Tortillas streichen, Salat, Gemüse, Hähnchen und Käse darauf verteilen und einrollen.'] },
    'Kartoffelsuppe': { photoUrl: 'images/seed/kartoffelsuppe.jpg',
      ingredients: ['600 g mehligkochende Kartoffeln', '1 Möhre', '1 Stück Lauch', '1 Zwiebel', '750 ml Gemüsebrühe', '100 ml Sahne', '1 EL Butter', '½ TL Majoran', 'Salz, Pfeffer, Muskat', 'Petersilie'],
      steps: ['Kartoffeln und Möhre schälen und würfeln, Lauch in Ringe schneiden, Zwiebel würfeln.', 'Zwiebel und Lauch in der Butter andünsten.', 'Kartoffeln, Möhre, Brühe und Majoran dazugeben und 20 Minuten köcheln lassen.', 'Einen Teil oder alles pürieren und die Sahne einrühren.', 'Mit Salz, Pfeffer und Muskat abschmecken und mit Petersilie bestreuen.'] },
    'Pfannkuchen': { photoUrl: 'images/seed/pfannkuchen.jpg',
      ingredients: ['200 g Mehl', '2 Eier', '350 ml Milch', '1 EL Zucker', '1 Prise Salz', 'Butter zum Braten', 'Zucker & Zimt, Apfelmus oder Nuss-Nougat-Creme'],
      steps: ['Mehl, Eier, Milch, Zucker und Salz glatt rühren und 10 Minuten quellen lassen.', 'Etwas Butter in einer Pfanne bei mittlerer Hitze schmelzen.', 'Eine Kelle Teig hineingeben, durch Schwenken verteilen und 1–2 Minuten backen, bis die Unterseite goldbraun ist.', 'Wenden, kurz fertig backen und warm mit dem Lieblingsbelag servieren.'] },
    'Unser Mexikaner': { photoUrl: 'images/seed/mexikaner.jpg', hours: 'Di–So 17–23 Uhr', closed: [1],
      note: 'Beispiel – tragt Adresse und Google-Maps-Link eures Lieblings-Mexikaners ein.' },
    'Döner um die Ecke': { photoUrl: 'images/seed/doener.jpg', hours: 'Täglich 11–23 Uhr', note: 'Beispiel – Adresse ergänzen, dann gibt es Karte und Route.' },
    'Pizza bestellen': { photoUrl: 'images/seed/pizza.jpg', hours: 'Täglich 17–22 Uhr', note: 'Beispiel – als Link die Seite eures Lieferdienstes eintragen.' },
    'Sushi bestellen': { photoUrl: 'images/seed/sushi.jpg', hours: 'Di–So 17–22 Uhr', closed: [1], note: 'Beispiel – als Link die Seite eures Lieferdienstes eintragen.' },
    'Der Inder': { photoUrl: 'images/seed/inder.jpg', hours: 'Täglich 12–14:30 und 17:30–22:30 Uhr', note: 'Beispiel – tipp auf Bearbeiten und trag die echte Adresse ein.' }
  };
  // Bestehende Beispiel-Karten nachträglich mit Rezepten und Fotos füllen
  function fillExamples() {
    let any = false;
    for (const it of db.items) {
      const extra = it.example && SEED[it.name];
      if (!extra) continue;
      let changed = false;
      for (const [k, v] of Object.entries(extra)) {
        const cur = it[k];
        if (cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && !cur.length)) { it[k] = v; changed = true; }
      }
      if (changed) { it.updatedAt = now(); markDirty(it.id); any = true; }
    }
    if (any) save();
  }

  // ---------- Daten ----------
  function seed() {
    const t = now();
    const d = (name, emoji, tags, effort) => ({ id: uid(), kind: 'dish', name, emoji, tags, effort, link: '', note: '', fav: false, example: true, count: 0, lastChosen: 0, createdAt: t, updatedAt: t });
    const p = (name, emoji, cuisine, type) => ({ id: uid(), kind: 'place', name, emoji, cuisine, type, tags: [], link: '', note: '', fav: false, example: true, count: 0, lastChosen: 0, createdAt: t, updatedAt: t });
    return {
      version: 1,
      items: [
        d('Spaghetti Bolognese', '🍝', ['Hackfleisch', 'Nudeln', 'Tomatensoße', 'Knoblauch'], 'normal'),
        d('Chili con Carne', '🌶️', ['Hackfleisch', 'Bohnen', 'Scharf'], 'normal'),
        d('Hähnchen-Curry', '🍛', ['Hähnchen', 'Reis', 'Kokosmilch', 'Scharf'], 'normal'),
        d('Ofengemüse mit Feta', '🥦', ['Gemüse', 'Feta', 'Vegetarisch', 'Ofen'], 'quick'),
        d('Lasagne', '🫕', ['Hackfleisch', 'Nudeln', 'Käse', 'Ofen'], 'long'),
        d('Wraps', '🌯', ['Hähnchen', 'Salat', 'Soße'], 'quick'),
        d('Kartoffelsuppe', '🍲', ['Kartoffeln', 'Suppe', 'Vegetarisch'], 'normal'),
        { ...d('Pfannkuchen', '🥞', ['Vegetarisch'], 'quick'), taste: 'sweet' },
        p('Unser Mexikaner', '🌮', 'Mexikanisch', 'restaurant'),
        p('Döner um die Ecke', '🥙', 'Türkisch', 'restaurant'),
        p('Pizza bestellen', '🍕', 'Pizza', 'delivery'),
        p('Sushi bestellen', '🍣', 'Japanisch', 'delivery'),
        p('Der Inder', '🍛', 'Indisch', 'restaurant'),
      ],
      history: []
    };
  }

  let db;
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      db = raw ? JSON.parse(raw) : seed();
      if (!Array.isArray(db.items)) db = seed();
      if (!Array.isArray(db.history)) db.history = [];
    } catch (_) { db = seed(); }
    db.dirty = Array.isArray(db.dirty) ? db.dirty : [];          // geänderte Einträge, noch nicht hochgeladen
    db.dirtyHist = Array.isArray(db.dirtyHist) ? db.dirtyHist : [];
    db.dirtyImg = Array.isArray(db.dirtyImg) ? db.dirtyImg : [];  // neue Fotos, noch nicht hochgeladen
    db.tomb = db.tomb && typeof db.tomb === 'object' ? db.tomb : {}; // gelöschte Einträge: id → {kind, at}
    fillExamples();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (_) { toast('Speichern hat nicht geklappt – ist der Speicher voll?'); }
  }
  function markDirty(id) { if (!db.dirty.includes(id)) db.dirty.push(id); scheduleSync(); }
  function removeItem(id) {
    const it = db.items.find(i => i.id === id);
    if (!it) return;
    db.items = db.items.filter(i => i.id !== id);
    db.tomb[id] = { kind: it.kind, at: now() };
    markDirty(id);
  }
  const items = (kind) => db.items.filter(i => i.kind === kind);
  const byId = (id) => db.items.find(i => i.id === id);

  // ---------- State ----------
  const state = {
    view: 'home',
    mode: 'dish',
    listKind: 'dish',
    search: '',
    filter: {
      dish: { tags: new Set(), effort: null, taste: null },
      place: { cuisines: new Set(), type: null },
      mix: { kinds: new Set(MIX_DEFAULT) }
    },
    deck: { dish: null, place: null, mix: null },        // Reihenfolge der Karten (IDs), null = neu mischen
    accepted: { dish: null, place: null, mix: null },    // heute gewählt (wird unten aus dem Tagesstand geladen)
    flying: false
  };

  // ---------- Tagesstand: maximal 2× Nö pro Bereich und Tag ----------
  const MAX_NOPES = 2;
  const DAILY_KEY = 'pick.daily';
  const todayKey = () => new Date().toLocaleDateString('sv-SE');   // JJJJ-MM-TT, lokale Zeit
  let daily;
  function loadDaily() {
    try { daily = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null'); } catch (_) { daily = null; }
    if (!daily || daily.date !== todayKey()) {
      daily = { date: todayKey(), nopes: { dish: 0, place: 0, mix: 0 }, accepted: { dish: null, place: null, mix: null }, prev: {} };
    }
    state.accepted = daily.accepted;
  }
  function saveDaily() { try { localStorage.setItem(DAILY_KEY, JSON.stringify(daily)); } catch (_) {} }
  function checkDay() { if (daily && daily.date !== todayKey()) { loadDaily(); resetDeck('dish'); resetDeck('place'); resetDeck('mix'); } }
  const nopesLeft = (m = state.mode) => Math.max(0, MAX_NOPES - (daily.nopes[m] || 0));

  // ---------- Filter & Mischen ----------
  function matches(it) {
    if (it.kind === 'dish') {
      const f = state.filter.dish;
      if (f.effort && it.effort !== f.effort) return false;
      if (f.taste && tasteOf(it) !== f.taste) return false;
      const tags = new Set((it.tags || []).map(t => t.toLowerCase()));
      for (const t of f.tags) if (!tags.has(t.toLowerCase())) return false;
      return true;
    }
    const f = state.filter.place;
    if (f.type && it.type !== f.type) return false;
    if (f.cuisines.size && !f.cuisines.has(it.cuisine)) return false;
    return true;
  }
  const mixKey = (it) => it.kind === 'dish' ? 'dish' : (it.type === 'delivery' ? 'delivery' : 'restaurant');
  const closedToday = (it) => it.kind === 'place' && Array.isArray(it.closed) && it.closed.includes(new Date().getDay());
  const itemsFor = (mode) => mode === 'mix' ? db.items.filter(i => i.kind === 'dish' || i.kind === 'place') : items(mode);
  const pool = (mode = state.mode) => mode === 'mix'
    ? itemsFor('mix').filter(i => state.filter.mix.kinds.has(mixKey(i)) && !closedToday(i))
    : items(mode).filter(i => matches(i) && !closedToday(i));
  function weight(it) {
    let w = it.fav ? 2.2 : 1;
    if (it.lastChosen) {
      const days = (now() - it.lastChosen) / DAY;
      if (days < 3) w *= 0.12;        // gerade erst gehabt
      else if (days < 7) w *= 0.45;
      else if (days > 21) w *= 1.4;   // lange nicht mehr
    }
    return w;
  }
  // gewichtetes Mischen: Favoriten und lange nicht Gegessenes eher vorne
  function shuffle(list) {
    return list.map(i => ({ id: i.id, k: Math.pow(Math.random(), 1 / weight(i)) }))
      .sort((a, b) => b.k - a.k).map(x => x.id);
  }
  function deck() {
    const m = state.mode;
    const valid = new Set(pool(m).map(i => i.id));
    if (!state.deck[m]) state.deck[m] = m === 'mix' ? shuffleMix(pool(m)) : shuffle(pool(m));
    state.deck[m] = state.deck[m].filter(id => valid.has(id));
    return state.deck[m];
  }
  // Zufall: jede Kartengruppe für sich mischen, dann per Münzwurf abwechselnd ziehen.
  // So kommt "kochen" vs. "essen gehen" etwa gleich oft dran, egal wie viele Einträge es je gibt.
  function shuffleMix(list) {
    const groups = {};
    for (const it of list) (groups[mixKey(it)] ||= []).push(it);
    const queues = Object.values(groups).map(shuffle);
    const out = [];
    while (queues.some(q => q.length)) {
      const open = queues.filter(q => q.length);
      out.push(open[Math.floor(Math.random() * open.length)].shift());
    }
    return out;
  }
  const resetDeck = (m = state.mode) => { state.deck[m] = null; if (m !== 'mix') state.deck.mix = null; };
  function defaultFilter(m) {
    return m === 'dish' ? { tags: new Set(), effort: null, taste: null }
      : m === 'place' ? { cuisines: new Set(), type: null }
      : { kinds: new Set(MIX_DEFAULT) };
  }

  function tagStats() {
    const m = new Map();
    for (const it of items('dish')) for (const t of it.tags || []) {
      const k = t.toLowerCase();
      if (k === 'süß' || k === 'herzhaft') continue;   // dafür gibt es den eigenen Geschmack-Filter
      const e = m.get(k) || { label: t, n: 0 }; e.n++; m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'de'));
  }
  function cuisineStats() {
    const m = new Map();
    for (const it of items('place')) if (it.cuisine) m.set(it.cuisine, (m.get(it.cuisine) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(e => e[0]);
  }
  function filterCount() {
    const f = state.filter[state.mode];
    if (state.mode === 'mix') {
      const same = f.kinds.size === MIX_DEFAULT.length && MIX_DEFAULT.every(k => f.kinds.has(k));
      return same ? 0 : f.kinds.size;
    }
    return state.mode === 'dish' ? f.tags.size + (f.effort ? 1 : 0) + (f.taste ? 1 : 0) : f.cuisines.size + (f.type ? 1 : 0);
  }

  // ---------- Karten ----------
  function kicker(it) {
    if (state.mode === 'mix') {
      if (it.kind === 'dish') return `🍳 Selbst kochen${it.effort === 'quick' ? ' · ⚡ Schnell' : ''}${it.fav ? ' · ★' : ''}`;
      return `${it.type === 'delivery' ? '🛵 Bestellen' : '🍽️ Essen gehen'}${it.fav ? ' · ★' : ''}`;
    }
    if (it.kind === 'dish') return `${it.effort === 'quick' ? '⚡ ' : ''}${EFFORT[it.effort] || 'Gericht'}${tasteOf(it) === 'sweet' ? ' · 🍰 Süß' : ''}${it.fav ? ' · ★' : ''}`;
    return `${it.type === 'delivery' ? '🛵' : '🍽️'} ${PLACE_TYPE[it.type] || 'Ort'}${it.fav ? ' · ★' : ''}`;
  }
  function metaLine(it) {
    if (it.kind === 'dish') return (it.tags || []).slice(0, 4).join(' · ');
    return [it.cuisine, it.note].filter(Boolean).join(' · ');
  }
  function cardHTML(it, pos, chosen) {
    return `<div class="card ${pos === 0 ? 'top' : 'pos-' + pos} ${hasPhoto(it) ? 'has-photo' : ''} ${chosen ? 'chosen' : ''}" data-id="${it.id}" style="${grad(it.id)}">
      <div class="emoji">${esc(it.emoji || '🍽️')}</div>
      ${photoTag(it, 'draggable="false"')}
      <div class="shade"></div>
      <span class="stamp yes">${chosen ? 'HEUTE!' : 'JA!'}</span><span class="stamp no">NÖ</span>
      <div class="info">
        <span class="kicker">${esc(kicker(it))}</span>
        <h2>${esc(it.name)}</h2>
        ${metaLine(it) ? `<p>${esc(metaLine(it))}</p>` : ''}
      </div>
    </div>`;
  }

  function renderToday() {
    document.body.dataset.mode = state.mode;
    $$('#view-today .seg-mode .seg-btn').forEach(b => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on);
    });
    const deckEl = $('#deck'), ctrl = $('#controls');
    const isDish = state.mode === 'dish';
    const fc = filterCount();
    const filterBtn = `<button class="round" data-filter aria-label="Filter">${ICON_FILTER}${fc ? `<span class="badge">${fc}</span>` : ''}</button>`;

    // 1. Noch nichts gespeichert
    if (!itemsFor(state.mode).length) {
      const isMix = state.mode === 'mix';
      deckEl.innerHTML = `<div class="empty-card"><div>
        <div class="big">${isDish || isMix ? '🥄' : '🗺️'}</div>
        <h2>${isMix ? 'Noch nichts gespeichert' : isDish ? 'Noch keine Gerichte' : 'Noch keine Orte'}</h2>
        <p>Legt eure Lieblinge an – dann wischt ihr euch durch.</p></div></div>`;
      ctrl.innerHTML = `<button class="btn btn-primary" data-add="${isMix ? 'dish' : state.mode}">${isDish || isMix ? 'Erstes Gericht anlegen' : 'Ersten Ort anlegen'}</button>`;
      return;
    }
    // 2. Heute schon gewählt
    const acc = state.accepted[state.mode] && byId(state.accepted[state.mode]);
    if (acc) {
      deckEl.innerHTML = cardHTML(acc, 0, true).replace('class="card top', 'class="card tappable');
      $('.card', deckEl).addEventListener('click', () => openDetail(acc.id));
      const link = safeUrl(acc.link);
      const label = acc.kind === 'dish' ? 'Rezept öffnen' : (acc.type === 'delivery' ? 'Jetzt bestellen' : 'Route / Website');
      ctrl.innerHTML = `
        ${link ? `<a class="btn btn-primary" href="${esc(link)}" target="_blank" rel="noopener">${label}</a>` : ''}
        ${nopesLeft() ? `<button class="btn btn-soft" data-undo>Doch was anderes (noch ${nopesLeft()}× Nö)</button>`
                      : `<div class="hint">Entschieden ist entschieden. Morgen gibt's wieder neue Karten.</div>`}`;
      hydrate(deckEl);
      return;
    }
    // 3. Filter lassen nichts übrig
    if (!pool().length) {
      deckEl.innerHTML = `<div class="empty-card"><div><div class="big">🤷</div>
        <h2>Nichts passt</h2><p>Mit diesen Filtern bleibt keine Karte übrig.</p></div></div>`;
      ctrl.innerHTML = `<button class="btn btn-primary" data-reset>Filter löschen</button>${filterBtn}`;
      return;
    }
    // 4. Alle Karten weggewischt
    const d = deck();
    if (!d.length) {
      deckEl.innerHTML = `<div class="empty-card"><div><div class="big">🙈</div>
        <h2>Alles weggewischt</h2><p>Heute war nichts dabei? Dann einmal neu mischen.</p></div></div>`;
      ctrl.innerHTML = `<button class="btn btn-primary" data-reshuffle>Neu mischen</button>${filterBtn}`;
      return;
    }
    // 5. Kartenstapel
    const visible = d.slice(0, 3).map(byId).filter(Boolean);
    deckEl.innerHTML = visible.map((it, i) => ({ it, i })).reverse().map(({ it, i }) => cardHTML(it, i)).join('');
    const left = nopesLeft();
    const hint = !left ? '<div class="hint last">Kein Nö mehr übrig – die Karte wird\'s heute!</div>'
      : !localStorage.getItem('pick.swiped') ? `<div class="hint">Rechts wischen = machen wir, links = nö (${left}× möglich)</div>`
      : `<div class="hint">Noch ${left}× Nö</div>`;
    ctrl.innerHTML = `
      <button class="round no" data-nope aria-label="Nö, noch ${left} übrig" ${left ? '' : 'disabled'}>${ICON_X}<span class="badge">${left}</span></button>
      <button class="round yes" data-yes aria-label="Machen wir">${ICON_HEART}</button>
      ${filterBtn}
      ${hint}`;
    const top = $('.card.top', deckEl);
    if (top && !left) top.classList.add('final');
    if (top) bindSwipe(top);
    hydrate(deckEl);
  }

  // ---------- Wischen ----------
  function bindSwipe(card) {
    let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, active = false, armed = 0;
    const yes = $('.stamp.yes', card), no = $('.stamp.no', card);
    const next = () => $('.card.pos-1');
    const apply = () => {
      if (dx < 0 && !nopesLeft()) dx = dx * 0.25;   // Widerstand: nach links geht nichts mehr
      card.style.transform = `translate(${dx}px, ${dy * 0.35}px) rotate(${dx / 18}deg)`;
      yes.style.opacity = clamp01(dx / 110);
      no.style.opacity = nopesLeft() ? clamp01(-dx / 110) : 0;
      const n = next();
      if (n) { const p = clamp01(Math.abs(dx) / 140); n.style.transform = `translateY(${12 - 12 * p}px) scale(${0.95 + 0.05 * p})`; n.style.filter = `brightness(${0.92 + 0.08 * p})`; }
      const a = dx > 110 ? 1 : dx < -110 ? -1 : 0;
      if (a && a !== armed) buzz(8);
      armed = a;
    };
    card.addEventListener('pointerdown', (e) => {
      if (state.flying) return;
      active = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now();
      card.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
      const n = next(); if (n) n.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (!active) return;
      dx = e.clientX - sx; dy = e.clientY - sy; apply();
    });
    const end = () => {
      if (!active) return;
      active = false;
      if (Math.hypot(dx, dy) < 8 && performance.now() - t0 < 400) {   // Antippen statt Wischen
        card.style.transform = ''; return openDetail(card.dataset.id);
      }
      const v = dx / Math.max(1, performance.now() - t0);
      if (dx > 110 || (v > 0.55 && dx > 40)) return fly(card, 'right', dy);
      if (dx < -110 || (v < -0.55 && dx < -40)) return fly(card, 'left', dy);
      if (!nopesLeft() && dx < -20) { toast('Kein Nö mehr übrig – die wird\'s heute! 😄'); buzz([30, 40, 30]); }
      card.style.transition = 'transform .35s cubic-bezier(.3,1.5,.5,1)';
      dx = dy = 0; apply();
      const n = next(); if (n) { n.style.transition = 'transform .3s, filter .3s'; n.style.transform = ''; n.style.filter = ''; }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  function fly(card, dir, dy = 0) {
    if (state.flying || !card) return;
    if (dir === 'left' && !nopesLeft()) {
      card.style.transition = 'transform .35s cubic-bezier(.3,1.5,.5,1)'; card.style.transform = '';
      toast('Kein Nö mehr übrig – die wird\'s heute! 😄'); buzz([30, 40, 30]);
      return;
    }
    state.flying = true;
    try { localStorage.setItem('pick.swiped', '1'); } catch (_) {}
    const sign = dir === 'right' ? 1 : -1;
    $('.stamp.' + (dir === 'right' ? 'yes' : 'no'), card).style.opacity = 1;
    const n = $('.card.pos-1');
    if (n) { n.style.transition = 'transform .3s, filter .3s'; n.style.transform = 'none'; n.style.filter = 'none'; }
    buzz(dir === 'right' ? [15, 50, 25] : 10);
    const done = () => { state.flying = false; commit(dir, card.dataset.id); };
    if (reduced()) return done();
    card.style.transition = 'transform .38s cubic-bezier(.4,.1,.8,.6)';
    card.style.transform = `translate(${sign * (window.innerWidth + 200)}px, ${dy * 0.35 + 40}px) rotate(${sign * 28}deg)`;
    setTimeout(done, 340);
  }

  function commit(dir, id) {
    const d = state.deck[state.mode] || [];
    state.deck[state.mode] = d.filter(x => x !== id);
    if (dir === 'right') return accept(id);
    daily.nopes[state.mode] = (daily.nopes[state.mode] || 0) + 1;
    saveDaily();
    renderToday();
  }

  function accept(id) {
    const it = byId(id); if (!it) return renderToday();
    const h = { id: uid(), itemId: it.id, name: it.name, emoji: it.emoji, kind: it.kind, at: now() };
    daily.prev[state.mode] = { lastChosen: it.lastChosen || 0, count: it.count || 0, histId: h.id };
    it.lastChosen = now(); it.count = (it.count || 0) + 1; it.updatedAt = now();
    db.history.unshift(h);
    db.history = db.history.slice(0, 60);
    db.dirtyHist.push(h.id);
    markDirty(it.id);
    state.accepted[state.mode] = it.id;
    saveDaily(); save();
    renderToday();
  }
  // "Doch was anderes": zählt als Nö und nimmt die Wahl zurück
  function undoAccept() {
    const m = state.mode;
    if (!nopesLeft(m)) return;
    const it = byId(state.accepted[m]), prev = daily.prev[m];
    if (it && prev) {
      it.lastChosen = prev.lastChosen; it.count = prev.count; it.updatedAt = now(); markDirty(it.id);
      if (db.dirtyHist.includes(prev.histId)) {   // noch nicht hochgeladen → aus dem Verlauf nehmen
        db.history = db.history.filter(h => h.id !== prev.histId);
        db.dirtyHist = db.dirtyHist.filter(id => id !== prev.histId);
      }
    }
    state.accepted[m] = null; daily.prev[m] = null;
    daily.nopes[m] = (daily.nopes[m] || 0) + 1;
    saveDaily(); save();
    renderToday();
  }

  // ---------- Filter-Sheet ----------
  function openFilter() {
    sheetMode = 'filter';
    renderFilterSheet();
    openSheet();
  }
  function renderFilterSheet() {
    const isDish = state.mode === 'dish', isMix = state.mode === 'mix';
    let html = `<div class="grabber"></div><h2 id="sheet-title">Filter</h2>`;
    if (isMix) {
      const f = state.filter.mix;
      html += `<div class="field"><span class="lbl">Was darf beim Zufall drankommen?</span><div class="chips">${Object.entries(MIX_KINDS).map(([k, v]) =>
        `<button class="chip ${f.kinds.has(k) ? 'on' : ''}" data-f-kind="${k}">${v}</button>`).join('')}</div></div>`;
    } else if (isDish) {
      const f = state.filter.dish;
      html += `<div class="field"><span class="lbl">Geschmack</span><div class="chips">${Object.entries(TASTE).map(([k, v]) =>
        `<button class="chip ${f.taste === k ? 'on' : ''}" data-f-taste="${k}">${v}</button>`).join('')}</div></div>`;
      html += `<div class="field"><span class="lbl">Aufwand</span><div class="chips">${Object.entries(EFFORT).map(([k, v]) =>
        `<button class="chip ${f.effort === k ? 'on' : ''}" data-f-effort="${k}">${k === 'quick' ? '⚡ ' : ''}${v}</button>`).join('')}</div></div>`;
      const tags = tagStats();
      html += `<div class="field"><span class="lbl">Zutaten & Stichworte – alle gewählten müssen drin sein</span><div class="chips">${tags.map(t =>
        `<button class="chip ${[...f.tags].some(x => x.toLowerCase() === t.label.toLowerCase()) ? 'on' : ''}" data-f-tag="${esc(t.label)}">${esc(t.label)}</button>`).join('') || '<span class="note">Noch keine Stichworte vergeben.</span>'}</div></div>`;
    } else {
      const f = state.filter.place;
      html += `<div class="field"><span class="lbl">Art</span><div class="chips">${Object.entries(PLACE_TYPE).map(([k, v]) =>
        `<button class="chip ${f.type === k ? 'on' : ''}" data-f-type="${k}">${k === 'delivery' ? '🛵 ' : '🍽️ '}${v}</button>`).join('')}</div></div>`;
      html += `<div class="field"><span class="lbl">Küche</span><div class="chips">${cuisineStats().map(c =>
        `<button class="chip ${f.cuisines.has(c) ? 'on' : ''}" data-f-cuisine="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>`;
    }
    const n = pool().length;
    const zu = itemsFor(state.mode).filter(closedToday).length;
    if (zu) html += `<p class="note">${zu} ${zu === 1 ? 'Ort hat' : 'Orte haben'} heute Ruhetag und ${zu === 1 ? 'ist' : 'sind'} ausgeblendet.</p>`;
    html += `<div class="sheet-actions">
      <button class="btn btn-primary" data-close>${n} ${isMix ? (n === 1 ? 'Karte' : 'Karten') : isDish ? (n === 1 ? 'Gericht' : 'Gerichte') : (n === 1 ? 'Ort' : 'Orte')} anzeigen</button>
      ${filterCount() ? '<button class="btn btn-soft" data-reset>Filter löschen</button>' : ''}
    </div>`;
    $('#sheet').innerHTML = html;
  }

  // ---------- Sammlung ----------
  function renderList() {
    $('#count-dish').textContent = items('dish').length || '';
    $('#count-place').textContent = items('place').length || '';
    $$('.list-seg').forEach(b => b.classList.toggle('active', b.dataset.kind === state.listKind));
    $('#fab-label').textContent = state.listKind === 'dish' ? 'Gericht' : 'Ort';

    const q = state.search.trim().toLowerCase();
    const list = items(state.listKind)
      .filter(i => !q || [i.name, i.cuisine, i.note, ...(i.tags || [])].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.fav - a.fav) || a.name.localeCompare(b.name, 'de'));
    const el = $('#list');
    if (!list.length) {
      el.innerHTML = `<li class="empty"><div class="big">${q ? '🔍' : (state.listKind === 'dish' ? '🥄' : '🗺️')}</div>
        <p>${q ? 'Nichts gefunden.' : (state.listKind === 'dish' ? 'Hier landen eure Lieblingsgerichte.' : 'Hier landen eure Lieblingsrestaurants und Lieferdienste.')}</p></li>`;
      return;
    }
    el.innerHTML = list.map(i => `<li><button class="tile" data-detail="${i.id}" style="${grad(i.id)}">
      <span class="emoji">${esc(i.emoji || '🍽️')}</span>
      ${photoTag(i)}
      <span class="shade"></span>
      <span class="t-badges"><span>${i.example ? '<span class="mini">Beispiel</span>' : ''}${closedToday(i) ? '<span class="mini">Heute zu</span>' : ''}</span><span>${i.fav ? '<span class="mini">★</span>' : ''}</span></span>
      <span class="t-info"><span class="t-name">${esc(i.name)}</span><span class="t-sub">${esc(i.kind === 'dish' ? (i.tags || []).join(', ') || EFFORT[i.effort] || '' : [PLACE_TYPE[i.type], i.cuisine].filter(Boolean).join(', '))}</span></span>
    </button></li>`).join('');
    hydrate(el);
  }

  // ---------- Mehr ----------
  function renderMore() {
    const hist = db.history.slice(0, 12);
    const examples = db.items.filter(i => i.example).length;
    const mine = items('member').find(x => x.email === me());
    $('#more').innerHTML = `
      <h3 class="home-h" style="margin-top:4px">Helfer</h3>
      <div class="all-list">
        <button class="all-row" data-view="today"><span class="e">🍽️</span>Essen<span class="s">Kochen · Auswärts · Zufall</span></button>
        <button class="all-row" data-view="list"><span class="e">📚</span>Sammlung<span class="s">${items('dish').length} Gerichte · ${items('place').length} Orte</span></button>
        <button class="all-row" data-view="shop"><span class="e">🛒</span>Einkauf<span class="s">${shopOpenCount()} offen</span></button>
        <button class="all-row" data-view="tasks"><span class="e">✅</span>Aufgaben<span class="s">${myOpenToday()} für heute</span></button>
        ${HELPERS_SOON.map(([e, n]) => `<button class="all-row soon" data-soon="${n}"><span class="e">${e}</span>${n}<span class="s">bald</span></button>`).join('')}
      </div>
      ${auth ? `<div class="card-box">
        <h2>Ihr zwei</h2>
        <div class="who-row">${members().map(m => `<span class="who-chip">${avatar(m.email)} ${esc(m.name)}${m.email === me() ? ' <small>(ich)</small>' : ''}</span>`).join('')}</div>
        <div class="name-row" style="margin-top:12px">
          <input class="input" id="my-name" value="${esc(mine ? mine.name : defaultName(me()))}" placeholder="Dein Name" maxlength="20" autocomplete="given-name">
          <button class="btn btn-soft" data-save-name style="min-height:50px">Speichern</button>
        </div>
        ${partner() ? '' : '<p style="margin:10px 0 0">Sobald sich dein Partner einmal anmeldet, erscheint er hier.</p>'}
      </div>` : ''}
      ${syncCardHTML()}
      <div class="card-box">
        <h2>Zuletzt gegessen</h2>
        ${hist.length ? `<ul class="hist">${hist.map(h => `<li><span class="e">${esc(h.emoji || '🍽️')}</span><span class="n">${esc(h.name)}</span><span class="d">${relDay(h.at)}</span></li>`).join('')}</ul>`
          : '<p>Noch nichts. Sobald ihr eine Karte nach rechts wischt, steht sie hier. Was ihr gerade erst hattet, kommt seltener nach vorne.</p>'}
      </div>
      ${examples ? `<div class="card-box">
        <h2>Beispiele</h2>
        <p>${examples} Einträge sind nur Beispiele. Entfernt sie, sobald eure eigenen drin sind.</p>
        <button class="btn btn-soft" data-clear-examples>Beispiele entfernen</button>
      </div>` : ''}
      <div class="card-box">
        <h2>Daten sichern</h2>
        <p>${auth ? 'Der Sync läuft automatisch. Eine Sicherungsdatei ist trotzdem ein gutes Netz für den Notfall.' : 'Ohne Sync liegt alles nur auf diesem Handy. Mit einer Sicherung könnt ihr die Sammlung aufs andere Handy übertragen.'}</p>
        <div class="stack">
          <button class="btn btn-soft" data-export>Sicherung herunterladen</button>
          <label class="btn btn-soft">Sicherung einspielen<input type="file" accept="application/json,.json" data-import hidden></label>
        </div>
      </div>
      <div class="card-box">
        <h2>Als App installieren</h2>
        <ol class="howto">
          <li><b>iPhone:</b> In Safari öffnen, Teilen-Symbol, „Zum Home-Bildschirm“.</li>
          <li><b>Android:</b> In Chrome öffnen, Menü (⋮), „App installieren“.</li>
        </ol>
      </div>`;
  }

  // ---------- Sheet: Anlegen/Bearbeiten ----------
  let draft = null, confirmDelete = false, sheetMode = null, newPhoto = null;
  function openSheet() {
    $('#backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('#backdrop').hidden = true;
    document.body.style.overflow = '';
    const wasFilter = sheetMode === 'filter';
    draft = null; sheetMode = null; newPhoto = null; detailId = null; tdraft = null;
    if (wasFilter) renderToday();
  }
  function openEditor(kind, id) {
    const existing = id ? byId(id) : null;
    kind = existing ? existing.kind : kind;
    draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: null, kind, name: '', emoji: kind === 'dish' ? '🍝' : '🍽️', tags: [], effort: 'normal',
      type: 'restaurant', cuisine: '', link: '', note: '', fav: false, photo: null,
      ingredients: [], steps: [], address: '', mapsUrl: '', phone: '', hours: '', closed: []
    };
    for (const [k, v] of Object.entries({ ingredients: [], steps: [], address: '', mapsUrl: '', phone: '', hours: '', closed: [] }))
      if (draft[k] === undefined || draft[k] === null) draft[k] = v;
    if (draft.kind === 'dish') draft.taste = tasteOf(draft);
    confirmDelete = false; sheetMode = 'edit'; newPhoto = null;
    renderSheet(false);
    openSheet();
    if (!existing) setTimeout(() => $('#f-name')?.focus(), 250);
  }

  function renderSheet(showEmoji) {
    const d = draft, isDish = d.kind === 'dish', isNew = !d.id;
    const emojis = isDish ? DISH_EMOJI : PLACE_EMOJI;
    const allTags = tagStats().map(t => t.label).filter(t => !d.tags.some(x => x.toLowerCase() === t.toLowerCase())).slice(0, 14);
    const cuisines = [...new Set([...cuisineStats(), ...CUISINES])];
    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <h2 id="sheet-title">${isNew ? (isDish ? 'Neues Gericht' : 'Neuer Ort') : (isDish ? 'Gericht bearbeiten' : 'Ort bearbeiten')}</h2>

      <div class="field">
        <label class="photo-pick ${hasPhoto(d) ? 'has' : ''}">
          ${d.photo ? `<img data-img="${esc(d.photo)}" alt="Foto">` : d.photoUrl ? photoTag(d).replace('class="ph"', 'class="ph loaded"') : `<span><span class="cam">📷</span>${isDish ? 'Foto vom Gericht' : 'Foto vom Ort oder Essen'}<br><small>aufnehmen oder auswählen</small></span>`}
          <input type="file" accept="image/*" data-photo hidden>
        </label>
        ${hasPhoto(d) ? `<div class="photo-actions"><label class="btn btn-soft">Anderes Foto<input type="file" accept="image/*" data-photo hidden></label><button type="button" class="btn btn-soft" data-photo-remove>Foto entfernen</button></div>` : ''}
        <button type="button" class="btn btn-soft ai-btn" data-ai-prompt>✨ Bild mit ChatGPT erstellen</button>
        <p class="ai-hint">Kopiert einen passenden Prompt und öffnet ChatGPT. Bild dort speichern und hier oben als Foto auswählen.</p>
      </div>

      <div class="field">
        <label for="f-name">Name</label>
        <div class="name-row">
          <button type="button" class="emoji-btn" data-emoji-toggle aria-label="Emoji wählen">${esc(d.emoji)}</button>
          <input class="input" id="f-name" value="${esc(d.name)}" placeholder="${isDish ? 'z. B. Omas Gulasch' : 'z. B. Taverne am Markt'}" maxlength="60" autocomplete="off">
        </div>
        ${showEmoji ? `<div class="emoji-grid">${emojis.map(e => `<button type="button" class="${e === d.emoji ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div>` : ''}
      </div>

      ${isDish ? `
      <div class="field">
        <span class="lbl">Zutaten & Stichworte</span>
        <div class="tag-box" id="tag-box">
          ${d.tags.map((t, i) => `<span class="tag">${esc(t)}<button type="button" data-untag="${i}" aria-label="${esc(t)} entfernen">×</button></span>`).join('')}
          <input id="f-tag" placeholder="${d.tags.length ? 'Weiteres …' : 'z. B. Hackfleisch, Knoblauch'}" enterkeyhint="done" autocomplete="off">
        </div>
        ${allTags.length ? `<div class="suggest">${allTags.map(t => `<button type="button" class="chip ghost" data-addtag="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="field">
        <span class="lbl">Geschmack</span>
        <div class="seg">${Object.entries(TASTE).map(([k, v]) => `<button type="button" class="seg-btn ${d.taste === k ? 'active' : ''}" data-set-taste="${k}">${v}</button>`).join('')}</div>
      </div>
      <div class="field">
        <span class="lbl">Aufwand</span>
        <div class="seg">${Object.entries(EFFORT).map(([k, v]) => `<button type="button" class="seg-btn ${d.effort === k ? 'active' : ''}" data-set-effort="${k}">${v}</button>`).join('')}</div>
      </div>
      <div class="field recipe-box">
        <span class="lbl">Rezept</span>
        <div class="btn-row">
          <button type="button" class="btn btn-soft" data-recipe-ai>✨ Von ChatGPT holen</button>
          <button type="button" class="btn btn-soft" data-recipe-paste>📋 Antwort einfügen</button>
        </div>
        ${d._paste ? `<textarea class="input" id="f-paste" placeholder="ChatGPT-Antwort hier einfügen …" style="margin-top:8px;min-height:120px"></textarea>
          <button type="button" class="btn btn-primary" data-apply-paste style="width:100%;margin-top:8px">Übernehmen</button>` : ''}
        <label for="f-ingr" class="sub-lbl">Zutaten – eine pro Zeile</label>
        <textarea class="input" id="f-ingr" placeholder="500 g Rindergulasch&#10;2 Zwiebeln&#10;1 EL Paprikapulver">${esc((d.ingredients || []).join('\n'))}</textarea>
        <label for="f-steps" class="sub-lbl">Zubereitung – ein Schritt pro Zeile</label>
        <textarea class="input" id="f-steps" placeholder="Zwiebeln würfeln und anbraten&#10;Fleisch dazu, kräftig anrösten">${esc((d.steps || []).join('\n'))}</textarea>
      </div>` : `
      <div class="field">
        <span class="lbl">Art</span>
        <div class="seg">${Object.entries(PLACE_TYPE).map(([k, v]) => `<button type="button" class="seg-btn ${d.type === k ? 'active' : ''}" data-set-type="${k}">${v}</button>`).join('')}</div>
      </div>
      <div class="field">
        <label for="f-cuisine">Küche</label>
        <input class="input" id="f-cuisine" value="${esc(d.cuisine)}" placeholder="z. B. Mexikanisch" maxlength="30" autocomplete="off">
        <div class="suggest">${cuisines.slice(0, 16).map(c => `<button type="button" class="chip ${c === d.cuisine ? 'on' : 'ghost'}" data-set-cuisine="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      </div>
      <div class="field">
        <label for="f-address">Adresse</label>
        <input class="input" id="f-address" value="${esc(d.address)}" placeholder="z. B. Hauptstraße 12, Hamburg" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-maps">Google-Maps-Link (optional)</label>
        <input class="input" id="f-maps" type="url" inputmode="url" value="${esc(d.mapsUrl)}" placeholder="In Google Maps: Teilen → Link kopieren" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-phone">Telefon (optional)</label>
        <input class="input" id="f-phone" type="tel" inputmode="tel" value="${esc(d.phone)}" placeholder="z. B. 040 123456" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-hours">Öffnungszeiten (optional)</label>
        <textarea class="input" id="f-hours" placeholder="Di–So 17–23 Uhr">${esc(d.hours)}</textarea>
      </div>
      <div class="field">
        <span class="lbl">Ruhetage – an diesen Tagen kommt der Ort nicht dran</span>
        <div class="chips">${WEEKDAYS.map(([n, l]) => `<button type="button" class="chip ${(d.closed || []).includes(n) ? 'on' : ''}" data-closed-day="${n}">${l}</button>`).join('')}</div>
      </div>`}

      <div class="field">
        <label for="f-link">${isDish ? 'Link zum Original-Rezept (optional)' : 'Website, Speisekarte oder Lieferdienst (optional)'}</label>
        <input class="input" id="f-link" type="url" inputmode="url" value="${esc(d.link)}" placeholder="https://…" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-note">Notiz (optional)</label>
        <textarea class="input" id="f-note" maxlength="300" placeholder="${isDish ? 'z. B. doppelt Knoblauch, Rest einfrieren' : 'z. B. Dienstag Ruhetag, die Nr. 23 nehmen'}">${esc(d.note)}</textarea>
      </div>
      <div class="field">
        <label class="toggle"><span>Favorit – kommt öfter nach vorne</span><input type="checkbox" id="f-fav" ${d.fav ? 'checked' : ''}></label>
      </div>

      <div class="sheet-actions">
        <button class="btn btn-primary" data-save>Speichern</button>
        <button class="btn btn-soft" data-close>Abbrechen</button>
        ${!isNew ? `<button class="btn btn-danger" data-delete>${confirmDelete ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}
      </div>`;
    hydrate($('#sheet'));
  }

  function pullForm() {
    if (!draft) return;
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
    if (v('f-name') !== undefined) draft.name = v('f-name');
    if (v('f-link') !== undefined) draft.link = v('f-link');
    if (v('f-note') !== undefined) draft.note = v('f-note');
    if (v('f-cuisine') !== undefined) draft.cuisine = v('f-cuisine');
    const lines = (x) => x.split('\n').map(l => l.trim()).filter(Boolean);
    if (v('f-ingr') !== undefined) draft.ingredients = lines(v('f-ingr'));
    if (v('f-steps') !== undefined) draft.steps = lines(v('f-steps'));
    for (const [id, key] of [['f-address', 'address'], ['f-maps', 'mapsUrl'], ['f-phone', 'phone'], ['f-hours', 'hours']])
      if (v(id) !== undefined) draft[key] = v(id);
    const fav = document.getElementById('f-fav'); if (fav) draft.fav = fav.checked;
    const tagIn = document.getElementById('f-tag');
    if (tagIn && tagIn.value.trim()) { addTags(tagIn.value); tagIn.value = ''; }
  }
  function addTags(str) {
    for (const raw of String(str).split(/[,;]/)) {
      const t = normTag(raw);
      if (t && !draft.tags.some(x => x.toLowerCase() === t.toLowerCase())) draft.tags.push(t);
    }
  }
  function rerender(showEmoji = false, focusTag = false) {
    const st = $('#sheet').scrollTop;
    renderSheet(showEmoji);
    $('#sheet').scrollTop = st;
    if (focusTag) $('#f-tag')?.focus();
  }
  async function onPhoto(file) {
    if (!draft) return;
    pullForm();
    toast('Foto wird vorbereitet …');
    try {
      const data = await compressImage(file);
      const id = uid();
      await imgPut(id, data);
      draft.photo = id; newPhoto = id;
      rerender();
      toast('Foto übernommen');
    } catch (_) { toast('Dieses Foto ließ sich nicht öffnen.'); }
  }

  // Einheitlicher Prompt, damit alle KI-Bilder im gleichen Look sind
  function aiPrompt(d) {
    const name = d.name.trim();
    let subject;
    if (d.kind === 'dish') {
      subject = `„${name}“` + (d.tags.length ? ` (mit ${d.tags.join(', ')})` : '');
    } else {
      subject = d.cuisine.trim()
        ? `einem typischen Gericht der Küche „${d.cuisine.trim()}“, wie es bei „${name}“ auf den Tisch kommt`
        : `einem Gericht, wie es bei „${name}“ auf den Tisch kommt`;
    }
    return `Erstelle ein fotorealistisches Food-Foto von ${subject}. ` +
      'Angerichtet auf einem Teller, leicht schräg von oben fotografiert, warmes Abendlicht, ' +
      'dunkler Holztisch, geringe Schärfentiefe, appetitlich und natürlich. ' +
      'Hochformat im Seitenverhältnis 3:4. Keine Schrift, keine Logos, keine Hände.';
  }
  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove(); return ok;
  }
  function openAiPrompt() {
    pullForm();
    if (!draft.name.trim()) { toast('Trag erst den Namen ein.'); $('#f-name')?.focus(); return; }
    const prompt = aiPrompt(draft);
    // Kopieren und Öffnen direkt im Tipp auslösen (sonst blockt iOS das neue Fenster)
    copyText(prompt).then(ok => toast(ok ? 'Prompt kopiert – in ChatGPT einfügen' : 'ChatGPT geöffnet'));
    window.open('https://chatgpt.com/?q=' + encodeURIComponent(prompt), '_blank', 'noopener');
  }

  // ---------- Rezept von ChatGPT ----------
  function recipePrompt(d) {
    return `Gib mir ein einfaches, alltagstaugliches Rezept für „${d.name.trim()}“ für 2 Personen` +
      (d.tags.length ? ` (Stichworte: ${d.tags.join(', ')})` : '') + '. ' +
      'Antworte genau in diesem Format und ohne weiteren Text:\n\nZUTATEN:\n- Menge Zutat\n- …\n\nZUBEREITUNG:\n1. Schritt\n2. …';
  }
  function parseRecipe(text) {
    const ingredients = [], steps = [];
    let mode = null;
    // Gibt es Überschriften, wird Einleitungstext davor ignoriert ("Hier ist dein Rezept:")
    const hasHeaders = /(^|\n)\W*zutaten\b/i.test(String(text));
    for (let line of String(text).split(/\r?\n/)) {
      line = line.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
      if (!line) continue;
      if (/^zutaten\b/i.test(line)) { mode = 'i'; continue; }
      if (/^(zubereitung|anleitung|schritte|so geht'?s)\b/i.test(line)) { mode = 's'; continue; }
      const isNum = /^\d+[.)]\s/.test(line);
      const clean = line.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim();
      if (!clean) continue;
      if (!mode && hasHeaders) continue;
      if (mode === 's' || (!mode && isNum)) steps.push(clean); else ingredients.push(clean);
    }
    return { ingredients, steps };
  }
  function openRecipeAi() {
    pullForm();
    if (!draft.name.trim()) { toast('Trag erst den Namen ein.'); $('#f-name')?.focus(); return; }
    const prompt = recipePrompt(draft);
    copyText(prompt).then(ok => toast(ok ? 'Prompt kopiert – Antwort danach hier einfügen' : 'ChatGPT geöffnet'));
    window.open('https://chatgpt.com/?q=' + encodeURIComponent(prompt), '_blank', 'noopener');
  }
  function applyRecipe(text) {
    const r = parseRecipe(text);
    if (!r.ingredients.length && !r.steps.length) { toast('Darin hab ich kein Rezept gefunden.'); return false; }
    draft.ingredients = r.ingredients; draft.steps = r.steps; draft._paste = false;
    rerender();
    toast(`${r.ingredients.length} Zutaten und ${r.steps.length} Schritte übernommen`);
    return true;
  }
  async function pasteRecipe() {
    pullForm();
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (_) {}
    if (text && applyRecipe(text)) return;
    draft._paste = true; rerender();   // Fallback: Feld zum manuellen Einfügen
    setTimeout(() => $('#f-paste')?.focus(), 50);
  }

  // ---------- Detailansicht ----------
  let detailId = null;
  function openDetail(id) {
    if (!byId(id)) return;
    draft = null; detailId = id; sheetMode = 'detail';
    renderDetail();
    openSheet();
    $('#sheet').scrollTop = 0;
  }
  function mapsLink(it) {
    return safeUrl(it.mapsUrl) || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([it.name, it.address].filter(Boolean).join(', '));
  }
  function renderDetail() {
    const it = byId(detailId); if (!it) return closeSheet();
    const isDish = it.kind === 'dish';
    const link = safeUrl(it.link);
    const hero = `<div class="d-hero ${hasPhoto(it) ? 'has-photo' : ''}" style="${grad(it.id)}">
        <div class="emoji">${esc(it.emoji || '🍽️')}</div>
        ${photoTag(it)}
      </div>`;
    let body = '';
    if (isDish) {
      const ing = it.ingredients || [], st = it.steps || [];
      body += (it.tags || []).length ? `<div class="chips d-tags">${it.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : '';
      if (ing.length) body += `<div class="d-sec"><h3>Zutaten <small>für 2</small></h3>
          <ul class="ingr">${ing.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <button class="btn btn-primary" data-shop-from="${it.id}" style="width:100%">🛒 Auf die Einkaufsliste</button></div>`;
      if (st.length) body += `<div class="d-sec"><h3>Zubereitung</h3><ol class="steps">${st.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
      if (!ing.length && !st.length) body += `<div class="d-sec empty-recipe"><p>Noch kein Rezept hinterlegt.</p>
          <button class="btn btn-soft" data-edit="${it.id}" style="width:100%">Rezept ergänzen</button></div>`;
      if (it.note) body += `<div class="d-sec"><h3>Notiz</h3><p>${esc(it.note)}</p></div>`;
      if (link) body += `<a class="btn btn-soft" href="${esc(link)}" target="_blank" rel="noopener">Original-Rezept öffnen</a>`;
    } else {
      if (closedToday(it)) body += `<div class="closed-banner">Heute Ruhetag</div>`;
      const closedNames = WEEKDAYS.filter(([n]) => (it.closed || []).includes(n)).map(([, l]) => l);
      const rows = [
        it.cuisine && `<div><span>Küche</span><b>${esc(it.cuisine)}</b></div>`,
        it.address && `<div><span>Adresse</span><b>${esc(it.address)}</b></div>`,
        it.hours && `<div><span>Geöffnet</span><b class="pre">${esc(it.hours)}</b></div>`,
        closedNames.length && `<div><span>Ruhetag</span><b>${closedNames.join(', ')}</b></div>`,
        it.phone && `<div><span>Telefon</span><b>${esc(it.phone)}</b></div>`
      ].filter(Boolean).join('');
      if (rows) body += `<div class="d-sec info-list">${rows}</div>`;
      if (it.address) body += `<div class="map"><iframe title="Karte" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
          src="https://maps.google.com/maps?q=${encodeURIComponent(it.address)}&z=15&output=embed"></iframe></div>`;
      body += `<div class="stack">
        <a class="btn btn-primary" href="${esc(mapsLink(it))}" target="_blank" rel="noopener">📍 In Google Maps öffnen</a>
        <p class="note center">Dort seht ihr die aktuellen Öffnungszeiten und Bewertungen.</p>
        ${it.phone ? `<a class="btn btn-soft" href="tel:${esc(it.phone.replace(/[^\d+]/g, ''))}">📞 Anrufen</a>` : ''}
        ${link ? `<a class="btn btn-soft" href="${esc(link)}" target="_blank" rel="noopener">${it.type === 'delivery' ? '🛵 Bestellen' : '🌐 Website / Speisekarte'}</a>` : ''}
      </div>`;
      if (it.note) body += `<div class="d-sec"><h3>Notiz</h3><p>${esc(it.note)}</p></div>`;
    }
    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      ${hero}
      <span class="kicker dark">${esc(kicker(it))}</span>
      <h2 id="sheet-title" class="d-title">${esc(it.name)}</h2>
      ${body}
      <div class="sheet-actions">
        <button class="btn btn-soft" data-edit="${it.id}">Bearbeiten</button>
        <button class="btn btn-soft" data-close>Schließen</button>
      </div>`;
    hydrate($('#sheet'));
  }

  // ---------- Einkaufsliste (im Stil von Bring) ----------
  // Katalog: Name, Emoji, Kategorie. Reihenfolge der Kategorien = Weg durch den Supermarkt.
  const SHOP_CATS = ['Obst & Gemüse', 'Brot & Backwaren', 'Milch & Käse', 'Fleisch & Fisch', 'Nudeln, Reis & Co.',
    'Zutaten & Gewürze', 'Konserven & Soßen', 'Tiefkühl', 'Snacks & Süßes', 'Getränke', 'Haushalt', 'Pflege', 'Sonstiges'];
  const CATALOG = [
    ['Äpfel','🍎',0],['Bananen','🍌',0],['Zitronen','🍋',0],['Limetten','🍋',0],['Orangen','🍊',0],['Trauben','🍇',0],['Erdbeeren','🍓',0],
    ['Avocado','🥑',0],['Tomaten','🍅',0],['Kirschtomaten','🍅',0],['Gurke','🥒',0],['Paprika','🫑',0],['Zucchini','🥒',0],['Aubergine','🍆',0],
    ['Möhren','🥕',0],['Kartoffeln','🥔',0],['Süßkartoffeln','🍠',0],['Zwiebeln','🧅',0],['Rote Zwiebeln','🧅',0],['Knoblauch','🧄',0],
    ['Ingwer','🫚',0],['Lauch','🥬',0],['Salat','🥬',0],['Eisbergsalat','🥬',0],['Spinat','🥬',0],['Brokkoli','🥦',0],['Blumenkohl','🥦',0],
    ['Pilze','🍄',0],['Champignons','🍄',0],['Mais','🌽',0],['Frühlingszwiebeln','🧅',0],['Petersilie','🌿',0],['Basilikum','🌿',0],['Koriander','🌿',0],
    ['Chili','🌶️',0],['Kräuter','🌿',0],
    ['Brot','🍞',1],['Brötchen','🥖',1],['Toast','🍞',1],['Baguette','🥖',1],['Tortillas','🫓',1],['Wraps','🫓',1],['Naan','🫓',1],['Croissants','🥐',1],
    ['Milch','🥛',2],['Butter','🧈',2],['Sahne','🥛',2],['Schmand','🥛',2],['Joghurt','🥛',2],['Quark','🥛',2],['Eier','🥚',2],
    ['Käse','🧀',2],['Gouda','🧀',2],['Mozzarella','🧀',2],['Parmesan','🧀',2],['Feta','🧀',2],['Frischkäse','🧀',2],['Reibekäse','🧀',2],
    ['Hackfleisch','🥩',3],['Rinderhack','🥩',3],['Rindfleisch','🥩',3],['Gulasch','🥩',3],['Hähnchen','🍗',3],['Hähnchenbrust','🍗',3],
    ['Schnitzel','🥩',3],['Wurst','🌭',3],['Schinken','🥓',3],['Speck','🥓',3],['Salami','🍕',3],['Lachs','🐟',3],['Fisch','🐟',3],['Garnelen','🍤',3],
    ['Spaghetti','🍝',4],['Nudeln','🍝',4],['Lasagneplatten','🍝',4],['Reis','🍚',4],['Basmatireis','🍚',4],['Couscous','🍚',4],['Haferflocken','🥣',4],['Müsli','🥣',4],
    ['Mehl','🌾',5],['Zucker','🍬',5],['Salz','🧂',5],['Pfeffer','🧂',5],['Paprikapulver','🌶️',5],['Currypaste','🍛',5],['Kreuzkümmel','🧂',5],
    ['Oregano','🌿',5],['Zimt','🧂',5],['Öl','🫒',5],['Olivenöl','🫒',5],['Essig','🫙',5],['Brühe','🥣',5],['Gemüsebrühe','🥣',5],['Senf','🫙',5],['Honig','🍯',5],
    ['Passierte Tomaten','🥫',6],['Gehackte Tomaten','🥫',6],['Tomatenmark','🥫',6],['Kokosmilch','🥥',6],['Kidneybohnen','🫘',6],['Bohnen','🫘',6],
    ['Kichererbsen','🫘',6],['Ketchup','🥫',6],['Mayo','🫙',6],['Sojasoße','🫙',6],['Pesto','🫙',6],['Marmelade','🍓',6],['Nutella','🍫',6],['Apfelmus','🍎',6],
    ['Pizza','🍕',7],['Pommes','🍟',7],['Eis','🍨',7],['TK-Gemüse','🥦',7],['Spinat (TK)','🥬',7],
    ['Chips','🥔',8],['Schokolade','🍫',8],['Kekse','🍪',8],['Gummibärchen','🍬',8],['Nüsse','🥜',8],
    ['Wasser','💧',9],['Sprudel','💧',9],['Saft','🧃',9],['Cola','🥤',9],['Kaffee','☕',9],['Tee','🍵',9],['Bier','🍺',9],['Wein','🍷',9],
    ['Toilettenpapier','🧻',10],['Klopapier','🧻',10],['Spüli','🧽',10],['Küchenrolle','🧻',10],['Spülmittel','🧽',10],['Spülmaschinentabs','🧽',10],['Waschmittel','🧺',10],['Müllbeutel','🗑️',10],['Alufolie','🧻',10],['Backpapier','🧻',10],
    ['Zahnpasta','🪥',11],['Duschgel','🧴',11],['Shampoo','🧴',11],['Deo','🧴',11],['Taschentücher','🤧',11]
  ].map(([name, emoji, c]) => ({ name, emoji, cat: SHOP_CATS[c] }));
  const KEYWORDS = [  // Teilwörter für eigene Artikel ohne Katalog-Treffer
    ['hack', '🥩', 3], ['rind', '🥩', 3], ['schwein', '🥩', 3], ['hähnchen', '🍗', 3], ['huhn', '🍗', 3], ['fisch', '🐟', 3],
    ['käse', '🧀', 2], ['milch', '🥛', 2], ['joghurt', '🥛', 2], ['sahne', '🥛', 2],
    ['tomate', '🍅', 0], ['zwiebel', '🧅', 0], ['knoblauch', '🧄', 0], ['kartoffel', '🥔', 0], ['paprika', '🫑', 0], ['salat', '🥬', 0], ['apfel', '🍎', 0], ['pilz', '🍄', 0],
    ['brot', '🍞', 1], ['brötchen', '🥖', 1], ['nudel', '🍝', 4], ['reis', '🍚', 4],
    ['öl', '🫒', 5], ['gewürz', '🧂', 5], ['pulver', '🧂', 5], ['soße', '🫙', 6], ['sauce', '🫙', 6], ['dose', '🥫', 6],
    ['saft', '🧃', 9], ['wasser', '💧', 9], ['schoko', '🍫', 8], ['tk', '🧊', 7]
  ];
  const norm = (x) => String(x || '').toLowerCase().trim();
  function lookup(name) {
    const n = norm(name);
    let hit = CATALOG.find(c => norm(c.name) === n);
    if (!hit) hit = CATALOG.filter(c => n.includes(norm(c.name)) && norm(c.name).length >= 3).sort((a, b) => b.name.length - a.name.length)[0];
    if (hit) return { emoji: hit.emoji, cat: hit.cat };
    const k = KEYWORDS.find(([w]) => n.includes(w));
    return k ? { emoji: k[1], cat: SHOP_CATS[k[2]] } : { emoji: '🛒', cat: 'Sonstiges' };
  }
  const shopEmoji = (i) => i.emoji || lookup(i.name).emoji;
  const shopCat = (i) => i.cat || lookup(i.name).cat;

  // "500 g Rindergulasch" → { name: "Rindergulasch", spec: "500 g" }
  const UNITS = 'kg|g|mg|l|ml|cl|EL|TL|Msp\\.?|Prise[n]?|Dose[n]?|kleine Dose|große Dose|Bund|Stück|Stk\\.?|Pck\\.?|Packung(?:en)?|Päckchen|Becher|Glas|Gläser|Zehe[n]?|Scheibe[n]?|cm|Tasse[n]?|Handvoll|Spritzer|Kopf|Köpfe';
  const QTY = '(?:\\d+(?:[.,]\\d+)?|[½¼¾⅓⅔])(?:\\s*[-–\\/]\\s*\\d+(?:[.,]\\d+)?)?';
  const ING_RE = new RegExp(`^(${QTY})?\\s*(?:(${UNITS})\\b\\.?)?\\s*(.+)$`, 'i');
  function parseIngredient(line) {
    let text = String(line).trim().replace(/\s+zum\s+\w+$/i, '').replace(/\s+(?:nach Belieben|optional)$/i, '');
    const m = text.match(ING_RE);
    let spec = '', name = text;
    if (m && (m[1] || m[2])) { spec = [m[1], m[2]].filter(Boolean).join(' '); name = m[3]; }
    const paren = name.match(/\s*\(([^)]*)\)\s*$/);
    if (paren) { spec = spec ? `${spec} (${paren[1]})` : paren[1]; name = name.slice(0, paren.index); }
    name = name.trim();
    // "Salz, Pfeffer" → zwei Artikel
    if (!spec && /,/.test(name) && !/\boder\b/i.test(name)) return name.split(/\s*,\s*/).filter(Boolean).map(n => ({ name: cap(n), spec: '' }));
    return [{ name: cap(name), spec }];
  }
  const STAPLES = ['salz', 'pfeffer', 'öl', 'olivenöl', 'wasser'];

  const shopItems = () => items('shop');
  const shopOpen = () => shopItems().filter(i => !i.done);
  const shopOpenCount = () => shopOpen().length;
  const findShop = (name) => shopItems().find(i => norm(i.name) === norm(name));
  // Fügt hinzu oder holt einen bekannten Artikel zurück auf die Liste
  function addShop(name, spec = '', from = '') {
    name = cap(String(name).trim()); if (!name) return false;
    const ex = findShop(name);
    if (ex && !ex.done) {
      if (spec && ex.spec !== spec) { ex.spec = ex.spec ? `${ex.spec} + ${spec}` : spec; ex.updatedAt = now(); markDirty(ex.id); }
      return false;
    }
    const meta = lookup(name);
    if (ex) {
      Object.assign(ex, { done: false, spec, from, emoji: ex.emoji || meta.emoji, cat: ex.cat || meta.cat, addedBy: auth?.email || '', updatedAt: now() });
      markDirty(ex.id);
    } else {
      const id = uid();
      db.items.push({ id, kind: 'shop', name, spec, from, emoji: meta.emoji, cat: meta.cat, done: false, addedBy: auth?.email || '', createdAt: now(), updatedAt: now() });
      markDirty(id);
    }
    return true;
  }

  function openShopAdd(id) {
    const it = byId(id); if (!it) return;
    sheetMode = 'shopadd'; detailId = id;
    const list = (it.ingredients || []).flatMap(parseIngredient);
    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <h2 id="sheet-title">Auf die Einkaufsliste</h2>
      <p class="note">Haken raus bei allem, was ihr schon zu Hause habt.</p>
      <ul class="check-list">${list.map((x, i) => {
        const onList = findShop(x.name) && !findShop(x.name).done;
        const staple = STAPLES.includes(norm(x.name));
        return `<li><label><input type="checkbox" data-ingr="${i}" data-name="${esc(x.name)}" data-spec="${esc(x.spec)}" ${staple || onList ? '' : 'checked'}>
          <span class="ci-emoji">${lookup(x.name).emoji}</span><span class="ci-txt">${esc(x.name)}${x.spec ? `<small>${esc(x.spec)}</small>` : ''}${onList ? '<small>steht schon drauf</small>' : ''}</span></label></li>`;
      }).join('')}</ul>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-shop-confirm>Hinzufügen</button>
        <button class="btn btn-soft" data-detail-back>Zurück</button>
      </div>`;
    $('#sheet').scrollTop = 0;
  }
  function confirmShopAdd() {
    const it = byId(detailId); if (!it) return closeSheet();
    let n = 0;
    $$('#sheet [data-ingr]').forEach(cb => { if (cb.checked && addShop(cb.dataset.name, cb.dataset.spec, it.name)) n++; });
    save(); updateShopBadge();
    toast(n ? `${n} ${n === 1 ? 'Artikel' : 'Artikel'} auf der Einkaufsliste` : 'Stand schon alles auf der Liste');
    openDetail(it.id);
  }

  // Bearbeiten (lange drücken)
  function openShopEdit(id) {
    const it = byId(id); if (!it) return;
    sheetMode = 'shopedit'; detailId = id;
    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <h2 id="sheet-title"><span class="se-emoji">${shopEmoji(it)}</span> ${esc(it.name)}</h2>
      <div class="field"><label for="se-spec">Menge / Hinweis</label>
        <input class="input" id="se-spec" value="${esc(it.spec || '')}" placeholder="z. B. 500 g, 2 Stück, die große Packung" autocomplete="off"></div>
      <div class="field"><label for="se-name">Name</label>
        <input class="input" id="se-name" value="${esc(it.name)}" autocomplete="off"></div>
      ${it.from ? `<p class="note">Für: ${esc(it.from)}</p>` : ''}
      <div class="sheet-actions">
        <button class="btn btn-primary" data-shop-save>Speichern</button>
        ${it.done ? '' : '<button class="btn btn-soft" data-shop-buy-sheet>Gekauft</button>'}
        <button class="btn btn-danger" data-shop-delete>Ganz entfernen</button>
      </div>`;
    openSheet();
    setTimeout(() => $('#se-spec')?.focus(), 250);
  }
  function saveShopEdit() {
    const it = byId(detailId); if (!it) return closeSheet();
    const name = cap($('#se-name').value.trim());
    if (name && name !== it.name) { const m = lookup(name); it.name = name; it.emoji = m.emoji; it.cat = m.cat; }
    it.spec = $('#se-spec').value.trim(); it.updatedAt = now(); markDirty(it.id);
    save(); closeSheet(); renderShop();
  }

  function buyShop(id, tile) {
    const it = byId(id); if (!it) return;
    it.done = true; it.updatedAt = now(); markDirty(it.id); save(); buzz(10);   // Menge bleibt für Rückgängig; beim erneuten Hinzufügen wird sie zurückgesetzt
    const go = () => { renderShop(); updateShopBadge(); };
    if (tile && !reduced()) { tile.classList.add('bought'); setTimeout(go, 220); } else go();
    shopUndo = id; undoFn = undoBuy; toast(`${it.name} gekauft`, 'Rückgängig');
  }
  let shopUndo = null, undoFn = null;
  function undoBuy() {
    const it = byId(shopUndo); shopUndo = null; if (!it) return;
    it.done = false; it.updatedAt = now(); markDirty(it.id); save(); renderShop(); updateShopBadge();
  }

  // Aufbau: Eingabefeld bleibt stehen, nur der Inhalt darunter wird neu gezeichnet (Tastatur bleibt offen)
  let shopQuery = '';
  function tile(i, kind) {
    const label = kind === 'open' ? 'Gekauft' : 'Hinzufügen';
    return `<button class="stile ${kind}" ${kind === 'open' ? `data-shop-tile="${i.id}"` : kind === 'recent' ? `data-shop-recent="${i.id}"` : `data-shop-new="${esc(i.name)}"`} aria-label="${esc(i.name)} – ${label}">
      <span class="st-emoji">${kind === 'cat' || kind === 'new' ? i.emoji : shopEmoji(i)}</span>
      <span class="st-name">${esc(i.name)}</span>
      ${i.spec && kind === 'open' ? `<span class="st-spec">${esc(i.spec)}</span>` : ''}
    </button>`;
  }
  function renderShop() {
    const root = $('#shop');
    if (!$('#shop-input', root)) {
      root.innerHTML = `
        <form class="shop-search" data-shop-form>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          <input id="shop-input" placeholder="Was brauchen wir?" autocomplete="off" enterkeyhint="done" autocapitalize="sentences">
          <button type="button" class="clear" data-shop-clear-q aria-label="Eingabe löschen" hidden>×</button>
        </form>
        <div id="shop-body"></div>`;
      $('#shop-input').addEventListener('input', (e) => { shopQuery = e.target.value; renderShopBody(); });
      $('#shop-input').value = shopQuery;
    }
    renderShopBody();
  }
  function renderShopBody() {
    const body = $('#shop-body'); if (!body) return;
    $('[data-shop-clear-q]').hidden = !shopQuery;
    const q = norm(shopQuery);
    if (q) {
      // Vorschläge: eigener Eintrag + Katalog + Zuletzt verwendet
      const seen = new Set();
      const sugg = [];
      const push = (o) => { const k = norm(o.name); if (!seen.has(k)) { seen.add(k); sugg.push(o); } };
      shopItems().filter(i => norm(i.name).includes(q)).forEach(i => push({ name: i.name, emoji: shopEmoji(i), onList: !i.done }));
      CATALOG.filter(c => norm(c.name).includes(q)).forEach(c => push({ name: c.name, emoji: c.emoji }));
      const exact = sugg.some(o => norm(o.name) === q);
      const typed = cap(shopQuery.trim());
      body.innerHTML = `
        <div class="sgrid">
          ${exact ? '' : tile({ name: typed, emoji: lookup(typed).emoji }, 'new')}
          ${sugg.slice(0, 23).map(o => o.onList
            ? `<div class="stile open dim"><span class="st-emoji">${o.emoji}</span><span class="st-name">${esc(o.name)}</span><span class="st-spec">steht drauf</span></div>`
            : tile(o, 'new')).join('')}
        </div>
        <p class="note center">Tippen zum Hinzufügen – mehrere mit Komma trennen und Enter.</p>`;
      return;
    }
    const open = shopOpen();
    const groups = SHOP_CATS.map(c => [c, open.filter(i => shopCat(i) === c).sort((a, b) => a.name.localeCompare(b.name, 'de'))]).filter(([, l]) => l.length);
    const recent = shopItems().filter(i => i.done).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 24);
    body.innerHTML = `
      ${open.length ? groups.map(([c, l]) => `<h3 class="shop-h">${c}</h3><div class="sgrid">${l.map(i => tile(i, 'open')).join('')}</div>`).join('')
        : `<div class="empty"><div class="big">🎉</div><p>Alles da! Oben eintippen, was fehlt – oder Zutaten über ein Rezept übernehmen.</p></div>`}
      ${recent.length ? `<h3 class="shop-h muted">Zuletzt verwendet</h3><div class="sgrid">${recent.map(i => tile(i, 'recent')).join('')}</div>` : ''}
      <details class="browse"><summary>Alle Artikel durchstöbern</summary>
        ${SHOP_CATS.slice(0, -1).map(c => `<h3 class="shop-h muted">${c}</h3><div class="sgrid">${
          CATALOG.filter(x => x.cat === c && !(findShop(x.name) && !findShop(x.name).done)).map(x => tile(x, 'cat')).join('')}</div>`).join('')}
      </details>
      ${open.length ? '<p class="note center">Antippen = gekauft · lange drücken = Menge ändern</p>' : ''}`;
  }
  function updateShopBadge() {
    const n = shopOpenCount(), b = $('#shop-badge');
    if (b) { b.textContent = n; b.hidden = !n; }
  }

  // Lange drücken auf eine Kachel → bearbeiten
  let lpTimer = null, lpFired = false;
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('[data-shop-tile], [data-shop-recent]'); if (!t) return;
    lpFired = false; clearTimeout(lpTimer);
    lpTimer = setTimeout(() => { lpFired = true; buzz(15); openShopEdit(t.dataset.shopTile || t.dataset.shopRecent); }, 480);
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'scroll'].forEach(ev => document.addEventListener(ev, () => clearTimeout(lpTimer), true));
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('.stile')) e.preventDefault(); });

  function saveDraft() {
    pullForm();
    const name = draft.name.trim();
    if (!name) { toast('Gib dem Ganzen noch einen Namen.'); $('#f-name')?.focus(); return; }
    const data = {
      name, emoji: draft.emoji, link: draft.link.trim(), note: draft.note.trim(), fav: !!draft.fav,
      photo: draft.photo || null,
      photoUrl: draft.photo ? null : (draft.photoUrl || null),
      tags: draft.kind === 'dish' ? draft.tags : [],
      effort: draft.kind === 'dish' ? draft.effort : undefined,
      taste: draft.kind === 'dish' ? draft.taste : undefined,
      type: draft.kind === 'place' ? draft.type : undefined,
      cuisine: draft.kind === 'place' ? normTag(draft.cuisine) : undefined,
      ingredients: draft.kind === 'dish' ? draft.ingredients : undefined,
      steps: draft.kind === 'dish' ? draft.steps : undefined,
      address: draft.kind === 'place' ? draft.address.trim() : undefined,
      mapsUrl: draft.kind === 'place' ? draft.mapsUrl.trim() : undefined,
      phone: draft.kind === 'place' ? draft.phone.trim() : undefined,
      hours: draft.kind === 'place' ? draft.hours.trim() : undefined,
      closed: draft.kind === 'place' ? draft.closed : undefined,
      updatedAt: now()
    };
    if (newPhoto && data.photo === newPhoto && !db.dirtyImg.includes(newPhoto)) db.dirtyImg.push(newPhoto);
    if (draft.id) {
      const it = byId(draft.id);
      Object.assign(it, data, { example: false });
      markDirty(it.id);
      toast('Gespeichert');
    } else {
      const id = uid();
      db.items.push({ id, kind: draft.kind, count: 0, lastChosen: 0, createdAt: now(), example: false, ...data });
      markDirty(id);
      state.deck[draft.kind]?.unshift(id);   // neue Karte gleich als nächstes zeigen
      state.deck.mix = null;
      toast(draft.kind === 'dish' ? 'Gericht hinzugefügt' : 'Ort hinzugefügt');
    }
    save(); closeSheet(); renderAll();
  }
  function deleteDraft() {
    if (!confirmDelete) { pullForm(); confirmDelete = true; rerender(); return; }
    removeItem(draft.id);
    for (const k of ['dish', 'place', 'mix']) if (state.accepted[k] === draft.id) state.accepted[k] = null;
    saveDaily();
    save(); closeSheet(); renderAll(); toast('Gelöscht');
  }

  // ---------- Export / Import ----------
  async function exportData() {
    const images = {};
    for (const it of db.items) if (it.photo) { const d = await imgGet(it.photo); if (d) images[it.photo] = d; }
    const out = { version: 2, items: db.items, history: db.history, images };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pick-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.items)) throw new Error('format');
      if (data.images && typeof data.images === 'object') {
        for (const [id, img] of Object.entries(data.images)) {
          if (typeof img === 'string' && img.startsWith('data:image/')) { await imgPut(id, img); if (!db.dirtyImg.includes(id)) db.dirtyImg.push(id); }
        }
      }
      const map = new Map(db.items.map(i => [i.id, i]));
      let added = 0, updated = 0;
      for (const it of data.items) {
        if (!it || !it.id || !['dish', 'place', 'shop', 'task', 'member'].includes(it.kind) || !(it.name || it.title || it.email)) continue;
        const ex = map.get(it.id);
        if (!ex) { db.items.push(it); markDirty(it.id); added++; }
        else if ((it.updatedAt || 0) > (ex.updatedAt || 0)) { Object.assign(ex, it); markDirty(it.id); updated++; }
      }
      if (Array.isArray(data.history)) {
        const seen = new Set(db.history.map(h => h.id));
        db.history = [...db.history, ...data.history.filter(h => h && !seen.has(h.id))].sort((a, b) => b.at - a.at).slice(0, 60);
      }
      resetDeck('dish'); resetDeck('place');
      save(); renderAll();
      toast(`Eingespielt: ${added} neu, ${updated} aktualisiert`);
    } catch (_) { toast('Diese Datei ist keine Pick-Sicherung.'); }
  }


  // ---------- Mitglieder (ihr zwei) ----------
  const me = () => (auth && auth.email) || '';
  const defaultName = (email) => cap(String(email).split('@')[0].split(/[._\-+0-9]/)[0] || 'Ich');
  function members() {
    const seen = new Map();
    for (const m of items('member')) if (m.email && !seen.has(m.email)) seen.set(m.email, m);
    if (me() && !seen.has(me())) seen.set(me(), { email: me(), name: defaultName(me()) });
    return [...seen.values()].sort((a, b) => a.email.localeCompare(b.email)).map((m, i) => ({ ...m, idx: i % 2 }));
  }
  const member = (email) => members().find(m => m.email === email);
  const partner = () => members().find(m => m.email !== me());
  const nameOf = (email) => (member(email) || {}).name || defaultName(email || '?');
  function ensureMember() {
    if (!me() || items('member').some(m => m.email === me())) return;
    const id = uid();
    db.items.push({ id, kind: 'member', email: me(), name: defaultName(me()), createdAt: now(), updatedAt: now() });
    markDirty(id);
  }
  function avatar(who, cls = 'av') {
    if (who === 'both') return `<span class="${cls} both" title="Beide">${members().map(m => esc(m.name[0] || '?')).join('')}</span>`;
    const m = member(who); if (!m) return '';
    return `<span class="${cls} c${m.idx}" title="${esc(m.name)}">${esc((m.name[0] || '?').toUpperCase())}</span>`;
  }

  // ---------- Aufgaben ----------
  const TASK_CATS = { haushalt: ['🧺', 'Haushalt'], erledigung: ['📦', 'Erledigung'], anruf: ['📞', 'Anruf'], papier: ['📄', 'Papierkram'], selbst: ['🌿', 'Für mich'], sonst: ['✨', 'Sonstiges'] };
  const TASK_MINS = [5, 10, 15, 30, 60];
  const MOTIVATION = ['Einfach anfangen – danach ist es weg.', 'Nur anfangen zählt schon.', 'Klein anfangen, nicht perfekt.', 'Erst das, dann Pause.', 'Timer an und los – du schaffst das.', 'In ein paar Minuten ist es erledigt.'];
  const dayKey = (d) => new Date(d).toLocaleDateString('sv-SE');
  const todayKey2 = () => dayKey(Date.now());
  const addDays = (key, n) => { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return dayKey(d); };
  function dueLabel(key) {
    if (!key) return '';
    const t = todayKey2();
    if (key < t) return 'überfällig';
    if (key === t) return 'heute';
    if (key === addDays(t, 1)) return 'morgen';
    return new Date(key + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const tasks = () => items('task');
  const isOpenToday = (t) => !t.done && (!t.due || t.due <= todayKey2());
  const forMe = (t) => !t.who || t.who === 'both' || t.who === me();
  const tview = { mode: 'next', skip: new Set(), timer: null };
  function nextQueue() {
    const t0 = todayKey2();
    const list = tasks().filter(isOpenToday).sort((a, b) =>
      (forMe(b) - forMe(a)) || ((a.due && a.due < t0 ? 0 : 1) - (b.due && b.due < t0 ? 0 : 1)) ||
      ((a.due ? 0 : 1) - (b.due ? 0 : 1)) || ((a.mins || 15) - (b.mins || 15)) || (a.createdAt - b.createdAt));
    let q = list.filter(t => !tview.skip.has(t.id));
    if (!q.length && list.length) { tview.skip.clear(); q = list; }
    return q;
  }
  const myOpenToday = () => tasks().filter(t => isOpenToday(t) && forMe(t)).length;
  function taskMeta(t) {
    return [t.mins ? `${t.mins} Min` : '', dueLabel(t.due) && dueLabel(t.due) !== 'heute' ? dueLabel(t.due) : '', t.repeat === 'daily' ? '🔁 täglich' : t.repeat === 'weekly' ? '🔁 wöchentlich' : ''].filter(Boolean).join(' · ');
  }
  function taskRow(t) {
    return `<li class="trow ${t.done ? 'done' : ''} ${t.due && t.due < todayKey2() && !t.done ? 'late' : ''}">
      <button class="tchk" data-task-toggle="${t.id}" aria-label="${t.done ? 'Wieder öffnen' : 'Erledigt'}">${t.done ? '✓' : ''}</button>
      <button class="ttxt" data-task-edit="${t.id}"><span>${esc((TASK_CATS[t.cat] || TASK_CATS.sonst)[0])} ${esc(t.title)}</span>${taskMeta(t) ? `<small>${esc(taskMeta(t))}</small>` : ''}</button>
      ${t.who ? avatar(t.who, 'mini-av') : ''}
    </li>`;
  }
  function fmtTimer(ms) { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function renderTasks() {
    $$('.task-seg').forEach(b => b.classList.toggle('active', b.dataset.tview === tview.mode));
    const el = $('#tasks'), t0 = todayKey2();
    if (tview.mode === 'next') {
      const q = nextQueue(), t = q[0];
      const today = tasks().filter(x => isOpenToday(x) || (x.done && x.doneAt && dayKey(x.doneAt) === t0))
        .sort((a, b) => (a.done - b.done) || ((a.mins || 15) - (b.mins || 15)));
      let card;
      if (t) {
        const cat = TASK_CATS[t.cat] || TASK_CATS.sonst;
        const running = tview.timer && tview.timer.id === t.id;
        let h = 0; for (const c of t.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        card = `<div class="tcard ${running ? 'running' : ''}" id="tcard" data-id="${t.id}">
            <span class="kicker tk">⏱ ${t.mins || 15} Min · ${cat[0]} ${esc(cat[1])}</span>
            ${t.who ? `<span class="tc-who">${avatar(t.who, 'av')}</span>` : ''}
            <h2>${esc(t.title)}</h2>
            <p id="timer-txt">${running ? `⏱ noch ${fmtTimer(tview.timer.end - Date.now())}` : esc(MOTIVATION[h % MOTIVATION.length])}</p>
          </div>
          <div class="controls tctrl">
            <button class="round" data-task-skip aria-label="Später">↷</button>
            <button class="round yes" data-task-done aria-label="Erledigt"><svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:3.4"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <button class="round ${running ? 'on' : ''}" data-task-timer aria-label="${running ? 'Timer stoppen' : 'Timer starten'}">⏱</button>
          </div>
          ${q.length > 1 ? `<p class="note center">Danach noch ${q.length - 1} für heute</p>` : ''}`;
      } else {
        card = `<div class="tcard empty"><div class="big">🎉</div><h2>${tasks().length ? 'Für heute alles erledigt!' : 'Noch keine Aufgaben'}</h2>
          <p>${tasks().length ? 'Gönnt euch eine Pause.' : 'Tippt oben auf +, um die erste anzulegen.'}</p></div>
          <div class="controls"><button class="btn btn-primary" data-task-new>Aufgabe anlegen</button></div>`;
      }
      el.innerHTML = card + (today.length ? `<h3 class="home-h">Heute</h3><ul class="tlist">${today.map(taskRow).join('')}</ul>` : '');
      return;
    }
    if (tview.mode === 'all') {
      const open = tasks().filter(x => !x.done);
      const groups = [
        ['Überfällig', open.filter(x => x.due && x.due < t0)],
        ['Heute', open.filter(x => x.due === t0)],
        ['Morgen', open.filter(x => x.due === addDays(t0, 1))],
        ['Später', open.filter(x => x.due && x.due > addDays(t0, 1)).sort((a, b) => a.due.localeCompare(b.due))],
        ['Ohne Datum', open.filter(x => !x.due)]
      ].filter(([, l]) => l.length);
      el.innerHTML = groups.length ? groups.map(([n, l]) => `<h3 class="home-h">${n}</h3><ul class="tlist">${l.map(taskRow).join('')}</ul>`).join('')
        : `<div class="tcard empty"><div class="big">🗒️</div><h2>Nichts offen</h2><p>Neue Aufgaben über das + oben.</p></div>`;
      return;
    }
    const done = tasks().filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 40);
    el.innerHTML = done.length ? `<ul class="tlist">${done.map(taskRow).join('')}</ul>`
      : `<div class="tcard empty"><div class="big">💪</div><h2>Noch nichts erledigt</h2><p>Hier sammelt sich, was ihr geschafft habt.</p></div>`;
  }
  function completeTask(id, fromCard) {
    const t = byId(id); if (!t) return;
    const before = { done: t.done, doneAt: t.doneAt, due: t.due };
    if (tview.timer && tview.timer.id === id) tview.timer = null;
    if (t.repeat && t.repeat !== 'none') {
      const base = t.due && t.due > todayKey2() ? t.due : todayKey2();
      t.due = addDays(base, t.repeat === 'daily' ? 1 : 7); t.lastDone = now();
      toast(`Erledigt! 🎉 Wieder dran: ${dueLabel(t.due)}`, 'Rückgängig');
    } else {
      t.done = true; t.doneAt = now();
      toast('Erledigt! 🎉', 'Rückgängig');
    }
    undoFn = () => { Object.assign(t, before); t.updatedAt = now(); markDirty(t.id); save(); renderTasks(); updateBadges(); };
    t.updatedAt = now(); markDirty(t.id); save(); buzz([20, 60, 20]);
    const card = fromCard && $('#tcard');
    const go = () => { renderTasks(); updateBadges(); };
    if (card && !reduced()) { card.classList.add('fly-done'); setTimeout(go, 280); } else go();
  }
  function toggleTask(id) {
    const t = byId(id); if (!t) return;
    if (!t.done) return completeTask(id, false);
    t.done = false; t.doneAt = null; t.updatedAt = now(); markDirty(t.id); save(); renderTasks(); updateBadges();
  }
  // Timer
  setInterval(() => {
    if (!tview.timer) return;
    const left = tview.timer.end - Date.now();
    const el = $('#timer-txt');
    if (el && $('#tcard')?.dataset.id === tview.timer.id) el.textContent = `⏱ noch ${fmtTimer(left)}`;
    if (left <= 0) {
      tview.timer = null; buzz([200, 100, 200, 100, 300]);
      toast('⏱ Zeit ist um – geschafft?');
      if (state.view === 'tasks') renderTasks();
    }
  }, 1000);

  // Aufgabe anlegen / bearbeiten
  let tdraft = null;
  function openTaskEditor(id) {
    const ex = id ? byId(id) : null;
    tdraft = ex ? { ...ex } : { id: null, title: '', mins: 10, cat: 'haushalt', who: 'both', due: todayKey2(), repeat: 'none' };
    sheetMode = 'task'; renderTaskSheet(); openSheet();
    if (!ex) setTimeout(() => $('#td-title')?.focus(), 250);
  }
  function renderTaskSheet() {
    const d = tdraft, t0 = todayKey2(), p = partner();
    const chip = (attr, val, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}="${val}">${label}</button>`;
    const whenSel = !d.due ? 'none' : d.due === t0 ? 'today' : d.due === addDays(t0, 1) ? 'tomorrow' : 'date';
    $('#sheet').innerHTML = `
      <div class="grabber"></div>
      <h2 id="sheet-title">${d.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</h2>
      <div class="field"><label for="td-title">Was ist zu tun?</label>
        <input class="input" id="td-title" value="${esc(d.title)}" placeholder="z. B. Wäsche aufhängen" maxlength="80" autocomplete="off" enterkeyhint="done"></div>
      <div class="field"><span class="lbl">Wie lange ungefähr?</span><div class="chips">${TASK_MINS.map(m => chip('data-td-mins', m, `${m} Min`, d.mins === m)).join('')}</div></div>
      <div class="field"><span class="lbl">Art</span><div class="chips">${Object.entries(TASK_CATS).map(([k, [e, n]]) => chip('data-td-cat', k, `${e} ${n}`, d.cat === k)).join('')}</div></div>
      <div class="field"><span class="lbl">Wer?</span><div class="chips">
        ${chip('data-td-who', me(), `${esc(nameOf(me()))} (ich)`, d.who === me())}
        ${p ? chip('data-td-who', p.email, esc(p.name), d.who === p.email) : ''}
        ${chip('data-td-who', 'both', 'Beide', d.who === 'both' || !d.who)}
      </div>${p ? '' : '<p class="note" style="margin-top:8px">Sobald sich dein Partner einmal anmeldet, kannst du Aufgaben auch direkt zuweisen.</p>'}</div>
      <div class="field"><span class="lbl">Wann?</span><div class="chips">
        ${chip('data-td-when', 'today', 'Heute', whenSel === 'today')}${chip('data-td-when', 'tomorrow', 'Morgen', whenSel === 'tomorrow')}
        ${chip('data-td-when', 'none', 'Irgendwann', whenSel === 'none')}
        <input type="date" class="input date-in ${whenSel === 'date' ? 'on' : ''}" id="td-date" value="${whenSel === 'date' ? d.due : ''}" min="${t0}" aria-label="Datum wählen">
      </div></div>
      <div class="field"><span class="lbl">Wiederholen</span><div class="chips">
        ${chip('data-td-rep', 'none', 'Nein', !d.repeat || d.repeat === 'none')}${chip('data-td-rep', 'daily', 'Täglich', d.repeat === 'daily')}${chip('data-td-rep', 'weekly', 'Wöchentlich', d.repeat === 'weekly')}
      </div></div>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-td-save>Speichern</button>
        <button class="btn btn-soft" data-close>Abbrechen</button>
        ${d.id ? `<button class="btn btn-danger" data-td-delete>${d._confirm ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}
      </div>`;
  }
  function pullTask() { const v = $('#td-title'); if (v) tdraft.title = v.value; const dt = $('#td-date'); if (dt && dt.value) tdraft.due = dt.value; }
  function rerenderTask() { const st = $('#sheet').scrollTop; renderTaskSheet(); $('#sheet').scrollTop = st; }
  function saveTask() {
    pullTask();
    const title = tdraft.title.trim();
    if (!title) { toast('Was ist denn zu tun?'); $('#td-title')?.focus(); return; }
    const data = { title, mins: tdraft.mins, cat: tdraft.cat, who: tdraft.who || 'both', due: tdraft.due || '', repeat: tdraft.repeat || 'none', updatedAt: now() };
    if (tdraft.id) { Object.assign(byId(tdraft.id), data); markDirty(tdraft.id); toast('Gespeichert'); }
    else { const id = uid(); db.items.push({ id, kind: 'task', done: false, createdBy: me(), createdAt: now(), ...data }); markDirty(id); toast('Aufgabe angelegt'); }
    save(); closeSheet(); renderAll();
  }

  // ---------- Startseite „Heute“ ----------
  const HELPERS_SOON = [['📅', 'Termine', 'Gemeinsamer Kalender', 'navy'], ['🔁', 'Routinen', 'Morgens & abends', ''], ['🎉', 'Freizeit', 'Was machen wir am WE?', '']];
  const shopSeen = () => { try { return +localStorage.getItem('pick.shopSeen') || 0; } catch (_) { return 0; } };
  function newShopByPartner() {
    const seen = shopSeen();
    return shopOpen().filter(i => i.addedBy && i.addedBy !== me() && (i.updatedAt || 0) > seen).length;
  }
  function eatenToday() {
    const id = state.accepted.dish || state.accepted.place || state.accepted.mix;
    return id ? byId(id) : null;
  }
  function renderHome() {
    $('#avatars').innerHTML = members().map(m => avatar(m.email)).join('');
    const d = new Date(), h = d.getHours();
    const two = members().length > 1;
    const greet = (h < 11 ? 'Guten Morgen' : h < 17 ? 'Hey' : 'Guten Abend') + (two ? ' ihr zwei' : '') + ' 👋';
    const eaten = eatenToday(), next = nextQueue()[0], nShop = shopOpenCount();
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    let now;
    if (h >= 16 && h < 22 && !eaten) now = { k: `Jetzt dran · ${time}`, t: 'Was essen wir heute?', b: 'Karten ziehen →', v: 'today' };
    else if (next) now = { k: `Als Nächstes · ⏱ ${next.mins || 15} Min`, t: next.title, b: 'Los geht’s →', v: 'tasks' };
    else if (nShop) now = { k: 'Einkauf', t: `${nShop} ${nShop === 1 ? 'Sache steht' : 'Sachen stehen'} auf der Liste`, b: 'Zur Liste →', v: 'shop' };
    else if (!eaten) now = { k: `Jetzt · ${time}`, t: 'Alles erledigt. Was essen wir später?', b: 'Karten ziehen →', v: 'today' };
    else now = { k: 'Heute', t: 'Alles erledigt – gönnt euch eine Pause 🎉', b: 'Zu den Aufgaben →', v: 'tasks' };
    const p = partner(), nNew = newShopByPartner(), nTasks = myOpenToday();
    $('#home').innerHTML = `
      <div class="home-date">${d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <h1 class="home-hi">${greet}</h1>
      <button class="now" data-view="${now.v}"><div class="k">${esc(now.k)}</div><div class="t">${esc(now.t)}</div><span class="b">${now.b}</span></button>
      <h3 class="home-h">Eure Helfer</h3>
      <div class="mods">
        <button class="mod mint" data-view="today"><span class="e">🍽️</span><span><span class="n">Essen</span><span class="s">${eaten ? `Heute: ${esc(eaten.name)}` : 'Heute noch offen'}</span></span></button>
        <button class="mod coral" data-view="shop"><span class="e">🛒</span><span><span class="n">Einkauf</span><span class="s">${nShop ? `${nShop} Artikel` : 'Alles da'}${nNew && p ? ` · ${esc(p.name)} hat ${nNew} neue` : ''}</span></span></button>
        <button class="mod" data-view="tasks"><span class="e">✅</span><span><span class="n">Aufgaben</span><span class="s">${nTasks ? `${nTasks} für heute` : 'Nichts offen'}</span></span></button>
        ${HELPERS_SOON.map(([e, n, s, c]) => `<button class="mod ${c} soon" data-soon="${n}"><span class="soon-tag">bald</span><span class="e">${e}</span><span><span class="n">${n}</span><span class="s">${s}</span></span></button>`).join('')}
      </div>`;
  }
  function updateBadges() {
    updateShopBadge();
    const b = $('#task-badge'); if (b) { const n = myOpenToday(); b.textContent = n; b.hidden = !n; }
  }
  setInterval(() => { if (state.view === 'home' && document.visibilityState === 'visible' && !sheetMode) renderHome(); }, 60000);

  // ---------- Navigation ----------
  const TAB_OF = { home: 'home', today: 'today', list: 'today', shop: 'shop', tasks: 'tasks', all: 'all' };
  function show(view) {
    if (state.view === 'shop' && view !== 'shop') { try { localStorage.setItem('pick.shopSeen', String(now())); } catch (_) {} }
    state.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === TAB_OF[view]));
    window.scrollTo(0, 0);
    renderAll();
  }
  function renderAll() {
    if (state.flying) return;
    if (state.view === 'home') renderHome();
    else if (state.view === 'today') renderToday();
    else if (state.view === 'list') renderList();
    else if (state.view === 'shop') renderShop();
    else if (state.view === 'tasks') renderTasks();
    else renderMore();
    updateBadges();
  }

  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = esc(msg) + (action ? ` <button id="toast-action">${esc(action)}</button>` : '');
    t.classList.toggle('has-action', !!action);
    t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), action ? 4000 : 2400);
  }

  // ---------- Supabase-Sync ----------
  const CFG = window.HUNGER_CONFIG || window.PICK_CONFIG || {};
  const SB_URL = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  const SB_KEY = String(CFG.supabaseKey || '');
  const syncConfigured = !!(SB_URL && SB_KEY);
  const AUTH_KEY = 'hunger.auth';
  let auth = null;
  const syncState = { busy: false, last: 0, msg: '', error: false };
  try { auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { auth = null; }
  try { syncState.last = +localStorage.getItem('hunger.lastSync') || 0; } catch (_) {}

  function setAuth(j) {
    auth = j ? {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at ? j.expires_at * 1000 : now() + (j.expires_in || 3600) * 1000,
      email: (j.user && j.user.email) || (auth && auth.email) || ''
    } : null;
    try { auth ? localStorage.setItem(AUTH_KEY, JSON.stringify(auth)) : localStorage.removeItem(AUTH_KEY); } catch (_) {}
    lockState();
  }
  // Ohne Anmeldung nur die Startseite zeigen (gilt nur, wenn Supabase eingerichtet ist)
  function lockState() {
    const locked = syncConfigured && !auth;
    document.body.classList.toggle('locked', locked);
    return locked;
  }
  async function gateLogin() {
    const mail = $('#g-mail').value.trim(), pass = $('#g-pass').value, err = $('#g-err'), btn = $('#g-btn');
    if (!mail || !pass) return;
    err.hidden = true; btn.disabled = true; btn.textContent = 'Melde an …';
    try {
      setAuth(await authCall('password', { email: mail, password: pass }));
      $('#g-pass').value = '';
      ensureMember(); save();
      show('home');
      await sync();
      toast('Willkommen zurück!');
    } catch (e) {
      err.textContent = /api key/i.test(e.message) ? 'Der Supabase-Schlüssel in config.js passt nicht zu diesem Projekt.'
        : /not confirmed/i.test(e.message) ? 'Dieser Zugang ist in Supabase noch nicht bestätigt (Auto Confirm).'
        : /invalid login|credentials|invalid_grant/i.test(e.message) ? 'E-Mail oder Passwort stimmt nicht.'
        : /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? `Keine Verbindung zu ${SB_URL.replace(/^https?:\/\//, '')} – bist du online? (${e.message})` : e.message;
      err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Anmelden'; }
  }
  // Abmelden: erst alles hochladen, dann die lokale Kopie auf diesem Handy löschen
  async function logout() {
    try { await sync(); } catch (_) {}
    const left = (db.dirty.length || db.dirtyHist.length || db.dirtyImg.length);
    if (left && !confirm('Ein paar Änderungen sind noch nicht hochgeladen und gehen verloren. Trotzdem abmelden?')) return;
    for (const k of [STORE_KEY, DAILY_KEY, 'hunger.lastSync', 'pick.swiped']) { try { localStorage.removeItem(k); } catch (_) {} }
    try { indexedDB.deleteDatabase('pick-images'); } catch (_) {}
    setAuth(null);
    location.reload();
  }
  async function authCall(grant, body) {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(j.error_description || j.msg || j.message || 'Anmeldung fehlgeschlagen'); e.status = res.status; throw e; }
    return j;
  }
  async function refresh() {
    try { setAuth(await authCall('refresh_token', { refresh_token: auth.refresh_token })); }
    catch (e) {
      if (e.status && e.status < 500) { setAuth(null); throw new Error('Bitte neu anmelden.'); }
      throw e;
    }
  }
  async function api(path, opts = {}, retried = false) {
    if (!auth) throw new Error('Nicht angemeldet');
    if (auth.expires_at - 60000 < now()) await refresh();
    const res = await fetch(SB_URL + path, {
      ...opts,
      headers: { apikey: SB_KEY, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    if (res.status === 401 && !retried) { await refresh(); return api(path, opts, true); }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || `Server antwortet mit Fehler ${res.status}`);
    }
    return res.status === 204 || res.status === 201 ? null : res.json();
  }
  const UPSERT = { Prefer: 'resolution=merge-duplicates,return=minimal' };

  async function doLogin() {
    const mail = $('#l-mail')?.value.trim(), pass = $('#l-pass')?.value;
    if (!mail || !pass) return toast('E-Mail und Passwort eingeben.');
    syncState.msg = 'Melde an …'; syncState.error = false; renderMore();
    try {
      setAuth(await authCall('password', { email: mail, password: pass }));
      syncState.msg = '';
      await sync(true);
      toast('Verbunden – eure Sammlung wird jetzt geteilt.');
    } catch (e) {
      syncState.msg = /invalid/i.test(e.message) ? 'E-Mail oder Passwort stimmt nicht.' : e.message;
      syncState.error = true; renderMore();
    }
  }

  function mergeItems(rows) {
    const map = new Map(db.items.map(i => [i.id, i]));
    const dirty = new Set(db.dirty);
    const remoteIds = new Set();
    let changed = false;
    for (const r of rows) {
      remoteIds.add(r.id);
      const rTs = Date.parse(r.updated_at);
      const local = map.get(r.id), tomb = db.tomb[r.id];
      const lTs = local ? (local.updatedAt || 0) : (tomb ? tomb.at : -1);
      if (lTs > rTs) { dirty.add(r.id); continue; }        // unsere Version ist neuer → hochladen
      if (lTs === rTs) { dirty.delete(r.id); continue; }   // gleich
      dirty.delete(r.id); changed = true;                   // Server ist neuer → übernehmen
      if (r.deleted) {
        if (local) db.items = db.items.filter(i => i.id !== r.id);
        db.tomb[r.id] = { kind: r.kind, at: rTs };
      } else {
        const it = { ...r.data, id: r.id, kind: r.kind, updatedAt: rTs };
        if (local) Object.assign(local, it); else db.items.push(it);
        delete db.tomb[r.id];
      }
    }
    // Erste Verbindung: liegen schon Daten auf dem Server, fliegen die lokalen Beispiele raus
    if (!db.syncedOnce && rows.some(r => !r.deleted)) {
      db.items = db.items.filter(i => !(i.example && !remoteIds.has(i.id)));
      changed = true;
    }
    for (const i of db.items) if (!remoteIds.has(i.id)) dirty.add(i.id);
    for (const id of Object.keys(db.tomb)) if (!remoteIds.has(id)) dirty.add(id);
    db.dirty = [...dirty].filter(id => byId(id) || db.tomb[id]);
    if (changed) { resetDeck('dish'); resetDeck('place'); resetDeck('mix'); }
    return changed;
  }

  let syncTimer = null;
  function scheduleSync() {
    if (!syncConfigured || !auth) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync(), 900);
  }

  async function sync(manual = false) {
    if (!syncConfigured || !auth || syncState.busy) return;
    if (!navigator.onLine) { if (manual) toast('Kein Internet – synchronisiere später.'); return; }
    syncState.busy = true; syncState.error = false;
    if (state.view === 'all') renderMore();
    let changed = false;
    try {
      // 1. Fotos zuerst hochladen (damit das andere Handy sie findet, sobald der Eintrag kommt)
      const imgIds = [...db.dirtyImg];
      for (let i = 0; i < imgIds.length; i += 4) {
        const chunk = [];
        for (const id of imgIds.slice(i, i + 4)) { const d = await imgGet(id); if (d) chunk.push({ id, data: d }); }
        if (chunk.length) await api('/rest/v1/images', { method: 'POST', headers: UPSERT, body: JSON.stringify(chunk) });
      }
      db.dirtyImg = db.dirtyImg.filter(id => !imgIds.includes(id));

      // 2. Einträge holen und zusammenführen
      const rows = await api('/rest/v1/items?select=id,kind,data,deleted,updated_at');
      changed = mergeItems(rows);
      db.syncedOnce = true;
      ensureMember();

      // 3. Eigene Änderungen hochladen
      const pushIds = [...db.dirty];
      if (pushIds.length) {
        const payload = pushIds.map(id => {
          const it = byId(id);
          if (it) {
            const data = { ...it }; delete data.id; delete data.kind;
            return { id, kind: it.kind, data, deleted: false, updated_at: new Date(it.updatedAt || now()).toISOString() };
          }
          const t = db.tomb[id];
          return { id, kind: t.kind, data: {}, deleted: true, updated_at: new Date(t.at).toISOString() };
        });
        // je Bereich getrennt, damit ein Fehler (z. B. fehlendes Datenbank-Update) nicht alles blockiert
        const byKind = {};
        for (const row of payload) (byKind[row.kind] ||= []).push(row);
        const failed = [];
        let lastErr = null;
        for (const [kind, rows2] of Object.entries(byKind)) {
          try { await api('/rest/v1/items', { method: 'POST', headers: UPSERT, body: JSON.stringify(rows2) }); }
          catch (e) { failed.push(...rows2.map(r => r.id)); lastErr = /check constraint|items_kind_check/i.test(e.message)
            ? new Error('Datenbank-Update nötig – siehe Anleitung (SQL-Zeile in Supabase ausführen).') : e; }
        }
        db.dirty = db.dirty.filter(id => !pushIds.includes(id) || failed.includes(id));
        if (lastErr) throw lastErr;
      }

      // 4. Fehlende Fotos vom Server holen
      const want = [...new Set(db.items.map(i => i.photo).filter(Boolean))];
      const missing = [];
      for (const id of want) if (!(await imgGet(id))) missing.push(id);
      for (let i = 0; i < missing.length; i += 6) {
        const got = await api(`/rest/v1/images?select=id,data&id=in.(${missing.slice(i, i + 6).join(',')})`);
        for (const g of got || []) { await imgPut(g.id, g.data); changed = true; }
      }

      // 5. Verlauf
      const hist = await api('/rest/v1/history?select=id,data,at&order=at.desc&limit=60');
      const known = new Set(db.history.map(h => h.id));
      for (const h of hist) if (!known.has(h.id)) db.history.push({ ...h.data, id: h.id, at: Date.parse(h.at) });
      db.history.sort((a, b) => b.at - a.at); db.history = db.history.slice(0, 60);
      const histPush = db.dirtyHist.map(id => db.history.find(h => h.id === id)).filter(Boolean);
      if (histPush.length) {
        await api('/rest/v1/history', { method: 'POST', headers: UPSERT,
          body: JSON.stringify(histPush.map(h => { const d = { ...h }; delete d.id; return { id: h.id, data: d, at: new Date(h.at).toISOString() }; })) });
      }
      db.dirtyHist = [];

      syncState.last = now(); syncState.msg = '';
      try { localStorage.setItem('hunger.lastSync', String(syncState.last)); } catch (_) {}
      save();
      if (manual) toast('Synchronisiert');
    } catch (e) {
      syncState.error = true;
      syncState.msg = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Server nicht erreichbar.' : e.message;
      save();
      if (manual) toast(syncState.msg);
    } finally {
      syncState.busy = false;
      // Kartenstapel nur neu zeichnen, wenn sich etwas geändert hat (sonst springt die Karte unter dem Finger)
      if (!draft && !tdraft && (changed || state.view === 'all')) renderAll();
    }
  }

  function syncCardHTML() {
    if (!syncConfigured) return `<div class="card-box">
        <h2>Gemeinsame Sammlung</h2>
        <p>Noch nicht eingerichtet. Sobald Supabase in <b>config.js</b> eingetragen ist, meldet ihr euch hier an und habt auf beiden Handys denselben Stand.</p>
      </div>`;
    if (!auth) return `<div class="card-box">
        <h2>Gemeinsame Sammlung</h2>
        <p>Meldet euch an, damit eure Gerichte und Orte auf beiden Handys gleich sind.</p>
        <div class="stack">
          <input class="input" id="l-mail" type="email" inputmode="email" autocomplete="username" placeholder="E-Mail">
          <input class="input" id="l-pass" type="password" autocomplete="current-password" placeholder="Passwort">
          ${syncState.msg ? `<p class="${syncState.error ? 'err' : ''}" style="margin:0">${esc(syncState.msg)}</p>` : ''}
          <button class="btn btn-primary" data-login>Anmelden</button>
        </div>
      </div>`;
    const when = syncState.last ? `${relDay(syncState.last)}, ${new Date(syncState.last).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'noch nie';
    const status = syncState.busy ? 'Synchronisiere …'
      : syncState.error ? `Letzter Versuch fehlgeschlagen: ${syncState.msg}`
      : `Zuletzt synchronisiert: ${when}`;
    return `<div class="card-box">
        <h2>Gemeinsame Sammlung</h2>
        <p><span class="dot ${syncState.error ? 'bad' : 'ok'}"></span>Angemeldet als ${esc(auth.email)}</p>
        <p class="${syncState.error ? 'err' : ''}">${esc(status)}</p>
        <div class="btn-row">
          <button class="btn btn-soft" data-sync-now ${syncState.busy ? 'disabled' : ''}>Jetzt synchronisieren</button>
          <button class="btn btn-soft" data-logout>Abmelden</button>
        </div>
      </div>`;
  }

  // ---------- Events ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, label');
    if (!t) { if (e.target.id === 'backdrop') closeSheet(); return; }
    const ds = t.dataset;

    // Navigation & Modus
    if (ds.view) return show(ds.view);
    if (ds.soon) return toast(`${ds.soon} kommt bald 🙂`);
    if (ds.mode && t.closest('#view-today')) { state.mode = ds.mode; return renderToday(); }
    if (ds.kind && t.classList.contains('list-seg')) { state.listKind = ds.kind; return renderList(); }

    // Sheet
    if (t.closest('#sheet')) {
      if ('close' in ds) return closeSheet();
      if (ds.edit) return openEditor(null, ds.edit);
      if (ds.shopFrom) return openShopAdd(ds.shopFrom);
      if ('shopConfirm' in ds) return confirmShopAdd();
      if ('detailBack' in ds) return openDetail(detailId);
      if ('shopSave' in ds) return saveShopEdit();
      if ('shopBuySheet' in ds) { const id = detailId; closeSheet(); return buyShop(id); }
      if ('shopDelete' in ds) { removeItem(detailId); save(); closeSheet(); renderShop(); updateShopBadge(); return toast('Entfernt'); }
      if ('reset' in ds) {
        state.filter[state.mode] = defaultFilter(state.mode);
        resetDeck(); return renderFilterSheet();
      }
      if (ds.fKind) {
        const f = state.filter.mix;
        if (f.kinds.has(ds.fKind)) { if (f.kinds.size > 1) f.kinds.delete(ds.fKind); else toast('Mindestens eins muss dabei sein.'); }
        else f.kinds.add(ds.fKind);
        resetDeck(); return renderFilterSheet();
      }
      if (ds.fTaste) { const f = state.filter.dish; f.taste = f.taste === ds.fTaste ? null : ds.fTaste; resetDeck(); return renderFilterSheet(); }
      if (ds.fEffort) { const f = state.filter.dish; f.effort = f.effort === ds.fEffort ? null : ds.fEffort; resetDeck(); return renderFilterSheet(); }
      if (ds.fTag) {
        const f = state.filter.dish, hit = [...f.tags].find(x => x.toLowerCase() === ds.fTag.toLowerCase());
        hit ? f.tags.delete(hit) : f.tags.add(ds.fTag); resetDeck(); return renderFilterSheet();
      }
      if (ds.fType) { const f = state.filter.place; f.type = f.type === ds.fType ? null : ds.fType; resetDeck(); return renderFilterSheet(); }
      if (ds.fCuisine) { const f = state.filter.place; f.cuisines.has(ds.fCuisine) ? f.cuisines.delete(ds.fCuisine) : f.cuisines.add(ds.fCuisine); resetDeck(); return renderFilterSheet(); }
      if (sheetMode === 'task' && tdraft) {
        if (ds.tdMins) { pullTask(); tdraft.mins = +ds.tdMins; return rerenderTask(); }
        if (ds.tdCat) { pullTask(); tdraft.cat = ds.tdCat; return rerenderTask(); }
        if (ds.tdWho) { pullTask(); tdraft.who = ds.tdWho; return rerenderTask(); }
        if (ds.tdWhen) { pullTask(); const t0 = todayKey2(); tdraft.due = ds.tdWhen === 'today' ? t0 : ds.tdWhen === 'tomorrow' ? addDays(t0, 1) : ''; const dt = $('#td-date'); if (dt) dt.value = ''; return rerenderTask(); }
        if (ds.tdRep) { pullTask(); tdraft.repeat = ds.tdRep; return rerenderTask(); }
        if ('tdSave' in ds) return saveTask();
        if ('tdDelete' in ds) {
          if (!tdraft._confirm) { pullTask(); tdraft._confirm = true; return rerenderTask(); }
          removeItem(tdraft.id); save(); closeSheet(); renderAll(); return toast('Aufgabe gelöscht');
        }
        return;
      }
      if (!draft) return;
      if ('emojiToggle' in ds) { pullForm(); return rerender(!$('.emoji-grid')); }
      if (ds.emoji) { pullForm(); draft.emoji = ds.emoji; return rerender(false); }
      if (ds.untag !== undefined) { pullForm(); draft.tags.splice(+ds.untag, 1); return rerender(false, true); }
      if (ds.addtag) { pullForm(); addTags(ds.addtag); return rerender(false); }
      if (ds.setEffort) { pullForm(); draft.effort = ds.setEffort; return rerender(); }
      if (ds.setTaste) { pullForm(); draft.taste = ds.setTaste; return rerender(); }
      if (ds.setType) { pullForm(); draft.type = ds.setType; return rerender(); }
      if (ds.setCuisine) { pullForm(); draft.cuisine = ds.setCuisine; return rerender(); }
      if ('photoRemove' in ds) { pullForm(); draft.photo = null; draft.photoUrl = null; return rerender(); }
      if ('recipeAi' in ds) return openRecipeAi();
      if ('recipePaste' in ds) return pasteRecipe();
      if ('applyPaste' in ds) { pullForm(); return applyRecipe($('#f-paste')?.value || ''); }
      if (ds.closedDay !== undefined) {
        pullForm(); const n = +ds.closedDay;
        draft.closed = (draft.closed || []).includes(n) ? draft.closed.filter(x => x !== n) : [...(draft.closed || []), n];
        return rerender();
      }
      if ('aiPrompt' in ds) return openAiPrompt();
      if ('save' in ds) return saveDraft();
      if ('delete' in ds) return deleteDraft();
      return;
    }

    // Heute
    if ('nope' in ds) return fly($('.card.top'), 'left');
    if ('yes' in ds) return fly($('.card.top'), 'right');
    if ('filter' in ds) return openFilter();
    if ('reshuffle' in ds) { resetDeck(); return renderToday(); }
    if ('undo' in ds) return undoAccept();
    if ('reset' in ds) {
      state.filter[state.mode] = defaultFilter(state.mode);
      resetDeck(); return renderToday();
    }
    if (ds.add) return openEditor(ds.add);

    // Sammlung
    if (t.id === 'fab') return openEditor(state.listKind);
    if (ds.edit) return openEditor(null, ds.edit);
    if (ds.detail) return openDetail(ds.detail);
    // Aufgaben
    if ('taskNew' in ds) return openTaskEditor(null);
    if (ds.tview) { tview.mode = ds.tview; return renderTasks(); }
    if ('taskSkip' in ds) { const c = $('#tcard'); if (c) { tview.skip.add(c.dataset.id); buzz(8); } return renderTasks(); }
    if ('taskDone' in ds) { const c = $('#tcard'); if (c) completeTask(c.dataset.id, true); return; }
    if ('taskTimer' in ds) {
      const c = $('#tcard'); if (!c) return;
      if (tview.timer && tview.timer.id === c.dataset.id) { tview.timer = null; toast('Timer gestoppt'); }
      else { const tk = byId(c.dataset.id); tview.timer = { id: tk.id, end: Date.now() + (tk.mins || 15) * 60000 }; buzz(15); toast(`Timer läuft: ${tk.mins || 15} Minuten`); }
      return renderTasks();
    }
    if (ds.taskToggle) return toggleTask(ds.taskToggle);
    if (ds.taskEdit) return openTaskEditor(ds.taskEdit);
    if ('saveName' in ds) {
      const v = $('#my-name').value.trim(); if (!v) return;
      ensureMember(); const m = items('member').find(x => x.email === me());
      if (m) { m.name = cap(v); m.updatedAt = now(); markDirty(m.id); save(); toast('Name gespeichert'); renderAll(); }
      return;
    }

    // Einkaufsliste
    if (lpFired && t.closest('.stile')) { lpFired = false; return; }   // war ein langes Drücken
    if (ds.shopTile) return buyShop(ds.shopTile, t);
    if (ds.shopRecent) { const it = byId(ds.shopRecent); if (it) { addShop(it.name); save(); buzz(8); renderShop(); updateShopBadge(); } return; }
    if (ds.shopNew) {
      addShop(ds.shopNew); save(); buzz(8);
      shopQuery = ''; $('#shop-input').value = ''; renderShop(); updateShopBadge();
      return toast(`${ds.shopNew} hinzugefügt`);
    }
    if ('shopClearQ' in ds) { shopQuery = ''; $('#shop-input').value = ''; $('#shop-input').focus(); return renderShopBody(); }
    if (t.id === 'toast-action') { const f = undoFn; undoFn = null; if (f) f(); return; }

    // Mehr
    if ('login' in ds) return doLogin();
    if ('logout' in ds) {
      if (t.dataset.armed) return logout();
      t.dataset.armed = '1'; t.textContent = 'Wirklich abmelden?'; return;
    }
    if ('syncNow' in ds) return sync(true);
    if ('export' in ds) return exportData();
    if ('clearExamples' in ds) {
      const ids = db.items.filter(i => i.example).map(i => i.id);
      ids.forEach(removeItem);
      for (const k of ['dish', 'place', 'mix']) if (ids.includes(state.accepted[k])) state.accepted[k] = null;
      saveDaily();
      resetDeck('dish'); resetDeck('place');
      save(); renderAll(); toast('Beispiele entfernt');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'f-tag' && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault(); pullForm(); rerender(false, true);
    } else if (e.target.id === 'f-tag' && e.key === 'Backspace' && !e.target.value && draft?.tags.length) {
      pullForm(); draft.tags.pop(); rerender(false, true);
    } else if (e.key === 'Enter' && (e.target.id === 'l-pass' || e.target.id === 'l-mail')) {
      e.preventDefault(); doLogin();
    } else if (e.key === 'Enter' && e.target.id === 'td-title') {
      e.preventDefault(); saveTask();
    } else if (e.key === 'Escape' && sheetMode) closeSheet();
    else if (state.view === 'today' && !sheetMode && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      fly($('.card.top'), e.key === 'ArrowRight' ? 'right' : 'left');
    }
  });
  document.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-shop-form]')) return;
    e.preventDefault();
    const inp = $('#shop-input');
    let n = 0;
    for (const part of inp.value.split(/[,;\n]/)) for (const x of parseIngredient(part)) if (x.name && addShop(x.name, x.spec)) n++;
    inp.value = ''; shopQuery = ''; save(); renderShop(); updateShopBadge();
    if (n) toast(n === 1 ? 'Hinzugefügt' : `${n} Artikel hinzugefügt`);
    $('#shop-input')?.focus();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'td-date' && tdraft && e.target.value) { pullTask(); tdraft.due = e.target.value; rerenderTask(); }
    if (e.target.matches('[data-import]') && e.target.files[0]) importData(e.target.files[0]);
    if (e.target.matches('[data-photo]') && e.target.files[0]) onPhoto(e.target.files[0]);
  });
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderList(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const before = daily.date; checkDay(); if (daily.date !== before) renderAll();
    sync();
  });
  window.addEventListener('online', () => sync());
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000);
  // Auf der Einkaufsliste fast live: alle 4 Sekunden nachsehen, was der andere geändert hat
  setInterval(() => { if (state.view === 'shop' && document.visibilityState === 'visible') sync(); }, 4000);

  // ---------- Start ----------
  load();
  loadDaily();
  $('#gate-form').addEventListener('submit', (e) => { e.preventDefault(); gateLogin(); });
  if (!lockState()) { ensureMember(); show('home'); sync(); }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
