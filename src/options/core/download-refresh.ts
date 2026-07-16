// Fan-out registry for the bootstrap's onDownloaded port: panels register a
// refresh callback once, and the composition root just notifies every
// subscriber when a DOWNLOADED message arrives. Subscribing is a plain array
// push (no DOM/browser API call), so it stays safe to do at module import
// time — only the callbacks themselves run DOM work, and only once notified.
export type DownloadRefreshSubscriber = () => void;

const subscribers: DownloadRefreshSubscriber[] = [];

export const subscribeDownloadRefresh = (subscriber: DownloadRefreshSubscriber): void => {
  subscribers.push(subscriber);
};

export const notifyDownloadRefresh = (): void => {
  subscribers.forEach((subscriber) => subscriber());
};
