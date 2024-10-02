class Cache {
  constructor() {
    this.cache = CacheService['getScriptCache'](); // 'getScriptCache', 'getUserCache', or 'getDocumentCache'
  }

  // Generate a unique cache key based on function name and parameters
  generateCacheKey(functionName, params) {
    return functionName + JSON.stringify(params);
  }

  // Method to set cache with a default expiration time of 12 hours (43,200 seconds)
  set(functionName, params, result, expirationInSeconds = 43200) {
    Logger.log(`CACHE SET ${functionName} ${JSON.stringify(params)} ${JSON.stringify(result)}`)
    const key = this.generateCacheKey(functionName, params);
    this.cache.put(key, JSON.stringify(result), expirationInSeconds);
  }

  // Method to get cache
  get(functionName, params) {
    Logger.log(`CACHE GET ${functionName} ${JSON.stringify(params)}`)
    const key = this.generateCacheKey(functionName, params);
    const cachedResult = this.cache.get(key);
    return cachedResult ? JSON.parse(cachedResult) : null;
  }

  setFunc(name, params, func, expirationInSeconds = 43200) { // Default expiration is 12 hours
    Logger.log(`CACHE SET ${name} ${JSON.stringify(params)}`)
    const key = this.generateCacheKey(name, params);

    // Try to get cached value
    let result = this.cache.get(key);
    if (result !== null) {
      Logger.log(`CACHE HIT ${name} ${JSON.stringify(params)}`)
      return JSON.parse(result); // Parse and return the cached value
    }

    // If not found in cache, run the function and cache the result
    result = func(...params);
    Logger.log(`CACHE MISS ${name} ${JSON.stringify(params)}`)
    this.cache.put(key, JSON.stringify(result), expirationInSeconds); // Store result as JSON string
    return result;
  }

  fetch(name, key, fetch, expirationInSeconds = 43200) {
    Logger.log(`CACHE SET ${name} ${key}`)
    const fullKey = `${name}:${key}`

    const cached = this.cache.get(fullKey)
    if (cached !== null && cached !== undefined) {
      Logger.log('HIT')
      return JSON.parse(cached)
    }

    else {
      Logger.log('MISS')
      const executed = fetch()
      if (executed != null && executed != undefined) {
        this.cache.put(fullKey, executed)
      }
      return JSON.parse(executed)
    }

  }

}

const cache = new Cache()

//=========================================================================================================

function fetch(url) {
  return JSON.parse(UrlFetchApp.fetch(url).getContentText())
}

function fetchToCache(cacheName, key, url) {
  //return cache.setFunc(cacheName, params, ()=>UrlFetchApp.fetch(url).getContentText())
  Logger.log(`${cacheName}/${key} ---> ${url}`)
  return cache.fetch(cacheName, key, () => UrlFetchApp.fetch(url).getContentText())
}

function trimSplitters(text, splitters) {
  let result = text;

  for (const splitter of splitters) {
    const index = result.indexOf(splitter);
    if (index !== -1) {
      result = result.substring(0, index);
    }
  }

  return result;
}

//=========================================================================================================

function searchOnWikipedia(query, language = 'en') {
  const url = `https://${language}.wikipedia.org/w/api.php?action=query&origin=*&format=json&list=search&srsearch=${encodeURIComponent(query)}`;
  const response = fetchToCache('searchOnWikipedia', query, url)
  return response
}

function getWikiArticlesForLanguage(searchQuery, lang) {
  const result = searchOnWikipedia(searchQuery, lang)
  return result.query.search.map((item) => ({ title: item.title, pageId: item.pageid, snippet: item.snippet }))
}

function getWikipediaArticles(searchQuery, lang) {
  const result = searchOnWikipedia(searchQuery, lang)
  return result.query.search.map((item) => ({ title: item.title, pageId: item.pageid, snippet: item.snippet }))
}


//=========================================================================================================

function PLACE_NAME_TO_GEODATA(placeName) {
  /*
  Given the name of a place, returns map details
  */
  const place = cache.setFunc('PLACE_NAME_TO_GEODATA', placeName, () => Maps.newGeocoder().geocode(placeName))

  if (place.status === 'OK' && place.results.length > 0) {
    const result = place.results[0];

    const route = result.address_components.find(component => (component.types.includes('route'))) || {}

    return [[
      JSON.stringify(result),
      result.geometry.location.lat,
      result.geometry.location.lng,
      route.long_name,
      route.short_name,
      result.formatted_address,
      result.geometry.location_type,
      result.place_id
    ]]

  } else {
    return [[]]
  }
}

function STRAIGHT_DIST_LATLON_LATLON(lat1, lon1, lat2, lon2) {
  const degreesToRadians = (degrees) => degrees * Math.PI / 180
  const earthRadiusKm = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const lat1rad = degreesToRadians(lat1);
  const lat2rad = degreesToRadians(lat2);

  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1rad) * Math.cos(lat2rad);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function WIKIPEDIA_PAGE_SEARCH(query, lang = 'en', forcePageId = null, index = 0) {


  const getData = () => {
    if (forcePageId && forcePageId !== '') {
      Logger.log(`Get page id ${forcePageId} on ${lang}`)
      return { ...getWikipediaArticleByCurid(forcePageId, lang), source: 'CURID' }
    }
    else {
      Logger.log(`Search for "${query}" on ${lang}`)
      return { ...getWikipediaArticles(query, lang)[index], source: 'QUERY' }
    }
  }

  const data = getData()
  Logger.log({ data })
  return [[data.title, data.pageId, data.snippet, data.source]]
}


function getWikipediaArticleByCurid(curid, lang = 'en') {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&pageids=${curid}&format=json&prop=extracts&exintro=1`;
  const data = fetchToCache('getWikipediaArticleByCurid', curid, url);
  const page = data.query.pages[curid];

  return {
    title: page.title,
    pageId: page.pageid,
    snippet: page.extract
  }
}

function WIKIPEDIA_IMAGES(pageId, lang) {
  try {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=images&pageids=${pageId}&format=json`
    const response = fetchToCache('WIKIPEDIA_IMAGES-base', pageId, url).query.pages[pageId] // fetchToCache('WIKIPEDIA_IMAGES-base', pageId, url)

    const titles = response.images.filter((item) =>
      item.title.toString().toLowerCase().endsWith('jpg') || item.title.toString().toLowerCase().endsWith('jpeg') || item.title.toString().toLowerCase().endsWith('png')
    ).map((item) => (item.title))


    const imageUrls = titles.map(title => (
      fetchToCache('WIKIPEDIA_IMAGES-img', title, `https://${lang}.wikipedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(title)}&format=json`)
        .query.pages['-1'].imageinfo[0].url
    ))

    return [imageUrls.slice(0, 4)]
  }
  catch (err) {
    Logger.log(err)
    return []
  }
}

function WIKIPEDIA_PLAINTEXT(pageId, lang) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&pageids=${pageId}&prop=extracts&explaintext`
  const content = fetch(url).query.pages[pageId]

  return [[content.title, `# ${content.title}\n---\n\n` + trimSplitters(content.extract, ['== Gallery ==', '== See also ==', '== See Also ==', '== References ==', '== External links ==', 'Official website'])
    .replaceAll('\t', '\n')
    .replaceAll('\n\n\n', '\n')
    .replaceAll('\n\n\n', '\n')
    .replaceAll('== ', '\n\n## ')
    .replaceAll('==\n', '')
    .replaceAll('=\n', '')
    .slice(0, 50000 - 1)
  ]]
}

function DEDUP(inputString) {
  const words = inputString.split(" ");
  const uniqueWords = [...new Set(words)];
  return uniqueWords.join(" ");
}


function NORMALIZE_TEXT(inputString) {
  const normalized = inputString
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normalized;
}


function WKT(lat, lon) {
  return `POINT (${lon.toFixed(6)} ${lat.toFixed(6)})`
}

function ICON(category, type) {
  const map = {
    "airport": "dOcutZ26h8RF",
    "home": "oSXnsjjZF3Uk",
    "neighbourhood": "j05edJz5Xwy0",
    "beach": "ZS7ZmeyTmK3P",
    "funicular": "dSop1JRmi76I",
    "museum": "lAwJ42xa0VsG",
    "marine": "51UjVTk6gbI9",
    "architecture": "nxVWmOWM0rag",
    "monument": "H4ubSTbctL4w",
    "shopping": "GkX1pWi41B1h",
    "fair": "eSBf7uSmx0Xg",
    "park": "Ah17OpXv85zO",
    "hill": "M0ClAYLFXhjv",
    "skyscraper": "SXWgcDx9GIKM",
    "food": "toxe7lzrsfSS",
    "view": "GOJ9vneGe3dU",
    "handcraft": "eSBf7uSmx0Xg",
    "cemetery": "E0wyttlFNGBM",
    "water": "aPYNUHPT8Z7R",
    "cablecar": "dSop1JRmi76I",
    "church": "EqXyHHDwjo4U",
    "wine": "Xxd9uVMHAofJ",
    "mountain":"dH0idaUsHgvM",
    "street":"LaGivFOf3kfk",
    "tunnel":"W8jtsRtcLfKA",
    "zoo":"jYr6hXnvsDX4",
    "stadium":"k0O8jbMNePvC",
    "beer":"WgDWQgQPxT6c",
    "temple":"WlFjVbh8oYeM",
  }

  return map?.[type] || type
}

const DARKEN_HEX_COLOR = (hex, percent) => {

  if (hex.startsWith('#')) {

    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    r = Math.max(0, Math.min(255, Math.floor(r * (1 - percent / 100))));
    g = Math.max(0, Math.min(255, Math.floor(g * (1 - percent / 100))));
    b = Math.max(0, Math.min(255, Math.floor(b * (1 - percent / 100))));

    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
};


function ICON_COLOR(category) {
  const map = {
    "cultural_site": "#faee75",
    "tour": "#8fffe7",
    "site": "#fc7965",
    "natural_attraction": "#6bff72",
    "market": "#ff6666",
    "waypoint": "#ad6eff"
  }

  const color = map?.[category] || category
  return color

}
