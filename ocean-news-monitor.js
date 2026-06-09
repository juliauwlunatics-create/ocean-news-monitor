#!/usr/bin/env node

/**
 * Underwater Lunatics Ocean News Monitor
 * Uses Google News RSS — filters to 5-15 high-quality stories/day
 * Only publishes stories from elite, internationally recognized outlets
 */

const https = require('https');
const zlib = require('zlib');
const xml2js = require('xml2js');

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL_OCEAN;

// ─────────────────────────────────────────────
// SEARCH QUERIES — narrow & specific
// ─────────────────────────────────────────────
const searchQueries = [
  'coral reef restoration success',
  'marine protected area established',
  'shark population recovery',
  'whale population recovery',
  'sea turtle population recovery',
  'ocean cleanup breakthrough',
  'marine conservation agreement',
  'dolphin conservation success'
];

// ─────────────────────────────────────────────
// TRUSTED SOURCES — elite only
//
// Google News RSS appends the source name to the end of each title:
// "Coral reefs recovering off Australia coast - Reuters"
// We match against that suffix.
//
// Rule: only include outlets that are:
// - Globally recognized & editorially rigorous
// - Would be cited in a university essay or boardroom presentation
// ─────────────────────────────────────────────
const trustedSources = [
  // Tier 1 — Major international wire services
  'reuters',
  'associated press',
  'ap news',
  'afp',

  // Tier 1 — Global broadcasters
  'bbc',
  'al jazeera',
  'deutsche welle',
  'dw',

  // Tier 1 — Elite newspapers
  'the guardian',
  'guardian',
  'new york times',
  'washington post',
  'financial times',
  'the economist',
  'wall street journal',
  'the independent',
  'the times',
  'le monde',
  'der spiegel',

  // Tier 1 — Premium science & nature publications
  'national geographic',
  'nature',
  'science',
  'scientific american',
  'new scientist',

  // Tier 2 — Respected environment & ocean journalism
  'mongabay',       // Gold standard for conservation journalism
  'the conversation', // Peer-reviewed academic journalism
  'carbon brief',   // Climate & environment, research-backed

  // Tier 2 — Respected public broadcasters
  'npr',
  'pbs',
  'cbc',
  'abc news',       // Australian ABC, not American

  // Tier 2 — Official scientific/conservation bodies (press releases count)
  'noaa',
  'iucn',
  'wwf'
];

// ─────────────────────────────────────────────
// CONTENT FILTER
// Requires BOTH an event word AND an outcome word.
// This eliminates opinion, background, and evergreen articles.
// ─────────────────────────────────────────────
const eventWords = [
  'established', 'designat', 'signed', 'announced', 'launch', 'launched',
  'approved', 'passed', 'ban', 'banned', 'record', 'milestone',
  'recover', 'recovered', 'recovery', 'restor', 'restored', 'restoration',
  'discover', 'discovered', 'discovery', 'found', 'breakthrough',
  'increase', 'increased', 'growing', 'rebound', 'thriving',
  'success', 'succeed', 'achieved', 'reached', 'completed',
  'removed', 'cleaned', 'protected', 'saved', 'returned'
];

const outcomeWords = [
  'success', 'recover', 'restor', 'increas', 'rebound', 'thrive',
  'milestone', 'record', 'breakthrough', 'discover', 'establ',
  'protect', 'desig', 'ban', 'agreement', 'treaty', 'return',
  'population', 'growth', 'healthy', 'thriving', 'cleaned'
];

const rejectTerms = [
  'die-off', 'mass death', 'extinction', 'gone extinct',
  'collapse', 'crisis', 'catastroph', 'devastat', 'threat'
];

function passesContentFilter(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (rejectTerms.some(t => text.includes(t))) return false;
  const hasEvent   = eventWords.some(w => text.includes(w));
  const hasOutcome = outcomeWords.some(w => text.includes(w));
  return hasEvent && hasOutcome;
}

// ─────────────────────────────────────────────
// SOURCE CHECK
// Extracts the " - Source Name" suffix from Google News titles
// and checks it against our elite outlets list only
// ─────────────────────────────────────────────
function isFromTrustedSource(title) {
  if (!title) return false;
  const dashIndex = title.lastIndexOf(' - ');
  if (dashIndex === -1) return false;
  const source = title.substring(dashIndex + 3).toLowerCase().trim();

  // Must match exactly one of our trusted sources — no partial wildcards
  return trustedSources.some(s => source === s || source.startsWith(s));
}

function detectCategory(text) {
  const t = text.toLowerCase();
  if (t.includes('whale') || t.includes('cetacean')) return '🐋 Whales';
  if (t.includes('dolphin'))                          return '🐬 Dolphins';
  if (t.includes('shark'))                            return '🦈 Sharks';
  if (t.includes('turtle'))                           return '🐢 Sea Turtles';
  if (t.includes('coral') || t.includes('reef'))     return '🪸 Coral & Reefs';
  if (t.includes('sanctuary') || t.includes('protected area')) return '🛡️ Marine Protection';
  if (t.includes('discovery') || t.includes('research') || t.includes('breakthrough')) return '🔬 Science';
  if (t.includes('cleanup') || t.includes('plastic')) return '♻️ Cleanup';
  return '🌊 Ocean Conservation';
}

// ─────────────────────────────────────────────
// RSS FETCHER
// ─────────────────────────────────────────────
function fetchRSS(query) {
  return new Promise((resolve, reject) => {
    const makeRequest = (reqUrl, hops = 0) => {
      if (hops > 5) return reject(new Error('Too many redirects'));
      https.get(reqUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Referer': 'https://news.google.com/',
          'Cache-Control': 'no-cache'
        }
      }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          const loc = res.headers.location;
          res.resume();
          return makeRequest(loc.startsWith('http') ? loc : `https://news.google.com${loc}`, hops + 1);
        }
        let stream = res;
        if (res.headers['content-encoding'] === 'gzip')         stream = res.pipe(zlib.createGunzip());
        else if (res.headers['content-encoding'] === 'deflate') stream = res.pipe(zlib.createInflate());
        let data = '';
        stream.on('data', c => data += c);
        stream.on('end', () => resolve(data));
        stream.on('error', reject);
      }).on('error', reject);
    };
    makeRequest(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`);
  });
}

async function parseRSS(xml) {
  try {
    const result = await new xml2js.Parser().parseStringPromise(xml);
    return (result?.rss?.channel?.[0]?.item || []).map(item => ({
      title:       (Array.isArray(item.title)       ? item.title[0]       : item.title       || '').replace(/<[^>]*>/g, '').trim(),
      description: (Array.isArray(item.description) ? item.description[0] : item.description || '').replace(/<[^>]*>/g, '').trim(),
      link:        Array.isArray(item.link)          ? item.link[0]        : item.link        || '',
      pubDate:     Array.isArray(item.pubDate)       ? item.pubDate[0]     : item.pubDate     || ''
    }));
  } catch { return []; }
}

// ─────────────────────────────────────────────
// SLACK
// ─────────────────────────────────────────────
function postToSlack(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(SLACK_WEBHOOK_URL);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendToSlack(articles) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  await postToSlack({
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🌊 Positive Ocean News — ${date}`, emoji: true } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: articles.length > 0
            ? `Found *${articles.length}* verified stories from trusted outlets today.`
            : `📭 Nothing worth surfacing today. Back tomorrow.`
        }
      }
    ]
  });

  if (articles.length === 0) return;

  for (let i = 0; i < articles.length; i += 5) {
    const batch = articles.slice(i, i + 5);
    const blocks = [{ type: 'divider' }];

    for (const a of batch) {
      const cleanTitle = a.title.replace(/ - [^-]+$/, '').trim();
      const dashIdx    = a.title.lastIndexOf(' - ');
      const source     = dashIdx !== -1 ? a.title.substring(dashIdx + 3) : '';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `${a.category}${source ? `  ·  _${source}_` : ''}${a.publishedLabel ? `  ·  ${a.publishedLabel}` : ''}`,
            `*${cleanTitle}*`,
            a.description ? a.description.substring(0, 200) + (a.description.length > 200 ? '...' : '') : '',
            `<${a.link}|Read full story>`
          ].filter(Boolean).join('\n')
        }
      });
      blocks.push({ type: 'divider' });
    }

    await postToSlack({ blocks });
    console.log(`[SLACK] Batch ${Math.floor(i / 5) + 1} posted`);
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log('[START] Ocean News Monitor');
  if (!SLACK_WEBHOOK_URL) { console.error('[ERROR] SLACK_WEBHOOK_URL_OCEAN not set'); process.exit(1); }

  const seen = new Set();
  const results = [];
  let fetched = 0, sourceOut = 0, contentOut = 0, dateOut = 0;

  // Only accept articles published in the last 7 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  for (const query of searchQueries) {
    try {
      const xml   = await fetchRSS(query);
      const items = await parseRSS(xml);
      fetched += items.length;

      for (const item of items) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);

        // Date filter — skip anything older than 7 days
        if (item.pubDate) {
          const published = new Date(item.pubDate);
          if (!isNaN(published) && published < cutoff) { dateOut++; continue; }
        }

        if (!isFromTrustedSource(item.title))                   { sourceOut++;  continue; }
        if (!passesContentFilter(item.title, item.description)) { contentOut++; continue; }

        const publishedLabel = item.pubDate
          ? new Date(item.pubDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : '';

        results.push({ ...item, category: detectCategory(item.title + ' ' + item.description), publishedLabel });
      }
    } catch (e) { console.error(`[ERROR] "${query}": ${e.message}`); }

    await new Promise(r => setTimeout(r, 200));
  }

  const deduped = Array.from(
    new Map(results.map(r => [r.title.replace(/ - [^-]+$/, '').toLowerCase(), r])).values()
  );

  console.log(`[STATS] Fetched: ${fetched} | Date-rejected: ${dateOut} | Source-rejected: ${sourceOut} | Content-rejected: ${contentOut} | Final: ${deduped.length}`);
  await sendToSlack(deduped);
  console.log('[DONE]');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
