/**
 * CineHax+ — port Nuvio/lolplus del plugin Kino (cinehax-plus)
 * Fuente: https://cinehaxplus.com
 */
var DEFAULT_BASE = 'https://cinehaxplus.com';
var UA =
  'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function cfg() {
  return (
    (typeof globalThis !== 'undefined' &&
      globalThis.__nuvioConfig &&
      globalThis.__nuvioConfig.current) ||
    {}
  );
}

function BASE() {
  var b = (cfg().base_url || DEFAULT_BASE).toString().trim().replace(/\/$/, '');
  return b || DEFAULT_BASE;
}

function pestanas() {
  return String(cfg().pestanas || 'ambas').toLowerCase();
}

function siteUrl(href) {
  var s = String(href || '');
  if (/^https?:\/\//i.test(s)) return s;
  var base = BASE();
  return base + (s.charAt(0) === '/' ? s : '/' + s);
}

function parseHref(href) {
  var m = href && String(href).match(/\/(pelicula|serie)\/([^/#?]+)/);
  return m ? { type: m[1], slug: m[2] } : null;
}

function buildId(type, slug) {
  return type + '.' + slug;
}

function yearFromSlug(slug) {
  var m = String(slug || '').match(/-(\d{4})$/);
  return m ? m[1] : null;
}

function decodeEntities(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function textOf(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

async function httpText(url, opts) {
  opts = opts || {};
  var headers = Object.assign(
    {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/json,*/*',
      'Accept-Language': 'es-ES,es;q=0.9',
      Referer: BASE() + '/',
    },
    opts.headers || {}
  );
  var res = await fetch(url, { method: opts.method || 'GET', headers: headers });
  if (!res.ok) return null;
  return await res.text();
}

async function httpJson(url, opts) {
  var txt = await httpText(url, opts);
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

async function getText(url) {
  return await httpText(url);
}

async function getJson(url, opts) {
  return await httpJson(url, opts);
}

function parseCards(html, limit) {
  var max = limit || 100;
  var out = [];
  var seen = {};
  var src = String(html || '');
  var blocks = [];
  var cardRe = /<a class="(?:pc|cd|t10)" href="([^"]+)">([\s\S]*?)<\/a>/g;
  var m;
  while ((m = cardRe.exec(src)) !== null) blocks.push([m[1], m[2]]);
  var rk = /<ol class="rk">([\s\S]*?)<\/ol>/.exec(src);
  if (rk) {
    var liRe = /<li><a href="([^"]+)">([\s\S]*?)<\/a><\/li>/g;
    while ((m = liRe.exec(rk[1])) !== null) blocks.push([m[1], m[2]]);
  }

  for (var bi = 0; bi < blocks.length; bi++) {
    if (out.length >= max) break;
    var href = blocks[bi][0];
    var block = blocks[bi][1];
    var where = parseHref(href);
    if (!where) continue;
    var type = where.type;
    var slug = where.slug;
    var id = buildId(type, slug);
    if (seen[id]) continue;
    seen[id] = 1;

    var titleTag = /<span class="(?:pc-t|cd-t)">([\s\S]*?)<\/span>/.exec(block);
    var alt = /alt="([^"]*)"/.exec(block);
    var title =
      textOf(titleTag ? titleTag[1] : alt ? alt[1] : '') ||
      slug.replace(/-/g, ' ');

    var yearM = /<span>(\d{4})<\/span>/.exec(block);
    var stkM = /class="stk">([\d.]+)</.exec(block);
    var image = (/<img src="(https:\/\/image\.tmdb\.org\/[^"]+)"/.exec(block) ||
      [])[1];
    if (!image) {
      var img2 = (/<img[^>]+src="([^"]+)"/.exec(block) || [])[1];
      if (img2 && img2.indexOf('http') === 0) image = img2;
    }

    out.push({
      type: type,
      slug: slug,
      id: id,
      title: title,
      year: yearM ? yearM[1] : yearFromSlug(slug),
      poster: image || null,
      rating: stkM ? Number(stkM[1]) : null,
    });
  }
  return out;
}

function toContentItem(x) {
  if (!x) return null;
  var isSerie = x.type === 'serie' || x.kind === 'series';
  return {
    id: x.id || buildId(x.type, x.slug),
    title: x.title || (x.slug || '').replace(/-/g, ' '),
    type: isSerie ? 'series' : 'movie',
    poster: x.poster || null,
    backdrop: x.backdrop || x.poster || null,
    year: x.year ? Number(x.year) || x.year : null,
    rating: x.rating != null ? x.rating : null,
    overview: x.overview || '',
    extra: {
      source: 'cinehax',
      type: x.type || (isSerie ? 'serie' : 'pelicula'),
      slug: x.slug || '',
      media: 'video',
    },
  };
}

function filterByPestanas(items) {
  var mode = pestanas();
  if (mode === 'peliculas') {
    return items.filter(function (x) {
      return (x.type || x.extra && x.extra.type) !== 'serie' && x.type !== 'series';
    });
  }
  if (mode === 'series') {
    return items.filter(function (x) {
      return (
        x.type === 'serie' ||
        x.type === 'series' ||
        (x.extra && x.extra.type === 'serie')
      );
    });
  }
  return items;
}

function homeRows(html) {
  var rows = [];
  var sections = String(html || '').split('<section class="row">').slice(1);
  for (var i = 0; i < sections.length; i++) {
    var section = sections[i].split('</section>')[0];
    var titleM = /<h2 class="row-t">([\s\S]*?)<\/h2>/.exec(section);
    var title = titleM ? textOf(titleM[1]) : '';
    if (!title) continue;
    var cards = parseCards(section, 40);
    var items = filterByPestanas(cards).map(toContentItem).filter(Boolean);
    if (!items.length) continue;
    rows.push({
      id: 'row_' + rows.length,
      type: 'row',
      title: title,
      imageStyle: 'poster',
      items: items,
    });
    if (rows.length >= 18) break;
  }
  return rows;
}

async function getHome() {
  var html = await getText(BASE() + '/');
  if (!html) return { rows: [] };
  var rows = homeRows(html);
  if (!rows.length) {
    // fallback listas
    try {
      var p = await getText(BASE() + '/peliculas');
      var items = parseCards(p, 30).map(toContentItem).filter(Boolean);
      if (items.length) {
        rows.push({
          id: 'peliculas',
          type: 'row',
          title: 'Películas',
          imageStyle: 'poster',
          items: items,
        });
      }
    } catch (e) {}
    try {
      var s = await getText(BASE() + '/series');
      var items2 = parseCards(s, 30).map(toContentItem).filter(Boolean);
      if (items2.length) {
        rows.push({
          id: 'series',
          type: 'row',
          title: 'Series',
          imageStyle: 'poster',
          items: items2,
        });
      }
    } catch (e2) {}
  }
  if (rows.length && rows[0].items && rows[0].items[0]) {
    rows.unshift({
      id: 'hero',
      type: 'hero',
      title: rows[0].title,
      imageStyle: 'backdrop',
      items: rows[0].items.slice(0, 10),
    });
  }
  return { rows: rows };
}

async function suggest(text) {
  var body = await getText(
    BASE() + '/api/suggest?q=' + encodeURIComponent(text)
  );
  if (!body) return [];
  var data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    return [];
  }
  var out = [];
  var titles = (data && data.titles) || [];
  for (var i = 0; i < titles.length; i++) {
    var t = titles[i];
    var where = parseHref(t && t.url);
    if (!where) continue;
    out.push({
      type: where.type,
      slug: where.slug,
      title: t.title || where.slug.replace(/-/g, ' '),
      year: t.year ? String(t.year) : yearFromSlug(where.slug),
      poster: t.poster || null,
      rating: typeof t.rating === 'number' ? t.rating : null,
    });
  }
  return out;
}

async function search(query) {
  var q = query;
  if (q && typeof q === 'object') q = q.query || q.q || '';
  q = String(q || '').trim();
  if (!q) return { items: [] };
  var hits = await suggest(q);
  if (!hits.length) {
    // fallback: página de búsqueda HTML si existiera
    try {
      var html = await getText(
        BASE() + '/buscar?q=' + encodeURIComponent(q)
      );
      hits = parseCards(html || '', 40);
    } catch (e) {}
  }
  var items = filterByPestanas(hits).map(toContentItem).filter(Boolean);
  return { items: items };
}

function parseId(id) {
  id = String(id || '').trim();
  // pelicula.slug o serie.slug
  var m = /^(pelicula|serie)\.([^/?#]+)/.exec(id);
  if (m) return { type: m[1], slug: m[2] };
  // cinehax:pelicula:slug
  m = /^cinehax:(pelicula|serie):(.+)$/.exec(id);
  if (m) return { type: m[1], slug: m[2] };
  m = parseHref(id);
  if (m) return m;
  return null;
}

function parseEpisodes(html, slug) {
  var out = [];
  var src = String(html || '');
  // enlaces a episodios
  var re =
    /href="(\/serie\/[^"]+\/temporada\/(\d+)\/episodio\/(\d+)[^"]*)"/g;
  var m;
  var seen = {};
  while ((m = re.exec(src)) !== null) {
    var season = parseInt(m[2], 10);
    var episode = parseInt(m[3], 10);
    var key = season + 'x' + episode;
    if (seen[key]) continue;
    seen[key] = 1;
    var title = 'T' + season + ' E' + episode;
    // intentar título cercano
    var chunk = src.slice(Math.max(0, m.index - 80), m.index + 200);
    var tm = /<(?:span|div|p)[^>]*>([^<]{3,80})<\/(?:span|div|p)>/.exec(chunk);
    if (tm) {
      var tt = textOf(tm[1]);
      if (tt && tt.length < 80) title = tt;
    }
    out.push({
      id: 'serie.' + slug + '.s' + season + 'e' + episode,
      season: season,
      episode: episode,
      title: title,
      still: null,
    });
  }
  out.sort(function (a, b) {
    if (a.season !== b.season) return a.season - b.season;
    return a.episode - b.episode;
  });
  return out;
}

function parseDetail(html) {
  var title =
    textOf((/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html) || [])[1] || '') ||
    textOf(
      (/<meta property="og:title" content="([^"]+)"/.exec(html) || [])[1] || ''
    );
  var overview =
    textOf(
      (/<meta property="og:description" content="([^"]+)"/.exec(html) ||
        [])[1] || ''
    ) ||
    textOf((/<p class="(?:desc|overview|sinopsis)"[^>]*>([\s\S]*?)<\/p>/.exec(html) || [])[1] || '');
  var poster =
    (/<meta property="og:image" content="([^"]+)"/.exec(html) || [])[1] ||
    null;
  var yearM = /\b(19|20)\d{2}\b/.exec(title || '');
  return {
    title: title,
    overview: overview,
    poster: poster,
    year: yearM ? yearM[0] : null,
  };
}

async function getMeta(id) {
  var p = parseId(id);
  if (!p) {
    return { id: id, title: String(id), type: 'movie' };
  }
  var isSerie = p.type === 'serie';
  var url = BASE() + (isSerie ? '/serie/' : '/pelicula/') + p.slug;
  var html = await getText(url);
  var detail = parseDetail(html || '');
  var item = {
    id: buildId(p.type, p.slug),
    title: detail.title || p.slug.replace(/-/g, ' '),
    type: isSerie ? 'series' : 'movie',
    poster: detail.poster,
    backdrop: detail.poster,
    overview: detail.overview || '',
    year: detail.year || yearFromSlug(p.slug),
    extra: {
      source: 'cinehax',
      type: p.type,
      slug: p.slug,
    },
  };
  if (isSerie) {
    var seasons = [];
    // detectar números de temporada
    var seasonNums = [];
    var sre = /\/temporada\/(\d+)/g;
    var sm;
    var sseen = {};
    while ((sm = sre.exec(html || '')) !== null) {
      var n = parseInt(sm[1], 10);
      if (!sseen[n]) {
        sseen[n] = 1;
        seasonNums.push(n);
      }
    }
    if (!seasonNums.length) seasonNums = [1];
    seasonNums.sort(function (a, b) {
      return a - b;
    });
    var allEps = [];
    for (var i = 0; i < seasonNums.length && i < 20; i++) {
      var sh = await getText(
        BASE() + '/serie/' + p.slug + '/temporada/' + seasonNums[i]
      );
      var eps = parseEpisodes(sh || '', p.slug);
      allEps = allEps.concat(eps);
    }
    item.episodes = allEps;
    item.extra.seasons = seasonNums;
  }
  return item;
}

function embedTag(html) {
  var m = /data-embed="([^"]+)"/.exec(String(html || ''));
  if (!m) return null;
  var tag = decodeEntities(m[1]);
  var src = (/\ssrc="([^"]+)"/.exec(tag) || [])[1];
  var pass = (/\sdata-pass="([^"]+)"/.exec(tag) || [])[1];
  return src && pass ? { src: siteUrl(src), pass: siteUrl(pass) } : null;
}

function originOf(url) {
  var m = /^https?:\/\/[^/]+/.exec(String(url || ''));
  return m ? m[0] : null;
}

function embParams(emb) {
  var qs = 'tmdb=' + emb.tmdb + '&type=' + emb.type;
  if (emb.type === 'tv')
    qs +=
      '&season=' +
      (emb.season || 1) +
      '&episode=' +
      (emb.episode || 1);
  return qs;
}

function embFromSrc(src) {
  var m = /\/embed\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/.exec(String(src || ''));
  if (!m) return null;
  var emb = { type: m[1], tmdb: parseInt(m[2], 10) };
  if (m[1] === 'tv') {
    emb.season = parseInt(m[3] || '1', 10) || 1;
    emb.episode = parseInt(m[4] || '1', 10) || 1;
  }
  var lang = (/[?&]lang=([A-Za-z]{3})/.exec(src) || [])[1];
  if (lang) emb.lang = lang;
  return emb;
}

function ordenaServidores(lista, lang) {
  var pref = (lang || 'lat').toLowerCase();
  return (lista || []).slice().sort(function (a, b) {
    var an = String(a.name || a.lang || '').toLowerCase();
    var bn = String(b.name || b.lang || '').toLowerCase();
    var as = an.indexOf(pref) >= 0 || an.indexOf('lat') >= 0 ? 0 : 1;
    var bs = bn.indexOf(pref) >= 0 || bn.indexOf('lat') >= 0 ? 0 : 1;
    return as - bs;
  });
}

async function flujoPlayer(watchUrl) {
  var page = await getText(watchUrl);
  if (!page) return [];
  var embed = embedTag(page);
  if (!embed) return [];

  var pass = await getJson(embed.pass);
  if (!pass || !pass.pass) return [];

  var sep = embed.src.indexOf('?') >= 0 ? '&' : '?';
  var embedHtml = await httpText(
    embed.src + sep + 'pass=' + encodeURIComponent(pass.pass),
    { headers: { 'User-Agent': UA } }
  );
  if (!embedHtml) return [];

  var ui = (embedHtml.match(/PM_UI="([^"]+)"/) || [])[1];
  var emb = null;
  try {
    emb = JSON.parse((embedHtml.match(/PM_EMBED=(\{[^}]+\})/) || [])[1] || 'null');
  } catch (e) {}
  if (!emb) emb = embFromSrc(embed.src);
  var origin = originOf(embed.src);
  if (!ui || !emb || !emb.tmdb || !origin) return [];

  var params = embParams(emb);
  var pide = { headers: { 'User-Agent': UA } };
  var srv = await getJson(
    origin + '/servers?' + params + '&ui=' + encodeURIComponent(ui),
    pide
  );
  var lista = srv && Array.isArray(srv.servers) ? srv.servers : [];
  if (!lista.length) return [];

  var orden = ordenaServidores(lista, emb.lang);
  var streams = [];
  for (var i = 0; i < orden.length && i < 12; i++) {
    var s = orden[i];
    var v = await getJson(
      origin +
        '/video?' +
        params +
        '&noiframe=1&embed=' +
        encodeURIComponent(s.id) +
        '&r=1&ui=' +
        encodeURIComponent(ui),
      pide
    );
    if (!v || !v.url || v.type === 'iframe') continue;
    var isHls = v.type === 'hls' || String(v.url).indexOf('.m3u8') >= 0;
    streams.push({
      url: v.url,
      name: s.name || s.host || 'Servidor ' + (i + 1),
      quality: v.quality || (isHls ? 'HLS' : 'Auto'),
      language: s.lang || emb.lang || 'Latino',
      provider: 'cinehax',
      isHls: isHls,
      headers: {
        'User-Agent': UA,
        Referer: origin + '/',
        Origin: origin,
      },
    });
  }
  return streams;
}

function watchUrlFromId(id, season, episode) {
  var p = parseId(id);
  if (!p) return null;
  if (p.type === 'pelicula') return BASE() + '/pelicula/' + p.slug;
  if (p.type === 'serie') {
    // id serie.slug.s1e2
    var em = /\.s(\d+)e(\d+)$/i.exec(String(id));
    var se = season || (em ? parseInt(em[1], 10) : 1);
    var ep = episode || (em ? parseInt(em[2], 10) : 1);
    return (
      BASE() +
      '/serie/' +
      p.slug +
      '/temporada/' +
      se +
      '/episodio/' +
      ep
    );
  }
  return null;
}

async function getStreams(id, type, season, episode) {
  if (id && typeof id === 'object') {
    season = season || id.season;
    episode = episode || id.episode;
    type = type || id.type;
    id = id.id || id.contentId || '';
  }
  var url = watchUrlFromId(id, season, episode);
  if (!url) {
    // intentar parse episodio en id
    var em = /^(serie)\.([^.]+)\.s(\d+)e(\d+)$/i.exec(String(id));
    if (em) {
      url =
        BASE() +
        '/serie/' +
        em[2] +
        '/temporada/' +
        em[3] +
        '/episodio/' +
        em[4];
    }
  }
  if (!url) return { streams: [], error: 'id inválido' };
  try {
    var streams = await flujoPlayer(url);
    if (!streams.length) {
      // serie sin episodio: abrir primero de T1
      var p = parseId(id);
      if (p && p.type === 'serie' && !season) {
        var t1 = await getText(BASE() + '/serie/' + p.slug + '/temporada/1');
        var m = t1 && /\/temporada\/1\/episodio\/(\d+)/.exec(t1);
        var ep = m ? m[1] : '1';
        streams = await flujoPlayer(
          BASE() + '/serie/' + p.slug + '/temporada/1/episodio/' + ep
        );
      }
    }
    return { streams: streams };
  } catch (e) {
    return { streams: [], error: String(e && e.message ? e.message : e) };
  }
}

async function getNews() {
  try {
    var html = await getText(BASE() + '/');
    var cards = parseCards(html || '', 12);
    return {
      items: cards.map(function (x) {
        return {
          title: x.title,
          message: x.year ? String(x.year) : 'CineHax+',
          poster: x.poster,
          banner: x.poster,
          id: x.id,
          imageStyle: 'poster',
        };
      }),
    };
  } catch (e) {
    return { items: [] };
  }
}

async function getDiscover() {
  return getHome();
}

async function getCatalogs() {
  return {
    catalogs: [
      { id: 'peliculas', title: 'Películas' },
      { id: 'series', title: 'Series' },
      { id: 'trending', title: 'Tendencias' },
    ],
  };
}

async function getCatalog(catalogId) {
  var path = '/peliculas';
  var id = String(catalogId || '');
  if (id.indexOf('series') >= 0) path = '/series';
  else if (id.indexOf('trending') >= 0) path = '/peliculas?sort=trending';
  var html = await getText(BASE() + path);
  var items = parseCards(html || '', 40).map(toContentItem).filter(Boolean);
  return { items: items, hasMore: false };
}

if (typeof module !== 'undefined') {
  module.exports = {
    getHome: getHome,
    search: search,
    getMeta: getMeta,
    getStreams: getStreams,
    getNews: getNews,
    getDiscover: getDiscover,
    getCatalogs: getCatalogs,
    getCatalog: getCatalog,
  };
}
