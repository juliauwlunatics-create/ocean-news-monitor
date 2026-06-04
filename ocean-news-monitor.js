const https = require('https');
const zlib = require('zlib');
const xml2js = require('xml2js');

// Configuration
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL_OCEAN;

// Search queries for ocean/conservation content (significantly expanded)
const queries = [
  // MARINE MAMMALS
  'shark conservation',
  'shark protection',
  'dolphin conservation',
  'whale conservation',
  'whale recovery',
  'sea lion protection',
  'seal protection',
  'manatee conservation',
  'cetacean protection',
  
  // SEA TURTLES
  'sea turtle conservation',
  'sea turtle recovery',
  'turtle nesting protection',
  
  // CORAL & REEF
  'coral restoration',
  'coral conservation',
  'coral recovery',
  'reef restoration',
  'reef protection',
  'coral bleaching recovery',
  'coral gardening',
  
  // COASTAL ECOSYSTEMS
  'mangrove restoration',
  'seagrass restoration',
  'kelp forest restoration',
  'coastal restoration',
  'salt marsh restoration',
  'eelgrass restoration',
  
  // MARINE PROTECTION & POLICY
  'marine protected area',
  'ocean sanctuary',
  'ocean conservation',
  'marine conservation',
  'marine reserve',
  'deep sea protection',
  'ocean preservation',
  'marine policy',
  'ocean governance',
  
  // FISHERIES & SUSTAINABLE PRACTICES
  'sustainable fishing',
  'sustainable seafood',
  'fish stock recovery',
  'overfishing solutions',
  'sustainable aquaculture',
  'alternative protein',
  'fishing regulations',
  
  // OCEAN POLLUTION & CLEANUP
  'ocean cleanup',
  'plastic pollution solution',
  'marine debris removal',
  'ocean plastic',
  'sea pollution solution',
  'microplastic reduction',
  
  // MARINE SCIENCE & BIODIVERSITY
  'marine biodiversity',
  'ocean research',
  'marine research breakthrough',
  'species discovery ocean',
  'marine biology',
  'oceanography',
  'ocean monitoring',
  
  // OCEAN HEALTH & CLIMATE
  'ocean acidification solution',
  'blue carbon',
  'marine carbon capture',
  'ocean temperature management',
  'ocean health',
  'marine ecosystem restoration',
  'seabird protection',
  'marine wildlife protection'
];

// Positive keywords
const positiveKeywords = [
  'conservation', 'protect', 'restore', 'clean', 'sustainable',
  'research', 'discovery', 'solution', 'recovery', 'restore',
  'breakthrough', 'innovation', 'agreement', 'ban', 'sanctuary',
  'protected', 'program', 'initiative', 'project', 'effort',
  'success', 'thriving', 'comeback', 'increase', 'growth'
];

// Negative keywords to exclude
const negativeKeywords = [
  'die', 'dead', 'dying', 'death', 'kill', 'killed', 'extinction',
  'collapse', 'decline', 'threat', 'threatened',
  'pollution', 'toxic', 'damage', 'destroyed',
  'crisis', 'emergency', 'disaster', 'disappearing', 'disappear'
];

// Whitelist of major news outlets (expanded)
const allowedSources = [
  // Major wire services
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'aljazeera.com',
  
  // Major newspapers
  'theguardian.com',
  'nytimes.com',
  'washingtonpost.com',
  'independent.co.uk',
  'telegraph.co.uk',
  'ft.com',
  'economist.com',
  'wsj.com',
  'thepublicindex.org',
  
  // Science & environment outlets
  'nationalgeographic.com',
  'nature.com',
  'science.org',
  'sciencedaily.com',
  'phys.org',
  'eurekalert.org',
  'mongabay.com',
  'ecowatch.com',
  'theecologist.org',
  'inhabitat.com',
  'treehugger.com',
  'carbonbrief.org',
  
  // Tech & innovation
  'theverge.com',
  'wired.com',
  'forbes.com',
  'fastcompany.com',
  'techcrunch.com',
  
  // Public broadcasters & news organizations
  'pbs.org',
  'npr.org',
  'axios.com',
  'vox.com',
  'slate.com',
  'politico.com',
  'buzzfeednews.com',
  
  // Business & sustainability
  'businesswire.com',
  'prnewswire.com',
  'csrwire.com',
  
  // International outlets
  'theconversation.com',
  'dw.com',
  'euronews.com',
  'rfi.fr',
  'scmp.com',
  'straitstimes.com'
];

function isFromTrustworthySource(link) {
  if (!link) return false;
  try {
    const url = new URL(link);
    const domain = url.hostname.replace('www.', '');
    return allowedSources.some(source => domain.includes(source));
  } catch (e) {
    return false;
  }
}

// Google News RSS URLs
function getGoogleNewsUrls(query) {
  const encoded = encodeURIComponent(query);
  return [
    `https://news.google.com/rss/search?q=${encoded}`,
    `https://news.google.com/rss/search?q=${encoded}+news`
  ];
}

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Referer': 'https://news.google.com/',
      'Cache-Control': 'no-cache'
    };

    https.get(url, { headers }, (res) => {
      let data = '';

      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const redirectUrl = res.headers.location;
        res.resume();
        return makeRequest(redirectUrl).then(resolve).catch(reject);
      }

      // Handle gzip
      let stream = res;
      if (res.headers['content-encoding'] === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (res.headers['content-encoding'] === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }

      stream.on('data', chunk => data += chunk);
      stream.on('end', () => resolve(data));
      stream.on('error', reject);
    }).on('error', reject);
  });
}

function filterText(text) {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').trim();
}

function passesFilters(title, description) {
  const text = (title + ' ' + description).toLowerCase();

  // HARD REJECT: Only the most negative keywords
  const hardReject = ['die', 'extinction', 'collapse'];
  if (hardReject.some(k => text.includes(k))) {
    return false;
  }

  // Accept if has ocean/marine + conservation/positive signal
  const hasOceanKeyword = text.includes('ocean') || text.includes('marine') || text.includes('coral') || 
                          text.includes('reef') || text.includes('shark') || text.includes('whale') ||
                          text.includes('dolphin') || text.includes('turtle') || text.includes('fish') ||
                          text.includes('seagrass') || text.includes('mangrove') || text.includes('kelp') ||
                          text.includes('aquatic') || text.includes('water') || text.includes('coastal');
  
  const hasPositiveSignal = text.includes('conserv') || text.includes('protect') || text.includes('restore') || 
                            text.includes('sustain') || text.includes('clean') || text.includes('research') ||
                            text.includes('solution') || text.includes('recovery') || text.includes('save') ||
                            text.includes('safe') || text.includes('sanctuary') || text.includes('refuge');
  
  if (hasOceanKeyword && hasPositiveSignal) {
    return true;
  }

  return false;
}

function parseCategory(text) {
  const lower = text.toLowerCase();
  if (lower.includes('shark')) return 'Shark Conservation';
  if (lower.includes('dolphin') || lower.includes('cetacean')) return 'Marine Mammals';
  if (lower.includes('whale')) return 'Whale Conservation';
  if (lower.includes('turtle')) return 'Sea Turtle';
  if (lower.includes('sea lion') || lower.includes('seal')) return 'Marine Mammals';
  if (lower.includes('coral') || lower.includes('bleach')) return 'Coral & Reef';
  if (lower.includes('reef')) return 'Coral & Reef';
  if (lower.includes('mangrove')) return 'Mangrove Restoration';
  if (lower.includes('seagrass')) return 'Seagrass Restoration';
  if (lower.includes('kelp')) return 'Kelp Forest';
  if (lower.includes('marine protected') || lower.includes('sanctuary')) return 'Marine Protection';
  if (lower.includes('fish') && (lower.includes('stock') || lower.includes('fishing'))) return 'Sustainable Fisheries';
  if (lower.includes('aquaculture')) return 'Sustainable Aquaculture';
  if (lower.includes('cleanup') || lower.includes('plastic') || lower.includes('debris')) return 'Ocean Cleanup';
  if (lower.includes('biodiversity') || lower.includes('discovery') || lower.includes('research')) return 'Marine Science';
  if (lower.includes('acidification') || lower.includes('carbon') || lower.includes('climate')) return 'Climate & Ocean';
  return 'Ocean Conservation';
}

async function fetchRSSFeed(url) {
  try {
    const xml = await makeRequest(url);
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);

    if (!result.rss || !result.rss.channel || !Array.isArray(result.rss.channel[0].item)) {
      return [];
    }

    return result.rss.channel[0].item.map(item => ({
      title: filterText(item.title?.[0] || ''),
      description: filterText(item.description?.[0] || ''),
      link: item.link?.[0] || '',
      pubDate: item.pubDate?.[0] || new Date().toISOString()
    }));
  } catch (error) {
    console.error(`[ERROR] Failed to fetch RSS from ${url}:`, error.message);
    return [];
  }
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function postToSlackViaHttps(url, payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function postToSlack(results) {
  if (results.length === 0) {
    console.log('[SLACK] No results to post');
    return;
  }

  // Post summary message
  const summaryMessage = {
    text: `🌊 Ocean News Monitor\nFound ${results.length} positive stories today`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🌊 *Ocean News Monitor*\nFound *${results.length}* positive stories today`
        }
      }
    ]
  };

  await postToSlackViaHttps(SLACK_WEBHOOK_URL, summaryMessage);

  // Split results into chunks of 5 per message
  const chunks = chunk(results, 5);
  
  for (let i = 0; i < chunks.length; i++) {
    const chunkData = chunks[i];
    const fields = chunkData.map(result => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${result.title}*\n_${result.category}_\n${result.description}\n<${result.link}|Read more>`
      }
    }));

    const message = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Batch ${i + 1}/${chunks.length}* (${chunkData.length} items)`
          }
        },
        ...fields
      ]
    };

    await postToSlackViaHttps(SLACK_WEBHOOK_URL, message);
    console.log(`[SLACK] Posted batch ${i + 1}/${chunks.length}`);
  }
}

async function main() {
  console.log('[START] Ocean News Monitor');
  
  const allResults = [];

  for (const query of queries) {
    const urls = getGoogleNewsUrls(query);
    
    for (const url of urls) {
      const items = await fetchRSSFeed(url);
      
      for (const item of items) {
        if (passesFilters(item.title, item.description) && isFromTrustworthySource(item.link)) {
          allResults.push({
            title: item.title,
            description: item.description,
            link: item.link,
            category: parseCategory(item.title + ' ' + item.description)
          });
        }
      }
    }
  }

  // Remove duplicates by link
  const uniqueResults = Array.from(
    new Map(allResults.map(r => [r.link, r])).values()
  );

  console.log(`[FOUND] ${uniqueResults.length} unique stories from major outlets`);

  // Post to Slack
  await postToSlack(uniqueResults);

  console.log('[DONE] Ocean News Monitor completed');
}

main().catch(console.error);
