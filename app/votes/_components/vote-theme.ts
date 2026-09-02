// 投票色板 —— 全站「chrome 全墨黑、颜色留给内容」配色契约在这一屏的**有意例外**，
// 和知识库阅读器的 `--reader-accent` 是同一个道理：一个自成一体的界面有它自己的
// 主色时，满屏墨黑是错的答案。投票尤其如此 —— 一整页黑白按钮既不像在办活动，
// 也让人看不出「哪张我投过了」。
//
// 这里的颜色是**语义**，不是装饰。一张卡在同一时刻只会出现其中一种，所以整屏
// 扫过去读到的是「还有哪些没投」，而不是彩色噪音：
//
//   玫红 rose    = 投票这个动作本身（未投的按钮、提交投票、我还剩几票）
//   琥珀 amber   = 选了还没提交 / 还没开投（本活动是「先选后提交」，忘记提交是
//                  这个流程唯一真正会丢票的地方，值得一个警示色）
//   翠绿 emerald = 已提交，这票已经落库
//   金 gold      = 名次与荣誉（冠亚季、奖杯、精选）
//
// 让它不显廉价的是饱和度纪律：**只有 CTA 是实心高饱和**，两个反馈态一律淡色底 +
// 强色字 + 细边，规则药丸、搜索、排序这些元数据继续保持墨黑描边。加新状态前先想
// 清楚它属于上面哪一类，不要再引入第五种颜色。
//
// 纯字符串模块（无 import）：RSC 的 VoteCard 和客户端的 VoteGallery 共用同一份。

/** 未投票的主行动按钮：整屏唯一的实心高饱和块。 */
export const VOTE_CTA =
  'bg-rose-600 text-white shadow-sm shadow-rose-900/20 transition hover:bg-rose-700 ' +
  'disabled:cursor-not-allowed disabled:bg-rose-600/45 disabled:text-white/80 disabled:shadow-none ' +
  'dark:bg-rose-600 dark:hover:bg-rose-500 dark:disabled:bg-rose-600/35';

/** 已选待提交：淡琥珀底 + 琥珀字，明确是「还没交」。 */
export const VOTE_PENDING =
  'border border-amber-400/80 bg-amber-50 text-amber-800 ' +
  'dark:border-amber-500/45 dark:bg-amber-500/15 dark:text-amber-200';

/** 待撤回（草稿里把已投的票拿掉了）：同属琥珀家族，但虚线表示「反向的待提交」。 */
export const VOTE_PENDING_DASHED =
  'border border-dashed border-amber-400/80 bg-amber-50/60 text-amber-700 transition ' +
  'hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50 ' +
  'dark:border-amber-500/45 dark:bg-amber-500/10 dark:text-amber-200/90 dark:hover:bg-amber-500/20';

/** 已投（已提交）：淡翠绿，安静的确认，不跟 CTA 抢注意力。 */
export const VOTE_DONE =
  'border border-emerald-500/40 bg-emerald-50 text-emerald-700 ' +
  'dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300';

/** 未开始：置灰但带一点琥珀，看得出「到点就能投」而不是坏了。 */
export const VOTE_LOCKED =
  'cursor-not-allowed border border-dashed border-amber-300/70 text-amber-600/80 ' +
  'dark:border-amber-500/30 dark:text-amber-300/60';

/** 画面角标：投过的作品在网格里要一眼可辨，实心小药丸压在图上最清楚。 */
export const BADGE_PENDING = 'bg-amber-400 text-amber-950 shadow-sm shadow-black/25';
export const BADGE_DONE = 'bg-emerald-500 text-white shadow-sm shadow-black/25';

/** 我的票数预算：还有票 = 淡玫红（去投），投完 = 中性描边。 */
export const BUDGET_LEFT =
  'border border-rose-300/70 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/12 dark:text-rose-300';
export const BUDGET_OUT =
  'border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300';

/** 活动状态药丸：进行中 = 玫红，未开始 = 琥珀，已结束 = 中性。 */
export const STATUS_LIVE =
  'border border-rose-300/70 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/12 dark:text-rose-300';
export const STATUS_SOON =
  'border border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/12 dark:text-amber-200';
export const STATUS_OVER =
  'border border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300';

/** 封面上的状态角标（图片背景，必须实心才读得出来）。 */
export const COVER_LIVE = 'bg-rose-600/95 text-white';
export const COVER_SOON = 'bg-amber-500/95 text-white';
export const COVER_OVER = 'bg-zinc-900/80 text-white';

/**
 * 名次奖牌：金/银/铜用渐变而不是平色 —— 一来有金属感，二来和上面那些「平色淡底」
 * 的状态药丸在视觉上分得开，琥珀因此不会同时表示「待提交」和「第一名」。
 */
export const RANK_MEDAL: Record<number, string> = {
  1: 'bg-gradient-to-br from-amber-200 to-amber-500 text-amber-950 shadow-sm shadow-amber-900/20',
  2: 'bg-gradient-to-br from-zinc-100 to-zinc-400 text-zinc-800 shadow-sm shadow-black/15',
  3: 'bg-gradient-to-br from-orange-300 to-orange-600 text-white shadow-sm shadow-orange-900/20',
};

/** 榜单/网格里名次之外的普通序号。 */
export const RANK_PLAIN = 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
