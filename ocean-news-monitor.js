#!/usr/bin/env node

/**
 * Underwater Lunatics Ocean News Monitor
 * Uses Google News RSS to monitor positive ocean-related news
 * No API key needed - completely free!
 * 
 * Usage:
 *   node ocean-news-monitor.js
 * 
 * Setup:
 *   1. npm install xml2js (for parsing RSS feeds)
 *   2. Only needs SLACK_WEBHOOK_URL_OCEAN environment variable
 *   3. Run script daily with cron or GitHub Actions
 */

const https = require('https');
const url = require('url');
const xml2js = require('xml2js');

// Configuration
const CONFIG = {
  slackWebhook: process.env.SLACK_WEBHOOK_URL_OCEAN,
  channel: '#positive-ocean-news',
  
  // Search queries for Google News RSS
  // These are the keywords we search for on Google News
  searchQueries: [
    // WILDLIFE STORIES (priority)
    'whale recovery',
    'whale population increase',
    'dolphin protection',
    'shark conservation',
    'shark fin ban',
    'sea turtle recovery',
    'fish population recovery',
    'seabird protection',
    'marine biodiversity',
    
    // CORAL & REEF (priority)
    'coral restoration',
    'reef restoration',
    'coral reef health',
    'bleaching recovery',
    
    // SCIENTIFIC BREAKTHROUGHS (priority)
    'marine research breakthrough',
    'ocean research discovery',
    'marine biology breakthrough',
    'oceanography research',
    'marine science innovation',
    
    // CONSERVATION POLICY & DECISIONS (priority)
    'marine protected area',
    'ocean sanctuary',
    'marine protection law',
    'conservation ban',
    'wildlife protection policy',
    'endangered species protection',
    'international marine agreement',
    
    // RESTORATION PROJECTS
    'reef restoration project',
    'marine conservation initiative',
    'coastal restoration',
    'seagrass restoration',
    'mangrove restoration',
    'kelp forest restoration'
  ],
  
  // Positive keywords to prioritize
  positiveKeywords: {
    conservation: ['conservation', 'restore', 'restoration', 'protect', 'protection', 'preservation', 'recover', 'recovery'],
    research: ['research', 'discover', 'discovery', 'study', 'breakthrough', 'innovation', 'technology', 'solution'],
    cleanup: ['cleanup', 'clean up', 'remove', 'removal', 'cleanup project', 'restoration project'],
    wildlife: ['whale', 'dolphin', 'shark', 'turtle', 'fish', 'coral', 'species', 'animal'],
    sustainability: ['sustainable', 'eco-friendly', 'renewable', 'green', 'organic', 'sustainable'],
    success: ['success', 'thriving', 'recover', 'recovery', 'return', 'boom', 'population increase', 'rebound'],
    initiative: ['initiative', 'program', 'project', 'partnership', 'collaboration', 'mission']
  }
};

/**
 * Fetch RSS feed from Google News (with redirect handling)
 */
function fetchGoogleNewsRSS(query) {
  return new Promise((resolve, reject) => {
    const makeRequest = (url) => {
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/rss+xml,application/xml;q=0.9,text/html;q=0.8,*/*;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Referer': 'https://news.google.com/',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      };
      
      https.get(url, options, (res) => {
        // Handle redirects
        if (res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307 || res.statusCode === 308) {
          const redirectUrl = res.headers.location;
          console.log(`      [REDIRECT] Status ${res.statusCode} -> ${redirectUrl.substring(0, 50)}...`);
          res.resume(); // Drain response
          if (redirectUrl.startsWith('http')) {
            makeRequest(redirectUrl);
          } else {
            makeRequest(`https://news.google.com${redirectUrl}`);
          }
          return;
        }
        
        let data = '';
        let stream = res;
        
        console.log(`      [RESPONSE] Status: ${res.statusCode}, Encoding: ${res.headers['content-encoding'] || 'none'}`);
        
        // Handle gzip/deflate compression
        if (res.headers['content-encoding'] === 'gzip') {
          console.log(`      [DECOMPRESS] Using gzip`);
          stream = res.pipe(require('zlib').createGunzip());
        } else if (res.headers['content-encoding'] === 'deflate') {
          console.log(`      [DECOMPRESS] Using deflate`);
          stream = res.pipe(require('zlib').createInflate());
        } else {
          console.log(`      [NO-COMPRESS] Data coming uncompressed`);
        }
        
        stream.on('data', chunk => {
          data += chunk;
        });
        
        stream.on('end', () => {
          console.log(`      [DATA] Received ${data.length} bytes`);
          if (data.length > 0) {
            console.log(`      [PREVIEW] First 100 chars: ${data.substring(0, 100)}`);
          }
          
          try {
            if (!data || data.length === 0) {
              console.log(`      [ERROR] Empty response data`);
              resolve({ rss: { channel: [{ item: [] }] } });
              return;
            }
            
            // Parse XML RSS feed
            const parser = new xml2js.Parser();
            parser.parseString(data, (err, result) => {
              if (err) {
                console.log(`      [PARSE-ERROR] ${err.message}`);
                reject(new Error(`Failed to parse RSS: ${err.message}`));
              } else {
                console.log(`      [PARSED] Success`);
                resolve(result);
              }
            });
          } catch (e) {
            console.log(`      [EXCEPTION] ${e.message}`);
            reject(new Error(`Failed to process RSS response: ${e.message}`));
          }
        });
        
        stream.on('error', (err) => {
          console.log(`      [STREAM-ERROR] ${err.message}`);
          reject(err);
        });
        
      }).on('error', (err) => {
        console.log(`      [REQUEST-ERROR] ${err.message}`);
        reject(err);
      });
    };
    
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}`;
    makeRequest(rssUrl);
  });
}

/**
 * Extract articles from RSS feed
 */
function extractArticlesFromRSS(rssData) {
  try {
    const channel = rssData.rss.channel[0];
    const items = channel.item || [];
    
    console.log(`   [DEBUG] Found ${items.length} total items in RSS feed`);
    
    return items.map((item, index) => {
      try {
        const title = item.title ? (Array.isArray(item.title) ? item.title[0] : item.title) : 'No title';
        const description = item.description ? (Array.isArray(item.description) ? item.description[0] : item.description) : '';
        const link = item.link ? (Array.isArray(item.link) ? item.link[0] : item.link) : '';
        const pubDate = item.pubDate ? (Array.isArray(item.pubDate) ? item.pubDate[0] : item.pubDate) : '';
        
        return {
          title: title,
          description: description,
          link: link,
          pubDate: pubDate,
          source: 'Google News'
        };
      } catch (e) {
        console.log(`   [DEBUG] Error parsing item ${index}: ${e.message}`);
        return null;
      }
    }).filter(item => item !== null);
  } catch (e) {
    console.log(`   [DEBUG] Error extracting articles: ${e.message}`);
    return [];
  }
}

/**
 * Categorize ocean news by type
 */
function categorizeOceanNews(title, description) {
  const text = `${title} ${description || ''}`.toLowerCase();
  
  for (const [category, keywords] of Object.entries(CONFIG.positiveKeywords)) {
    if (keywords.some(kw => text.includes(kw))) {
      return category.charAt(0).toUpperCase() + category.slice(1);
    }
  }
  
  return 'general';
}

/**
 * Check if article has positive sentiment
 */
function isPositiveNews(title, description) {
  // Since we're already searching for positive ocean queries,
  // most articles will be relevant. Just check for positive signals
  const text = `${title} ${description || ''}`.toLowerCase();
  
  // Check for positive signals
  const hasPositiveSignal = Object.values(CONFIG.positiveKeywords).flat().some(kw => text.includes(kw));
  
  // If no positive signals, still accept if it's about a positive topic
  const positiveTopics = ['conservation', 'protect', 'restore', 'clean', 'sustainable', 'research', 'discovery', 'solution', 'recovery'];
  const hasPositiveTopic = positiveTopics.some(kw => text.includes(kw));
  
  return hasPositiveSignal || hasPositiveTopic;
}

/**
 * Generate content angle based on category
 */
function generateContentAngle(category, title) {
  const angles = {
    'Conservation': '🌍 *Conservation story angle.* Perfect for "positive impact" narrative content.',
    'Research': '🔬 *Discovery story angle.* Showcase the science behind ocean solutions.',
    'Cleanup': '♻️ *Solution story angle.* Show real-world cleanup and restoration efforts.',
    'Wildlife': '🐋 *Wildlife story angle.* Emotional connection with ocean animals.',
    'Sustainability': '🌱 *Sustainable future angle.* Hope-based narrative about ocean health.',
    'Success': '🎉 *Success story angle.* Celebrate ocean recovery and comeback stories.',
    'Initiative': '🚀 *Movement story angle.* Inspiring human efforts to save the ocean.',
    'General': '🌊 *Ocean story angle.* Timely content about ocean discoveries and happenings.'
  };
  
  return angles[category] || angles['General'];
}

/**
 * Format and send Slack message
 */
async function sendToSlack(articles) {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🌊 Daily Ocean Content Opportunities - ${new Date().toLocaleDateString()}`,
        emoji: true
      }
    },
    {
      type: 'divider'
    }
  ];

  if (!articles || articles.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '📭 No positive ocean content found today.\n\nContinuing to monitor:\n• Ocean conservation\n• Marine research\n• Ocean cleanup initiatives\n• Wildlife stories\n• Sustainability solutions\n\nCheck back tomorrow!'
      }
    });
    
    console.log('ℹ️  No positive ocean articles found for today. Sending notification to Slack.');
  } else {
    // Add article count header
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Found *${articles.length}* positive ocean content opportunities for your storytelling.`
        }
      ]
    });

    blocks.push({
      type: 'divider'
    });

    // Add each article (limit to 10 to avoid message size limits)
    articles.slice(0, 10).forEach((article, index) => {
      const emoji = {
        'Conservation': '🌍',
        'Research': '🔬',
        'Cleanup': '♻️',
        'Wildlife': '🐋',
        'Sustainability': '🌱',
        'Success': '🎉',
        'Initiative': '🚀',
        'General': '🌊'
      }[article.category] || '🌊';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${article.category}*\n*${article.title}*\n${article.description.substring(0, 150)}${article.description.length > 150 ? '...' : ''}\n<${article.link}|Read full story>`
        }
      });

      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${article.contentAngle}`
          }
        ]
      });

      if (index < Math.min(articles.length - 1, 9)) {
        blocks.push({ type: 'divider' });
      }
    });

    // If more than 10 articles, add note
    if (articles.length > 10) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `... and ${articles.length - 10} more stories.`
          }
        ]
      });
    }
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ blocks, channel: CONFIG.channel });
    
    const parsedUrl = new url.URL(CONFIG.slackWebhook);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          reject(new Error(`Slack API returned status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  console.log('🌊 Starting Ocean News Monitor...');
  console.log(`📅 ${new Date().toLocaleString()}\n`);
  
  // Validate configuration
  if (!CONFIG.slackWebhook) {
    console.error('❌ ERROR: SLACK_WEBHOOK_URL_OCEAN environment variable not set');
    console.error('   Set it in environment or GitHub Secrets');
    process.exit(1);
  }

  const relevantArticles = [];
  const processedUrls = new Set();
  const searchResults = {
    total: 0,
    matched: 0,
    errors: 0
  };

  try {
    console.log('🔍 Searching for positive ocean content...\n');
    
    for (const query of CONFIG.searchQueries) {
      process.stdout.write(`   📍 ${query}... `);
      
      try {
        const rssData = await fetchGoogleNewsRSS(query);
        const articles = extractArticlesFromRSS(rssData);
        searchResults.total += articles.length;
        
        let queryMatches = 0;
        
        for (const article of articles) {
          // Skip duplicates
          if (processedUrls.has(article.link)) continue;
          processedUrls.add(article.link);

          // Evaluate as positive ocean news
          if (isPositiveNews(article.title, article.description || '')) {
            const category = categorizeOceanNews(article.title, article.description || '');
            const contentAngle = generateContentAngle(category, article.title);
            
            relevantArticles.push({
              title: article.title,
              description: article.description || article.content || 'No summary available',
              link: article.link,
              category: category,
              contentAngle: contentAngle,
              publishedAt: article.pubDate
            });
            
            queryMatches++;
            searchResults.matched++;
          }
        }
        
        console.log(`found ${queryMatches}/${articles.length}`);
        
      } catch (err) {
        console.log(`⚠️ error`);
        console.error(`      ${err.message}`);
        searchResults.errors++;
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n📊 Search Results:`);
    console.log(`   Total articles: ${searchResults.total}`);
    console.log(`   Positive ocean content: ${searchResults.matched}`);
    console.log(`   Errors: ${searchResults.errors}`);

    // Sort by date (newest first)
    relevantArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Send to Slack
    console.log(`\n📤 Sending to Slack...`);
    await sendToSlack(relevantArticles);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Success! Message sent to #positive-ocean-news in ${duration}s`);
    console.log(`\n🎬 ${relevantArticles.length} content opportunities found.\n`);

  } catch (error) {
    console.error('\n❌ Fatal Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main();
