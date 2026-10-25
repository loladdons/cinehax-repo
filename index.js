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

function absUrl(u) {
  return siteUrl(u);
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

function parseEpisodes(html, slug, forceSeason) {
  var out = [];
  var src = String(html || '');
  var seen = {};

  // 1) JSON-LD TVEpisode (títulos reales)
  try {
    var ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    var lm;
    while ((lm = ldRe.exec(src)) !== null) {
      var raw = lm[1].trim();
      if (!raw) continue;
      var data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        continue;
      }
      var nodes = [];
      function walk(n) {
        if (!n) return;
        if (Array.isArray(n)) {
          for (var i = 0; i < n.length; i++) walk(n[i]);
          return;
        }
        if (typeof n !== 'object') return;
        var t = n['@type'];
        if (t === 'TVEpisode' || (Array.isArray(t) && t.indexOf('TVEpisode') >= 0)) {
          nodes.push(n);
        }
        if (n['@graph']) walk(n['@graph']);
        if (n.episode) walk(n.episode);
        if (n.episodes) walk(n.episodes);
        if (n.containsSeason) walk(n.containsSeason);
        if (n.partOfSeason) {
          /* ignore */
        }
      }
      walk(data);
      for (var j = 0; j < nodes.length; j++) {
        var ep = nodes[j];
        var num =
          parseInt(ep.episodeNumber || ep.episode || ep.number || 0, 10) || 0;
        if (!num) continue;
        var season =
          forceSeason ||
          parseInt(
            (ep.partOfSeason &&
              (ep.partOfSeason.seasonNumber || ep.partOfSeason.number)) ||
              forceSeason ||
              1,
            10
          ) ||
          1;
        var key = season + 'x' + num;
        if (seen[key]) continue;
        seen[key] = 1;
        var img = null;
        if (ep.image) {
          if (typeof ep.image === 'string') img = ep.image;
          else if (ep.image.url) img = ep.image.url;
          else if (Array.isArray(ep.image) && ep.image[0]) {
            img =
              typeof ep.image[0] === 'string'
                ? ep.image[0]
                : ep.image[0].url || null;
          }
        }
        out.push({
          number: num,
          id: 'serie.' + slug + '.s' + season + 'e' + num,
          title: ep.name || ep.title || 'Episodio ' + num,
          still: img ? absUrl(img) : null,
          overview: ep.description || null,
        });
      }
    }
  } catch (e) {}

  // 2) Tarjetas HTML por episodio (imagen + título)
  if (out.length < 2) {
    var cardRe =
      /href="(\/serie\/[^"]+\/temporada\/(\d+)\/episodio\/(\d+)[^"]*)"[\s\S]{0,600}?/g;
    // Mejor: bloques con img cercana
    var blocks = src.split(/href="(\/serie\/[^"]+\/temporada\/\d+\/episodio\/\d+[^"]*)"/);
    // split leaves: text, href, text, href...
    for (var bi = 1; bi < blocks.length; bi += 2) {
      var href = blocks[bi];
      var after = blocks[bi + 1] || '';
      var before = blocks[bi - 1] || '';
      var hm = /\/temporada\/(\d+)\/episodio\/(\d+)/.exec(href);
      if (!hm) continue;
      var season = forceSeason || parseInt(hm[1], 10);
      var episode = parseInt(hm[2], 10);
      var key2 = season + 'x' + episode;
      if (seen[key2]) {
        // actualizar still/title si faltaba
        continue;
      }
      seen[key2] = 1;
      var chunk = (before.slice(-400) + after.slice(0, 500));
      var title = 'Episodio ' + episode;
      var tm =
        /<(?:span|div|p|h[1-6]|small)[^>]*class="[^"]*(?:pc-t|cd-t|ep-t|title)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p|h[1-6]|small)>/i.exec(
          chunk
        ) ||
        /alt="([^"]{2,120})"/.exec(chunk);
      if (tm) {
        var tt = textOf(tm[1]);
        if (tt && tt.length >= 2 && tt.length < 120) title = tt;
      }
      var im = /src="((?:https?:)?\/\/[^"]+\/(?:t\/p\/|content\/uploads\/)[^"]+)"/i.exec(
        chunk
      ) || /src="((?:https?:)?\/\/image\.tmdb\.org[^"]+)"/i.exec(chunk);
      var still = im ? absUrl(im[1]) : null;
      out.push({
        number: episode,
        id: 'serie.' + slug + '.s' + season + 'e' + episode,
        title: title,
        still: still,
      });
    }
  } else {
    // Rellenar stills desde HTML si JSON-LD no trajo imagen
    for (var k = 0; k < out.length; k++) {
      if (out[k].still) continue;
      var er =
        'episodio/' +
        out[k].number +
        '[^"]*"[\\s\\S]{0,400}?src="((?:https?:)?\\/\\/[^"]+)"';
      var em = new RegExp(er, 'i').exec(src);
      if (em) out[k].still = absUrl(em[1]);
    }
  }

  out.sort(function (a, b) {
    return a.number - b.number;
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
    return { id: id, title: String(id), type: 'movie', seasons: [] };
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
    seasons: [],
    extra: {
      source: 'cinehax',
      type: p.type,
      slug: p.slug,
    },
  };

  if (isSerie) {
    var seasonNums = [];
    var sre = /\/temporada\/(\d+)/g;
    var sm;
    var sseen = {};
    while ((sm = sre.exec(html || '')) !== null) {
      var n = parseInt(sm[1], 10);
      if (!sseen[n] && n > 0) {
        sseen[n] = 1;
        seasonNums.push(n);
      }
    }
    if (!seasonNums.length) seasonNums = [1];
    seasonNums.sort(function (a, b) {
      return a - b;
    });

    var seasons = [];
    for (var i = 0; i < seasonNums.length && i < 25; i++) {
      var sn = seasonNums[i];
      var sh = await getText(
        BASE() + '/serie/' + p.slug + '/temporada/' + sn
      );
      var eps = parseEpisodes(sh || '', p.slug, sn);
      if (!eps.length && sn === 1) {
        // reintento con HTML principal
        eps = parseEpisodes(html || '', p.slug, sn);
      }
      seasons.push({
        number: sn,
        name: 'Temporada ' + sn,
        episodes: eps,
      });
    }
    item.seasons = seasons;
    item.type = 'series';
  }
  return item;
}

function embedTag(html) {
  // Puede haber varios data-embed (LAT / ESP / SUB). Preferir LAT.
  var src = String(html || '');
  var re = /data-embed="([^"]+)"/g;
  var m;
  var tags = [];
  while ((m = re.exec(src)) !== null) {
    var tag = decodeEntities(m[1]);
    var iframeSrc = (/\ssrc="([^"]+)"/.exec(tag) || [])[1];
    var pass = (/\sdata-pass="([^"]+)"/.exec(tag) || [])[1];
    if (iframeSrc && pass && iframeSrc.indexOf('youtube') < 0) {
      tags.push({ src: siteUrl(iframeSrc), pass: siteUrl(pass), raw: tag });
    }
  }
  if (!tags.length) return null;
  for (var i = 0; i < tags.length; i++) {
    if (/lang=LAT/i.test(tags[i].src) || /lang=LAT/i.test(tags[i].raw)) return tags[i];
  }
  return tags[0];
}

function apiBaseFromEmbed(src) {
  // https://cinehaxplus.com/pv/embed/movie/123 → https://cinehaxplus.com/pv
  var s = String(src || '');
  var m = /^(https?:\/\/[^/]+)(\/pv)\//i.exec(s);
  if (m) return m[1] + m[2];
  var o = originOf(s);
  return o ? o + '/pv' : null;
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
  var pref = String(lang || 'LAT').toLowerCase();
  return (lista || []).slice().sort(function (a, b) {
    function score(s) {
      var L = String(s.lang || s.name || '').toLowerCase();
      var sc = 10;
      if (L === pref || L.indexOf(pref) >= 0) sc = 0;
      else if (L.indexOf('lat') >= 0) sc = 1;
      else if (L.indexOf('esp') >= 0 || L.indexOf('cast') >= 0) sc = 2;
      else if (L.indexOf('sub') >= 0) sc = 3;
      if ((s.mode || '') === 'directo') sc -= 0.5;
      if ((s.type || '') === 'iframe') sc += 20;
      return sc;
    }
    return score(a) - score(b);
  });
}

async function flujoPlayer(watchUrl) {
  var page = await getText(watchUrl);
  if (!page) return [];

  var embed = embedTag(page);
  var streams = [];
  if (!embed) {
    // sin data-embed: buscar m3u8 sueltos
    return scrapeMediaUrls(page);
  }

  try {
    var pass = await getJson(embed.pass, {
      headers: { 'User-Agent': UA, Referer: BASE() + '/', Accept: 'application/json' },
    });
    if (!pass || !pass.pass) return scrapeMediaUrls(page);

    var sep = embed.src.indexOf('?') >= 0 ? '&' : '?';
    var embedHtml = await httpText(
      embed.src + sep + 'pass=' + encodeURIComponent(pass.pass),
      {
        headers: {
          'User-Agent': UA,
          Referer: watchUrl,
          Accept: 'text/html,*/*',
        },
      }
    );
    if (!embedHtml) return scrapeMediaUrls(page);

    var ui = (embedHtml.match(/PM_UI="([^"]+)"/) || [])[1];
    var emb = null;
    var embM =
      embedHtml.match(/PM_EMBED=(\{[\s\S]*?\})\s*;/) ||
      embedHtml.match(/PM_EMBED=(\{[^;]+)/);
    if (embM) {
      try {
        emb = JSON.parse(embM[1]);
      } catch (e) {
        try {
          emb = JSON.parse(embM[1] + '}');
        } catch (e2) {}
      }
    }
    if (!emb) emb = embFromSrc(embed.src);

    var api = apiBaseFromEmbed(embed.src);
    if (!ui || !emb || !emb.tmdb || !api) {
      return scrapeMediaUrls(page + '\n' + (embedHtml || ''));
    }

    // type movie|tv (no "pelicula")
    var type = emb.type === 'tv' || emb.type === 'serie' ? 'tv' : 'movie';
    var params = 'tmdb=' + emb.tmdb + '&type=' + type;
    if (type === 'tv') {
      params +=
        '&season=' +
        (emb.season || 1) +
        '&episode=' +
        (emb.episode || 1);
    }

    var pide = {
      headers: {
        'User-Agent': UA,
        Referer: api + '/',
        Origin: originOf(api) || BASE(),
        Accept: 'application/json,*/*',
      },
    };

    var srv = await getJson(
      api + '/servers?' + params + '&ui=' + encodeURIComponent(ui),
      pide
    );
    var lista = srv && Array.isArray(srv.servers) ? srv.servers : [];
    if (!lista.length) {
      return scrapeMediaUrls(page + '\n' + embedHtml);
    }

    var orden = ordenaServidores(lista, emb.lang || 'LAT');
    for (var i = 0; i < orden.length && i < 15; i++) {
      var s = orden[i];
      var finalUrl = null;
      var isHls = (s.type || '') === 'hls' || (s.mode || '') === 'directo';

      // 1) endpoint /video (url firmada real)
      try {
        var v = await getJson(
          api +
            '/video?' +
            params +
            '&noiframe=1&embed=' +
            encodeURIComponent(s.id) +
            '&r=1&ui=' +
            encodeURIComponent(ui),
          pide
        );
        if (v && v.url && v.type !== 'iframe') {
          finalUrl = v.url;
          isHls =
            v.type === 'hls' ||
            String(v.url).indexOf('.m3u8') >= 0 ||
            isHls;
        }
      } catch (e) {}

      // 2) campo video del listado (también apunta a /pv/video?...)
      if (!finalUrl && s.video) {
        // si es endpoint, resolver JSON
        if (String(s.video).indexOf('/pv/video') >= 0) {
          try {
            var v2 = await getJson(s.video + (s.video.indexOf('?') >= 0 ? '&' : '?') + 'ui=' + encodeURIComponent(ui) + '&r=1&noiframe=1', pide);
            if (v2 && v2.url) finalUrl = v2.url;
          } catch (e2) {}
        }
        if (!finalUrl) finalUrl = s.video;
      }

      if (!finalUrl) continue;

      streams.push({
        url: finalUrl,
        name:
          (s.name || 'Servidor ' + (i + 1)) +
          (s.lang ? ' · ' + s.lang : ''),
        quality: isHls ? 'HLS' : s.type || 'Auto',
        language: s.lang || emb.lang || 'Latino',
        provider: 'cinehax',
        isHls: !!isHls || String(finalUrl).indexOf('.m3u8') >= 0,
        headers: {
          'User-Agent': UA,
          Referer: api + '/',
          Origin: originOf(api) || BASE(),
        },
      });
    }
  } catch (e) {
    // sigue a fallback
  }

  if (!streams.length) streams = scrapeMediaUrls(page);
  return streams;
}

function scrapeMediaUrls(html) {
  var streams = [];
  var found = {};
  var re = /(https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)[^\s"'<>]*)/gi;
  var um;
  while ((um = re.exec(String(html || ''))) !== null) {
    var u = um[1].replace(/&amp;/g, '&');
    if (found[u]) continue;
    found[u] = 1;
    var hls = u.indexOf('.m3u8') >= 0;
    streams.push({
      url: u,
      name: hls ? 'HLS' : 'MP4',
      quality: hls ? 'HLS' : 'Auto',
      language: 'Latino',
      provider: 'cinehax',
      isHls: hls,
      headers: { 'User-Agent': UA, Referer: BASE() + '/' },
    });
    if (streams.length >= 6) break;
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
    season = season != null ? season : id.season;
    episode = episode != null ? episode : id.episode;
    type = type || id.type;
    id = id.id || id.contentId || id.ref || '';
  }
  // args pueden venir string "null"
  if (season === 'null' || season === '') season = null;
  if (episode === 'null' || episode === '') episode = null;
  if (season != null) season = parseInt(season, 10) || season;
  if (episode != null) episode = parseInt(episode, 10) || episode;

  var idStr = String(id || '').trim();
  var em = /^(serie)\.([^.]+)\.s(\d+)e(\d+)$/i.exec(idStr);
  if (em) {
    season = season || parseInt(em[3], 10);
    episode = episode || parseInt(em[4], 10);
    idStr = 'serie.' + em[2];
  }

  var url = watchUrlFromId(idStr, season, episode);
  if (!url) {
    return { streams: [], error: 'id inválido: ' + idStr };
  }

  try {
    var streams = await flujoPlayer(url);
    // Serie sin episodio concreto: primer ep T1
    if (!streams.length) {
      var p = parseId(idStr);
      if (p && p.type === 'serie') {
        var se = season || 1;
        var t1 = await getText(
          BASE() + '/serie/' + p.slug + '/temporada/' + se
        );
        var m =
          t1 &&
          new RegExp(
            '/temporada/' + se + '/episodio/(\\d+)'
          ).exec(t1);
        var ep = episode || (m ? m[1] : '1');
        streams = await flujoPlayer(
          BASE() +
            '/serie/' +
            p.slug +
            '/temporada/' +
            se +
            '/episodio/' +
            ep
        );
      }
    }
    if (!streams.length) {
      return {
        streams: [],
        error: 'Sin fuentes de video para ' + url,
      };
    }
    return { streams: streams };
  } catch (e) {
    return {
      streams: [],
      error: String(e && e.message ? e.message : e),
    };
  }
}

async function getNews() {
  try {
    var html = await getText(BASE() + '/');
    if (!html) return { items: [] };
    // Preferir la fila "Tendencias de la semana" (o similar)
    var sections = String(html).split('<section class="row">').slice(1);
    var chosen = null;
    var fallback = [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i].split('</section>')[0];
      var titleM = /<h2 class="row-t">([\s\S]*?)<\/h2>/.exec(section);
      var title = titleM ? textOf(titleM[1]) : '';
      var cards = parseCards(section, 16);
      if (!cards.length) continue;
      fallback = fallback.concat(cards);
      if (/tendenc|semana|top|ranking|popular/i.test(title)) {
        chosen = cards;
        break;
      }
    }
    var cardsOut = chosen || fallback.slice(0, 12);
    return {
      items: cardsOut.slice(0, 14).map(function (x) {
        return {
          title: x.title,
          message: x.year ? String(x.year) : 'Tendencias',
          poster: x.poster,
          banner: x.poster,
          image: x.poster,
          id: x.id,
          imageStyle: 'poster',
        };
      }),
    };
  } catch (e) {
    return { items: [] };
  }
}

async function getDiscover(opts) {
  opts = opts || {};
  if (typeof opts === 'string') opts = { filter: opts };
  var page = parseInt(opts.page || 1, 10) || 1;

  // La app manda { tipo: 'peliculas'|'series', orden: 'trending'|... }
  var tipo = String(
    opts.tipo || opts.type || opts.kind || opts.filter || opts.genre || ''
  ).toLowerCase();
  var orden = String(
    opts.orden || opts.sort || opts.order || opts.filter || ''
  ).toLowerCase();
  // Si solo viene un filter plano antiguo
  if (!tipo && orden) {
    if (orden.indexOf('serie') >= 0) {
      tipo = 'series';
      orden = '';
    } else if (
      orden === 'trending' ||
      orden === 'popular' ||
      orden === 'rating' ||
      orden === 'release'
    ) {
      tipo = 'peliculas';
    }
  }

  var mode = pestanas();
  var path = '/peliculas';
  if (
    tipo.indexOf('serie') >= 0 ||
    tipo === 'series' ||
    tipo === 'tv' ||
    mode === 'series'
  ) {
    path = '/series';
  } else if (mode === 'peliculas') {
    path = '/peliculas';
  } else if (tipo.indexOf('peli') >= 0 || tipo === 'movies' || tipo === 'movie') {
    path = '/peliculas';
  }

  var sort = '';
  if (orden.indexOf('trend') >= 0 || orden === 'trending') sort = 'trending';
  else if (orden.indexOf('popular') >= 0) sort = 'popular';
  else if (orden.indexOf('rating') >= 0 || orden.indexOf('valor') >= 0)
    sort = 'rating';
  else if (orden.indexOf('release') >= 0 || orden.indexOf('estreno') >= 0)
    sort = 'release';

  if (sort) path = path + '?sort=' + sort;

  var url = BASE() + path;
  if (page > 1) {
    if (path.indexOf('?') >= 0) {
      url = BASE() + path + '&page=' + page;
    } else {
      url = BASE() + path + '/page/' + page;
    }
  }

  var html = await getText(url);
  if ((!html || html.length < 500) && page > 1) {
    var basePath = path.split('?')[0];
    var qs = path.indexOf('?') >= 0 ? path.split('?')[1] : '';
    url =
      BASE() +
      basePath +
      '/page/' +
      page +
      (qs ? '?' + qs : '');
    html = await getText(url);
  }

  var cards = parseCards(html || '', 48);
  // No aplicar filterByPestanas agresivo si el usuario ya eligió tipo
  var items;
  if (tipo.indexOf('serie') >= 0 || path.indexOf('/series') === 0) {
    items = cards
      .filter(function (x) {
        return x.type === 'serie';
      })
      .map(toContentItem)
      .filter(Boolean);
  } else if (path.indexOf('/peliculas') === 0) {
    items = cards
      .filter(function (x) {
        return x.type === 'pelicula';
      })
      .map(toContentItem)
      .filter(Boolean);
  } else {
    items = filterByPestanas(cards).map(toContentItem).filter(Boolean);
  }

  return {
    items: items,
    hasMore: items.length >= 20,
    page: page,
  };
}

async function getDiscoverFilters() {
  return {
    filters: [
      {
        id: 'tipo',
        label: 'Tipo',
        options: [
          { id: 'peliculas', label: 'Películas' },
          { id: 'series', label: 'Series' },
        ],
      },
      {
        id: 'orden',
        label: 'Orden',
        options: [
          { id: 'trending', label: 'Tendencias' },
          { id: 'popular', label: 'Popular' },
          { id: 'rating', label: 'Mejor valoradas' },
          { id: 'release', label: 'Estrenos' },
        ],
      },
    ],
  };
}

/** Anuncios opcionales. Si no hay, la app no muestra modal. */
async function getAds() {
  return { enabled: false, items: [] };
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
    getDiscoverFilters: getDiscoverFilters,
    getAds: getAds,
    getCatalogs: getCatalogs,
    getCatalog: getCatalog,
  };
}
