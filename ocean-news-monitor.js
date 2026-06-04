const https = require('https');
const zlib = require('zlib');
const xml2js = require('xml2js');

// Configuration
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL_OCEAN;

// Search queries for ocean/conservation content (high-impact, no duplicates)
const queries = [
  // CHARISMATIC WILDLIFE RECOVERY (visual, inspiring for content)
  'whale recovery',
  'whale population increase',
  'sea turtle recovery',
  'shark conservation',
  'shark fin ban',
  
  // CORAL & REEF (directly relevant to dive destinations)
  'coral restoration',
  'reef restoration project',
  
  // MARINE PROTECTED AREAS (relevant to destination strategy)
  'marine protected area',
  'ocean sanctuary',
  'marine sanctuary designation',
  
  // OCEAN CLEANUP (visual, actionable)
  'ocean cleanup',
  'plastic removal ocean',
  
  // CONSERVATION BREAKTHROUGHS (inspirational)
  'conservation breakthrough',
  'marine species recovery',
  'endangered species protection success'
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

  // Reject if negative keywords present
  if (negativeKeywords.some(k => text.includes(k))) {
    return false;
  }

  // Require BOTH action (restore/protect/recovery/conservation) AND either success OR species
  const hasAction = text.includes('restor') || text.includes('protect') || text.includes('conserv') || text.includes('recovery') || text.includes('cleanup');
  const hasSuccess = text.includes('recovery') || text.includes('comeback') || text.includes('success') || text.includes('thriving') || text.includes('increase') || text.includes('designated') || text.includes('established');
  const hasCharismaticSpecies = text.includes('whale') || text.includes('sea turtle') || text.includes('shark') || text.includes('coral') || text.includes('reef') || text.includes('marine protected');

  // Must have action + (success OR charismatic species)
  if (hasAction && (hasSuccess || hasCharismaticSpecies)) {
    return true;
  }

  return false;
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

  await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summaryMessage)
  });

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

    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

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
