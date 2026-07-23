// Service Worker for Push Notifications — NP Hiring
/* eslint-disable no-restricted-globals */
//
// NOTE: static public asset — it cannot import config/brand.ts, so the
// two fallback strings below hardcode the brand/niche and must be kept
// in sync with config/brand.ts on fork (tracked by the brand-leak and
// niche-copy ratchets + scripts/fork-preflight.ts). In practice they
// never fire: the push cron always sends title/body in its payload.

self.addEventListener('push', function (event) {
    if (!event.data) return;

    try {
        const data = event.data.json();
        const options = {
            body: data.body || 'New NP jobs available!',
            icon: data.icon || '/icon-192x192.png',
            badge: data.badge || '/favicon-48x48.png',
            data: { url: data.url || '/jobs' },
            vibrate: [100, 50, 100],
            actions: [
                { action: 'view', title: 'View Jobs' },
                { action: 'dismiss', title: 'Dismiss' },
            ],
        };

        event.waitUntil(
            self.registration.showNotification(data.title || 'NP Hiring', options)
        );
    } catch (e) {
        console.error('Push event error:', e);
    }
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    const url = event.notification.data?.url || '/jobs';

    if (event.action === 'dismiss') return;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            // Focus existing tab if available. Match on the SW's own origin
            // (service workers are same-origin by spec) — never a hardcoded
            // domain, so this file works unchanged on any deployment.
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            // Open new tab
            return self.clients.openWindow(url);
        })
    );
});
