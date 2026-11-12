import {
  SCROLL_QUARTILES,
  type AnalyticsBeaconEvent,
  type OutboundDestination,
  type ScrollQuartile,
  type ShareOutcome,
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
    }
  }

  if (typeof fetch === 'function') {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }
}

export function bookViewScrollPercent(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number | null {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0) return null;
  return Math.min(100, Math.max(0, (scrollTop / scrollable) * 100));
}

export function scrollQuartilesReached(percent: number): ScrollQuartile[] {
  return SCROLL_QUARTILES.filter((quartile) => percent >= quartile);
}

export function recordOutboundClick(destination: OutboundDestination): void {
  send({ event: 'outbound', destination });
}

export function recordShare(result: ShareOutcome): void {
  send({ event: 'share', result });
}

export function recordFilterReset(): void {
  send({ event: 'filter_reset' });
}

export function recordScroll(quartile: ScrollQuartile): void {
  send({ event: 'scroll', quartile });
}
