// 播放器总线 — a module-level channel between the long-video player and the panels
// that sit in OTHER subtrees of the detail page (the AI summary / chat / 文稿 tabs
// live in the right rail, the player in the main column, both rendered by an RSC
// page — there is no common client ancestor to hang a context on without turning
// the page layout into a client component). One player per page, so a singleton
// is the honest shape. Plain functions, no React: nothing here can re-render
// anything by itself.
//
//   requestSeek(sec)     a panel asks the player to jump (and play)
//   onSeekRequest(cb)    the player listens
//   publishTime(sec)     the player reports progress (it throttles)
//   onTime(cb)           the 文稿 tab follows along
//   latestTime()         the last reported time, for a late subscriber

type Listener = (sec: number) => void;

const seekListeners = new Set<Listener>();
const timeListeners = new Set<Listener>();
let lastTime = 0;

export function requestSeek(sec: number): void {
  if (!Number.isFinite(sec) || sec < 0) return;
  for (const cb of [...seekListeners]) cb(sec);
}

export function onSeekRequest(cb: Listener): () => void {
  seekListeners.add(cb);
  return () => {
    seekListeners.delete(cb);
  };
}

export function publishTime(sec: number): void {
  if (!Number.isFinite(sec)) return;
  lastTime = sec;
  for (const cb of [...timeListeners]) cb(sec);
}

export function onTime(cb: Listener): () => void {
  timeListeners.add(cb);
  return () => {
    timeListeners.delete(cb);
  };
}

export function latestTime(): number {
  return lastTime;
}

/** True while a player is mounted — panels only render seek affordances when something can answer them. */
export function hasPlayer(): boolean {
  return seekListeners.size > 0;
}
