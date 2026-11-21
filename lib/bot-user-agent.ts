/**
 * Known bot and crawler user agents, excluded from view counts. Shared by
 * GET /api/jobs/[id] and POST /api/jobs/[id]/track-view.
 */
const BOT_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /scraper/i,
  /googlebot/i, /bingbot/i, /yandex/i, /baiduspider/i, /duckduckbot/i,
  /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i, /whatsapp/i,
  /telegrambot/i, /discordbot/i, /slackbot/i,
  // Moz's crawlers by name: a bare /moz/i matched "Mozilla", which opens
  // every browser's user agent, so no real visitor was ever counted.
  /semrush/i, /ahrefs/i, /rogerbot/i, /dotbot/i, /moz\.com/i, /majestic/i, /serpstat/i,
  /headlesschrome/i, /puppeteer/i, /playwright/i, /phantomjs/i,
  /lighthouse/i, /pagespeed/i, /gtmetrix/i,
  /uptimerobot/i, /pingdom/i, /statuspage/i, /monitoring/i,
  /curl/i, /wget/i, /axios/i, /node-fetch/i, /python-requests/i,
  /go-http-client/i, /java\//i, /ruby/i,
];

/** True for a missing, implausibly short or known automated user agent. */
export function isBotUserAgent(userAgent: string | null): boolean {
  if (!userAgent) return true; // No user-agent = likely bot
  if (userAgent.length < 20) return true; // Too short = likely automated
  return BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}
