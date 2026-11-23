import { createHash } from 'node:crypto';
import { brand } from '@/config/brand';
import { MCP_PREFIX } from '@/lib/mcp/prefix';
import { WIDGET_BUNDLE_JS } from './generated/bundle';
import { WIDGET_CSS } from './src/styles';
import type { WidgetView } from './src/contracts';
import { MCP_RESOURCES, getIssuer, type McpResourceId } from '@/lib/mcp/oauth/config';

/**
 * The UI resources the MCP endpoints serve: one self-contained HTML document
 * per view, with the stylesheet inlined and the shared bundle inlined.
 *
 * Self-contained is a requirement, not a preference. Claude blocks every
 * external origin from an app by default and its iOS app ignores declared
 * domains, so a widget that fetched its own script or font would render
 * blank there. Data reaches the widget only through tool results.
 *
 * The bundle names no site: the site's name, role, hosts and support
 * address are written onto the document's root here and read by the cards
 * (src/board.ts), the same bundle the job boards' engine serves.
 *
 * URIs carry a content hash. ChatGPT caches resource contents for up to an
 * hour and Claude caches tools/list per connector session, so a fixed URI
 * would keep serving yesterday's widget after a deploy.
 */

export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

const ROLE = brand.niche.short;

/** The hosts a card may open: the site's own, as served and as its domain is written. */
function boardHosts(): string[] {
  const hosts = new Set<string>([brand.domain, `www.${brand.domain}`]);
  try {
    hosts.add(new URL(getIssuer()).hostname);
  } catch {
    // An issuer that is not a URL adds nothing; the domain still opens.
  }
  return [...hosts].filter(Boolean);
}

/** What the cards read about the board (src/board.ts), as data attributes. */
const BOARD_ATTRIBUTES: Readonly<Record<string, string>> = {
  'data-board': brand.name,
  'data-board-employers': MCP_RESOURCES.employer.displayName,
  'data-role': ROLE,
  'data-hosts': boardHosts().join(' '),
  'data-support': brand.email.support,
};

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ATTRIBUTES_HTML = Object.entries(BOARD_ATTRIBUTES)
  .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
  .join(' ');

export const WIDGET_VERSION = createHash('sha256')
  .update(WIDGET_BUNDLE_JS)
  .update(WIDGET_CSS)
  .update(ATTRIBUTES_HTML)
  .digest('hex')
  .slice(0, 12);

interface WidgetDefinition {
  title: string;
  /** For ChatGPT, so the model knows what the person already sees. */
  description: string;
}

export const WIDGETS: Readonly<Record<WidgetView, WidgetDefinition>> = {
  jobs: {
    title: `${ROLE} job results`,
    description:
      'Shows the matching jobs as cards with pay, schedule, location and whether the job takes applications here. The person can open a job, save it, or load more results without asking.',
  },
  job: {
    title: `${ROLE} job details`,
    description:
      "Shows one job in full: pay, schedule, setting, experience, the state's NP practice authority, benefits and the description, with Apply and Save buttons.",
  },
  apply: {
    title: 'Application review',
    description:
      'Shows exactly what will be sent to the employer, the editable cover letter and the screening questions. Nothing is sent until the person checks the consent box and presses Submit in this card.',
  },
  applications: {
    title: 'Your applications',
    description: 'Lists the person’s applications with their current status and dates.',
  },
  pay: {
    title: `${ROLE} pay insights`,
    description:
      'Charts advertised pay ranges (25th percentile, median, 75th percentile) for the requested state or segment against the national figures, with sample sizes.',
  },
  posting: {
    title: 'Job posting preview',
    description:
      'Shows how the employer’s posting will look, what must be fixed before it can go live, the price, and the button to publish or pay on Stripe.',
  },
  postings: {
    title: 'Your job postings',
    description: 'Lists the employer’s postings with status, views, apply clicks and applicant counts.',
  },
  facts: {
    title: `${brand.name} summary`,
    description:
      `Shows the figures the tool returned as labelled rows in sections, with the assumptions underneath and links to the matching ${brand.name} page.`,
  },
  list: {
    title: `${brand.name} list`,
    description: `Shows the items the tool returned as rows with a title, a short description and a link to open each one on ${brand.name}.`,
  },
  applicants: {
    title: 'Applicants',
    description:
      'Lists applicants in the order they applied, with their stated qualifications and screening answers. Status changes happen only when the employer presses a button.',
  },
};

export function widgetResourceUri(view: WidgetView): string {
  return `ui://${MCP_PREFIX}/${view}.${WIDGET_VERSION}.html`;
}

const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RESOURCE_URI_RE = new RegExp(`^ui://${escapeForPattern(MCP_PREFIX)}/([a-z]+)\\.([a-f0-9]{12})\\.html$`);

/** The view a ui:// URI names, if it is one of ours at the current version. */
export function viewForResourceUri(uri: string): WidgetView | null {
  const match = RESOURCE_URI_RE.exec(uri);
  if (!match || match[2] !== WIDGET_VERSION) return null;
  const view = match[1] as WidgetView;
  return view in WIDGETS ? view : null;
}

/** A closing script tag inside the bundle would end the inline script early. */
const SAFE_BUNDLE = WIDGET_BUNDLE_JS.replace(/<\/(script)/gi, '<\\/$1');

export function widgetHtml(view: WidgetView): string {
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttribute(WIDGETS[view].title)}</title>
<style>${WIDGET_CSS}</style>
</head>
<body>
<div id="pm-root" class="pm-root" data-view="${view}" ${ATTRIBUTES_HTML}><div class="pm-skel" aria-hidden="true"><div></div><div></div></div></div>
<script>${SAFE_BUNDLE}</script>
</body>
</html>`;
}

function siteOrigin(): string {
  return new URL(getIssuer()).origin;
}

/**
 * Metadata on the resource contents. Standard fields for every MCP Apps
 * host, plus ChatGPT's aliases.
 *
 * `_meta.ui.domain` is deliberately unset. Its format is host-specific:
 * Claude accepts only its own "{hash}.claudemcpcontent.com" form and shows an
 * error for anything else, while ChatGPT wants an origin. ChatGPT reads its
 * own alias, openai/widgetDomain, and Claude derives its sandbox origin
 * itself when the field is absent.
 */
export function widgetResourceMeta(view: WidgetView, endpoint: McpResourceId): Record<string, unknown> {
  const origin = siteOrigin();
  return {
    ui: {
      // Nothing to declare: the document fetches nothing. Spelled out so the
      // review scanners see a deliberate empty policy, not a missing one.
      csp: { connectDomains: [], resourceDomains: [] },
      prefersBorder: false,
    },
    'openai/widgetDescription': WIDGETS[view].description,
    'openai/widgetPrefersBorder': false,
    'openai/widgetCSP': {
      connect_domains: [],
      resource_domains: [],
      // Links the widget opens with openExternal, so ChatGPT does not warn.
      redirect_domains: [origin],
    },
    // Unique per ChatGPT listing. Only the job seeker connector is meant for
    // the ChatGPT directory (its commerce rules exclude the employer one).
    ...(endpoint === 'candidate' ? { 'openai/widgetDomain': origin } : {}),
  };
}
