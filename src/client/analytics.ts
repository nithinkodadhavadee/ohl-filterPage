import type {
  AnalyticsBeaconEvent,
  OutboundDestination,
  ScrollQuartile,
  ShareOutcome,
} from '../shared/analytics';

const ENDPOINT = '/api/analytics/event';

function send(event: AnalyticsBeaconEvent): void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const body = JSON.stringify(event);
  const beacon = navigator.sendBeacon;
  if (typeof beacon === 'function') {
    try {
      const sent = beacon.call(
        navigator,
        ENDPOINT,
        new Blob([body], { type: 'application/json' }),
      );
      if (sent) return;
    } catch {
      // Fall through to fetch keepalive.
    }
  }

  if (typeof fetch === 'function') {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Analytics must never interfere with the page.
    });
  }
}

export function trackOutbound(destination: OutboundDestination): void {
  send({ event: 'outbound', destination });
}

export function trackShare(result: ShareOutcome): void {
  send({ event: 'share', result });
}

export function trackFilterReset(): void {
  send({ event: 'filter_reset' });
}

export function trackScroll(quartile: ScrollQuartile): void {
  send({ event: 'scroll', quartile });
}
