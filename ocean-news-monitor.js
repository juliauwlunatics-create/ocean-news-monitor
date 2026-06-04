#!/usr/bin/env node

/**
 * Underwater Lunatics Ocean News Monitor
 * Uses Google News RSS to monitor positive ocean-related news
 * Filters by reputable news outlets using source names in article titles
 * No API key needed - completely free!
 */

const https = require('https');
const zlib = require('zlib');
const xml2js = require('xml2js');

// Configuration
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL_OCEAN;
const SLACK_CHANNEL = '#positive-ocean-news';

// ─────────────────────────────────────────────
// SEARCH QUERIES
// Focused, non-overlapping topics
// ─────────────────────────────────────────────
const searchQueries = [
  // Marine mammals & charismatic wildlife
  'whale conservation',
  'dolphin conservation',
  'shark conservation',
  'sea turtle conservation',
  'cetacean protection',

  // Coral & reef
  'coral restoration',
  'coral reef recovery',

  // Marine protection & policy
  'marine protected area',
  'ocean sanctuary designation',

  // Science & breakthroughs
  'marine research breakthrough',
  'ocean species discovery',

  // Cleanup & solutions
  'ocean cleanup success',
  'plastic pollution solution ocean'
];

// ─────────────────────────────────────────────
// TRUSTED NEWS SOURCES
// Google News RSS puts the source name at the END of the title,
// separated by " - " (e.g., "Sharks recover off coast - Reuters")
// We match against that suffix.
// ─────────────────────────────────────────────
const trustedSources = [
  // Wire services
  'reuters',
  'associated press',
  'ap news',
  'afp',

  // Major broadcasters & newspapers
  'bbc',
  'the guardian',
  'guardian',
  'new york times',
  'washington post',
  'the independent',
  'the telegraph',
  'financial times',
  'the economist',
  'wall street journal',
  'the atlantic',
  'time',

  // Science & environment
  'national geographic',
  'nature',
  'science',
  'scientific american',
  'new scientist',
  'science daily',
  'phys.org',
  'mongabay',
  'the conversation',
  'carbon brief',

  // Reputable digital
  'npr',
  'pbs',
  'axios',
  'wired',
  'vox',
  'al jazeera',

  // Ocean-specific
  'oceana',
  'noaa',
  'iucn',
  'wwf',
  'greenpeace',
  'ocean conservancy',

  // Regional quality outlets
  'abc news',
  'cbc',
  'sky news',
  'deutsche welle',
  'dw',
  'euronews',
  'south china morning post',
  'straits times'
];

// ─────────────────────────────────────────────
// CONTENT FILTERS
// Must have at least one positive signal
// ─────────────────────────────────────────────
const positiveSignals = [
  'conserv', 'protect', 'restor', 'recover', 'sanctuar', 'ban',
  'discovery', 'breakthrough', 'solution', 'cleanup', 'clean up',
  'thriv', 'rebound', 'increas', 'success', 'initiative', 'program',
  'designat', 'agreement', 'treaty', 'milestone', 'record'
];

// Hard reject — only truly doom-framing exclusions
const hardRejectTerms = [
  'mass die-off', 'mass death', 'gone extinct', 'wiped out',
  'collapse imminent', 'collapse of'
];

// ─────────────────────────────────────────────
// SOURCE CHECK
// Google News titles look like: "Title text - Source Name"
// We extract the part after the last " - " and match it
// ─────────────────────────────────────────────
function isFromTrustedSource(title) {
  if (!title) return false;

  // Extract source: everything after the last " - "
  const dashIndex = title.lastIndexOf(' - ');
  if (dashIndex === -1) return false;

  const sourcePart = title.substring(dashIndex + 3).toLowerCase().trim();

  return trustedSources.some(source => sourcePart.includes(source));
}

// ─────────────────────────────────────────────
// CONTENT FILTER
// ─────────────────────────────────────────────
function passesContentFilter(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();

  // Hard reject
  if (hardRejectTerms.some(term => text.includes(term))) return false;

  // Must have at least one positive signal
  return positiveSignals.some(signal => text.includes(signal));
}

// ─────────────────────────────────────────────
// CATEGORY DETECTION
// ─────────────────────────────────────────────
function detectCategory(text) {
  const t = text.toLowerCase();
  if (t.includes('whale') || t.includes('cetacean')) return '🐋 Whales & Cetaceans';
  if (t.includes('dolphin'))                          return '🐬 Dolphins';
  if (t.includes('shark'))                            return '🦈 Sharks';
  if (t.includes('turtle'))                           return '🐢 Sea Turtles';
  if (t.includes('coral') || t.includes('reef'))     return '🪸 Coral & Reefs';
  if (t.includes('protected area') || t.includes('sanctuary')) return '🛡️ Marine Protection';
  if (t.includes('research') || t.includes('discovery') || t.includes('species')) return '🔬 Science & Discovery';
  if (t.includes('cleanup') || t.includes('plastic') || t.includes('pollution')) return '♻️ Cleanup & Solutions';
  return '🌊 Ocean Conservation';
}

// ─────────────────────────────────────────────
// RSS FETCHER (handles redirects + compression)
// ─────────────────────────────────────────────
function fetchRSS(query) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects'));
      }

      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Referer': 'https://news.google.com/',
          'Cache-Control': 'no-cache'
        }
      };

      https.get(requestUrl, options, (res) => {
        // Handle redirects
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          res.resume();
          const nextUrl = location.startsWith('http')
            ? location
            : `https://news.google.com${location}`;
          return makeRequest(nextUrl, redirectCount + 1);
        }

        let stream = res;
        if (res.headers['content-encoding'] === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (res.headers['content-encoding'] === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        }

        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
        stream.on('error', reject);
      }).on('error', reject);
    };

    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    makeRequest(url);
  });
}

// ─────────────────────────────────────────────
// PARSE RSS XML
// ─────────────────────────────────────────────
async function parseRSS(xml) {
  try {
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xml);
    const items = result?.rss?.channel?.[0]?.item || [];

    return items.map(item => {
      const title = Array.isArray(item.title) ? item.title[0] : (item.title || '');
      const desc  = Array.isArray(item.description) ? item.description[0] : (item.description || '');
      const link  = Array.isArray(item.link) ? item.link[0] : (item.link || '');

      return {
        title: title.replace(/<[^>]*>/g, '').trim(),
        description: desc.replace(/<[^>]*>/g, '').trim(),
        link
      };
    });
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// SLACK — send via native https
// ─────────────────────────────────────────────
function postToSlack(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const urlObj = new URL(SLACK_WEBHOOK_URL);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────
// SEND RESULTS TO SLACK
// Splits into batches of 5 to avoid truncation
// ─────────────────────────────────────────────
async function sendToSlack(articles) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // Summary message (always sent)
  await postToSlack({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🌊 Positive Ocean News — ${date}`, emoji: true }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: articles.length > 0
            ? `Found *${articles.length}* stories from trusted outlets today.`
            : `📭 No stories found today from trusted outlets. Monitoring continues tomorrow.`
        }
      }
    ]
  });

  if (articles.length === 0) return;

  // Send in batches of 5
  const batchSize = 5;
  const batches = [];
  for (let i = 0; i < articles.length; i += batchSize) {
    batches.push(articles.slice(i, i + batchSize));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const blocks = [
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `*Stories ${i * batchSize + 1}–${i * batchSize + batch.length}* of ${articles.length}` }]
      },
      { type: 'divider' }
    ];

    for (const article of batch) {
      // Strip source name from title for cleaner display
      const cleanTitle = article.title.replace(/ - [^-]+$/, '').trim();
      const dashIndex = article.title.lastIndexOf(' - ');
      const sourceName = dashIndex !== -1 ? article.title.substring(dashIndex + 3) : '';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `${article.category}`,
            `*${cleanTitle}*`,
            article.description ? article.description.substring(0, 180) + (article.description.length > 180 ? '...' : '') : '',
            sourceName ? `_Source: ${sourceName}_` : '',
            `<${article.link}|Read full story>`
          ].filter(Boolean).join('\n')
        }
      });
      blocks.push({ type: 'divider' });
    }

    await postToSlack({ blocks });
    console.log(`[SLACK] Posted batch ${i + 1}/${batches.length}`);
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log('[START] Ocean News Monitor');
  console.log(`[DATE] ${new Date().toISOString()}`);

  if (!SLACK_WEBHOOK_URL) {
    console.error('[ERROR] SLACK_WEBHOOK_URL_OCEAN not set');
    process.exit(1);
  }

  const seen = new Set();
  const results = [];
  let totalFetched = 0;
  let sourceFiltered = 0;
  let contentFiltered = 0;

  for (const query of searchQueries) {
    try {
      const xml = await fetchRSS(query);
      const items = await parseRSS(xml);
      totalFetched += items.length;

      for (const item of items) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);

        if (!isFromTrustedSource(item.title)) {
          sourceFiltered++;
          continue;
        }

        if (!passesContentFilter(item.title, item.description)) {
          contentFiltered++;
          continue;
        }

        results.push({
          ...item,
          category: detectCategory(item.title + ' ' + item.description)
        });
      }
    } catch (err) {
      console.error(`[ERROR] Query "${query}": ${err.message}`);
    }

    // Small delay to be polite to Google
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[STATS] Fetched: ${totalFetched} | Source-filtered: ${sourceFiltered} | Content-filtered: ${contentFiltered} | Kept: ${results.length}`);

  // Deduplicate by clean title (in case same story appears under multiple queries)
  const deduped = Array.from(
    new Map(results.map(r => [r.title.replace(/ - [^-]+$/, '').toLowerCase(), r])).values()
  );

  console.log(`[FOUND] ${deduped.length} unique stories from trusted outlets`);

  await sendToSlack(deduped);
  console.log('[DONE] Ocean News Monitor completed');
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
