const https = require('https');
const zlib = require('zlib');
const xml2js = require('xml2js');

// Configuration
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL_OCEAN;

// Search queries for ocean/conservation content (minimal, high-impact only)
const queries = [
  'shark conservation',
  'dolphin conservation',
  'turtle conservation',
  'cetacean conservation',
  'coral conservation',
  'coral restoration',
  'marine protected area',
  'ocean cleanup'
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
  'collapse', 'collapse', 'decline', 'threat', 'threatened',
  'pollution', 'toxic', 'damage', 'destroyed', 'destroyed',
  'crisis', 'emergency', 'disaster', 'disappearing', 'disappear'
];

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

  // HARD REJECT: Negative keywords
  if (negativeKeywords.some(k => text.includes(k))) {
    return false;
  }

  // Must mention a charismatic marine species
  const hasSpecies = text.includes('shark') || text.includes('dolphin') || text.includes('turtle') || 
                     text.includes('cetacean') || text.includes('whale') || text.includes('coral');
  
  if (!hasSpecies) {
    return false;
  }

  // Must have conservation/protection/restoration signal
  const hasConservationSignal = text.includes('conserv') || text.includes('protect') || text.includes('restore') || 
                                text.includes('designat') || text.includes('cleanup') || text.includes('sanctuary') ||
                                text.includes('establish');
  
  if (!hasConservationSignal) {
    return false;
  }

  return true;
}

function parseCategory(text) {
  if (text.toLowerCase().includes('whale')) return 'Marine Mammals';
  if (text.toLowerCase().includes('sea turtle')) return 'Marine Life';
  if (text.toLowerCase().includes('shark')) return 'Shark Conservation';
  if (text.toLowerCase().includes('coral') || text.toLowerCase().includes('reef')) return 'Coral & Reef Restoration';
  if (text.toLowerCase().includes('marine protected') || text.toLowerCase().includes('sanctuary')) return 'Marine Protection';
  if (text.toLowerCase().includes('cleanup') || text.toLowerCase().includes('plastic')) return 'Ocean Cleanup';
  return 'Conservation';
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
        if (passesFilters(item.title, item.description)) {
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

  console.log(`[FOUND] ${uniqueResults.length} unique stories`);

  // Post to Slack
  await postToSlack(uniqueResults);

  console.log('[DONE] Ocean News Monitor completed');
}

main().catch(console.error);
