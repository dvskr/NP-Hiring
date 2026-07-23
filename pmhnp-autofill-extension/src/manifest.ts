import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
    manifest_version: 3,
    // Brand values mirror config/brand.ts in the main app — keep in lockstep.
    name: 'NP Hiring — Autofill Agent',
    description:
        'Autofill NP job applications in seconds. Built for Nurse Practitioners and APRNs.',
    version: '1.0.0',
    permissions: ['activeTab', 'storage', 'tabs', 'scripting', 'alarms', 'sidePanel', 'webNavigation'],
    host_permissions: [
        'https://nphiring.com/*',
        'https://www.nphiring.com/*',
        '<all_urls>',
    ],
    background: {
        service_worker: 'src/background/index.ts',
        type: 'module',
    },
    content_scripts: [
        {
            matches: ['<all_urls>'],
            js: ['src/content/index.ts'],
            run_at: 'document_idle',
            all_frames: true,
            match_about_blank: true,
        },
    ],
    action: {
        default_popup: 'src/popup/index.html',
        default_icon: {
            '16': 'public/icons/icon-16.png',
            '32': 'public/icons/icon-32.png',
            '48': 'public/icons/icon-48.png',
            '128': 'public/icons/icon-128.png',
        },
    },
    side_panel: {
        default_path: 'src/sidebar/index.html',
    },
    icons: {
        '16': 'public/icons/icon-16.png',
        '32': 'public/icons/icon-32.png',
        '48': 'public/icons/icon-48.png',
        '128': 'public/icons/icon-128.png',
    },
});
