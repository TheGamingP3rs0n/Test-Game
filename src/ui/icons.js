// Icon system: Lucide line icons (ISC license) rendered as inline SVG.
//   icon('phone')               → <span class="ico"><svg…></span>
//   richText('Missed 📵 call')  → nodes with any emoji swapped for the matching icon
//   drawIcon(ctx, 'phone', …)   → paint an icon into a canvas texture (3D posters, screens)
// The game shows no emoji: anything that slips in (mod JSON, AI replies) is mapped to an
// icon or removed by richText()/stripEmoji().
import {
  createElement, Phone, PhoneOff, PhoneIncoming, PhoneMissed, PhoneCall, Mic, MicOff, Headphones, Headset, Monitor, MonitorOff,
  FileText, Files, Flag, CircleDot, Banknote, X, Trash2, Shield, ShieldCheck, ShieldAlert, Star, Play, Pause, TriangleAlert, Folder, FolderOpen,
  Palette, Save, Image, Images, UserSearch, Landmark, Lock, LockOpen, Skull, User, Users, Settings, Zap, ZapOff, Camera, Globe, Disc, Network,
  Gift, Mail, Check, CircleCheck, KeyRound, Puzzle, Ban, Video, Volume2, Volume1, Download, Upload, Package, MessageCircle, Paperclip,
  NotebookPen, BookOpen, Search, Wrench, HandHeart, TrendingUp, Flame, Hourglass, Eye, Smile, Laugh, Frown, Angry, Annoyed, Meh, Target,
  RefreshCw, ShoppingCart, Plus, Biohazard, Lightbulb, Clapperboard, Tv, Glasses, Rocket, Library, Newspaper, Building2, Pin, Trophy, Megaphone,
  Signal, Wifi, WifiOff, Moon, PartyPopper, ScrollText, Clock, Brain, Bot, Gamepad2, Dog, Bird, Drama, EyeOff, MousePointer2, Dices, Pill,
  Hand, Coins, Brush, Eraser, Type, Square, ShieldUser, Link, CircleHelp, Briefcase, DoorOpen, Power, ArrowLeftRight, Plug, FolderTree,
  SquareTerminal, StickyNote, Scale, PersonStanding, Music, Bug, Cat, Fish, Turtle, Receipt, Heart, PawPrint, Palmtree, GraduationCap,
  Smartphone, ChartBar, FireExtinguisher, Speech, Contact, Coffee, Gem, Siren, Bitcoin, CreditCard, Wallet, Bell, Info, CircleX, Gauge,
  Fingerprint, IdCard, Minus, Maximize2, LayoutGrid, Laptop, Cpu, DollarSign, HandCoins, Waves, Truck, Sparkles, Ghost, Keyboard, Joystick, ArrowRight, Milk, Database,
  CloudRain, Bomb, Stamp, Sticker, Clock5, BellRing, Radio, Antenna, Crown, Swords, Activity, Webcam, ScreenShare, Inbox, Ticket, Tag,
} from 'lucide';
import { el, setTextRenderers } from '../core/util.js';

const ICONS = {
  phone: Phone, 'phone-off': PhoneOff, 'phone-in': PhoneIncoming, 'phone-missed': PhoneMissed, 'phone-call': PhoneCall, mic: Mic, 'mic-off': MicOff,
  headphones: Headphones, headset: Headset, monitor: Monitor, 'monitor-off': MonitorOff, file: FileText, files: Files, flag: Flag, rec: CircleDot,
  money: Banknote, x: X, trash: Trash2, shield: Shield, 'shield-check': ShieldCheck, 'shield-alert': ShieldAlert, star: Star, play: Play, pause: Pause,
  warn: TriangleAlert, folder: Folder, 'folder-open': FolderOpen, palette: Palette, save: Save, image: Image, images: Images, spy: UserSearch,
  bank: Landmark, lock: Lock, unlock: LockOpen, skull: Skull, user: User, users: Users, settings: Settings, zap: Zap, 'zap-off': ZapOff, camera: Camera,
  globe: Globe, disc: Disc, web: Network, gift: Gift, mail: Mail, check: Check, 'check-circle': CircleCheck, key: KeyRound, puzzle: Puzzle, ban: Ban,
  video: Video, volume: Volume2, 'volume-low': Volume1, download: Download, upload: Upload, package: Package, chat: MessageCircle, clip: Paperclip,
  notes: NotebookPen, book: BookOpen, search: Search, wrench: Wrench, please: HandHeart, trend: TrendingUp, flame: Flame, hourglass: Hourglass,
  eye: Eye, smile: Smile, laugh: Laugh, frown: Frown, angry: Angry, annoyed: Annoyed, meh: Meh, target: Target, refresh: RefreshCw, cart: ShoppingCart,
  plus: Plus, biohazard: Biohazard, idea: Lightbulb, film: Clapperboard, tv: Tv, glasses: Glasses, rocket: Rocket, library: Library, news: Newspaper,
  building: Building2, pin: Pin, trophy: Trophy, megaphone: Megaphone, signal: Signal, wifi: Wifi, 'wifi-off': WifiOff, moon: Moon, party: PartyPopper,
  scroll: ScrollText, clock: Clock, brain: Brain, bot: Bot, gamepad: Gamepad2, dog: Dog, bird: Bird, drama: Drama, hidden: EyeOff, mouse: MousePointer2,
  dice: Dices, pill: Pill, wave: Hand, coins: Coins, brush: Brush, eraser: Eraser, type: Type, square: Square, police: ShieldUser, link: Link,
  help: CircleHelp, briefcase: Briefcase, door: DoorOpen, power: Power, swap: ArrowLeftRight, plug: Plug, tree: FolderTree, terminal: SquareTerminal,
  sticky: StickyNote, scale: Scale, run: PersonStanding, music: Music, bug: Bug, cat: Cat, fish: Fish, turtle: Turtle, receipt: Receipt, heart: Heart,
  paw: PawPrint, beach: Palmtree, grad: GraduationCap, selfie: Smartphone, chart: ChartBar, extinguisher: FireExtinguisher, speech: Speech,
  contact: Contact, chai: Coffee, gem: Gem, siren: Siren, bitcoin: Bitcoin, card: CreditCard, wallet: Wallet, bell: Bell, info: Info, 'x-circle': CircleX,
  gauge: Gauge, fingerprint: Fingerprint, id: IdCard, laptop: Laptop, cpu: Cpu, dollar: DollarSign, payout: HandCoins, flood: Waves, truck: Truck,
  sparkles: Sparkles, ghost: Ghost, keyboard: Keyboard, joystick: Joystick, arrow: ArrowRight, cow: Milk, database: Database, rain: CloudRain, bomb: Bomb,
  stamp: Stamp, sticker: Sticker, clock5: Clock5, ring: BellRing, radio: Radio, antenna: Antenna, crown: Crown, swords: Swords, activity: Activity,
  webcam: Webcam, screen: ScreenShare, inbox: Inbox, ticket: Ticket, tag: Tag, minus: Minus, maximize: Maximize2, grid: LayoutGrid,
};

/** Every emoji the game (or its mods) used, mapped to an icon. Unmapped emoji are dropped. */
const EMOJI = {
  '📞': 'phone', '☎': 'phone', '📵': 'phone-missed', '🎙': 'mic', '🎧': 'headphones', '🖥': 'monitor', '💻': 'laptop', '📄': 'file', '📃': 'file',
  '🚩': 'flag', '🔴': 'rec', '⏺': 'rec', '💰': 'money', '💵': 'money', '💸': 'payout', '❌': 'x', '✖': 'x', '🗑': 'trash', '🛡': 'shield',
  '▶': 'play', '⏸': 'pause', '⏹': 'square', '⚠': 'warn', '📁': 'folder', '🗂': 'folder-open', '🎨': 'palette', '🖌': 'brush', '🧽': 'eraser',
  '💾': 'save', '🖼': 'image', '🕵': 'spy', '🏦': 'bank', '🔒': 'lock', '🔓': 'unlock', '💀': 'skull', '☠': 'skull', '🧑': 'user', '🧑‍🎨': 'palette',
  '🧑‍💼': 'briefcase', '⚙': 'settings', '⚡': 'zap', '📷': 'camera', '📸': 'camera', '🌐': 'globe', '🌍': 'globe', '🕸': 'web', '🎁': 'gift',
  '✉': 'mail', '📧': 'mail', '💌': 'mail', '✔': 'check', '✅': 'check-circle', '🟢': 'check-circle', '🔑': 'key', '🧩': 'puzzle', '🚫': 'ban',
  '🎥': 'video', '📺': 'tv', '🔊': 'volume', '🔈': 'volume-low', '📥': 'download', '📤': 'upload', '📦': 'package', '💬': 'chat', '📎': 'clip',
  '📝': 'notes', '🗒': 'sticky', '📘': 'book', '📚': 'library', '📕': 'book', '🔎': 'search', '🔍': 'search', '🛠': 'wrench', '🙏': 'please',
  '📈': 'trend', '📊': 'chart', '🔥': 'flame', '⏳': 'hourglass', '👁': 'eye', '😐': 'meh', '🙂': 'smile', '😊': 'smile', '😁': 'laugh',
  '😂': 'laugh', '🤩': 'sparkles', '😕': 'meh', '🤨': 'annoyed', '😤': 'angry', '😡': 'angry', '😱': 'ghost', '😢': 'frown', '😎': 'glasses',
  '🥸': 'glasses', '🕶': 'glasses', '😈': 'skull', '🎯': 'target', '🔄': 'refresh', '🛒': 'cart', '➕': 'plus', '☣': 'biohazard', '🦠': 'bug',
  '💡': 'idea', '🎬': 'film', '🚀': 'rocket', '📰': 'news', '🏢': 'building', '📌': 'pin', '🏆': 'trophy', '📢': 'megaphone', '📶': 'wifi',
  '📡': 'wifi-off', '🖤': 'monitor-off', '🎉': 'party', '📜': 'scroll', '🕔': 'clock5', '🕘': 'clock', '🧠': 'brain', '🤖': 'bot', '🎮': 'gamepad',
  '👥': 'users', '🐶': 'dog', '🐕': 'dog', '🐦': 'bird', '🦜': 'bird', '🎭': 'drama', '🙈': 'hidden', '🖱': 'mouse', '🎲': 'dice', '🐒': 'paw',
  '💊': 'pill', '👋': 'wave', '🪙': 'coins', '🔤': 'type', '🟥': 'square', '🟡': 'warn', '👮': 'police', '🔗': 'link', '🦖': 'wifi-off',
  '❓': 'help', '🗔': 'square', '💼': 'briefcase', '🚪': 'door', '🔌': 'plug', '⬛': 'terminal', '⚖': 'scale', '🏃': 'run', '🤫': 'hidden',
  '🐟': 'fish', '🐠': 'fish', '🎵': 'music', '🐈': 'cat', '🐢': 'turtle', '🧾': 'receipt', '🐾': 'paw', '🏖': 'beach', '🎓': 'grad',
  '🤳': 'selfie', '🧯': 'extinguisher', '🐄': 'cow', '🗣': 'speech', '📇': 'contact', '☕': 'chai', '🐘': 'gem', '🧑‍🎤': 'mic', '👀': 'eye',
  '🚨': 'siren', '🚓': 'police', '🌧': 'rain', '🌊': 'flood', '💣': 'bomb', '✈': 'rocket', '🏏': 'trophy', '🍵': 'chai', '🐮': 'cow',
  '📱': 'selfie', '💳': 'card', '🏧': 'bank', '⭐': 'star', '❤': 'heart', '🔔': 'bell', '⏰': 'clock', '🕹': 'joystick', '⌨': 'keyboard',
  '🆔': 'id', '🧧': 'gift', '🎫': 'ticket', '🏷': 'tag', '🔥‍': 'flame', '😀': 'smile', '😃': 'smile', '😄': 'laugh', '😅': 'laugh', '🤣': 'laugh',
  '😭': 'frown', '😬': 'meh', '🤔': 'help', '😏': 'smile', '🙄': 'annoyed', '😩': 'frown', '😴': 'moon', '🥳': 'party', '👍': 'check', '👎': 'x',
};

const EMOJI_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|⃣|\p{Emoji_Modifier}|‍(?:\p{Extended_Pictographic}))*️?/gu;

/** Build an icon node. */
export function icon(name, { size = null, cls = '', title = '' } = {}) {
  const node = ICONS[name] || ICONS.square;
  const svg = createElement(node, { width: '1em', height: '1em', 'stroke-width': 2.2, 'aria-hidden': 'true' });
  const span = el(`span.ico${cls ? '.' + cls : ''}`, title ? { title } : {}, svg);
  if (size) span.style.fontSize = typeof size === 'number' ? `${size}px` : size;
  return span;
}

/** Icon as an HTML string (for innerHTML templates). */
export function iconHTML(name, cls = '') {
  return icon(name, { cls }).outerHTML;
}

export const hasIcon = (name) => !!ICONS[name];

/** Icon name for an emoji (or '' if we don't map it). */
export function emojiIcon(e) {
  const base = String(e).replace(/️/g, '');
  return EMOJI[base] || EMOJI[base.split('‍')[0]] || '';
}

/** Remove emoji from text (for TTS, canvas text, etc.). */
export function stripEmoji(text) {
  return String(text ?? '').replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
}

/** Text → array of text nodes + icons (emoji swapped for icons). */
export function richText(text) {
  const s = String(text ?? '');
  if (!s.match(EMOJI_RE)) return [s];
  const out = [];
  let last = 0;
  for (const m of s.matchAll(EMOJI_RE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const name = emojiIcon(m[0]);
    if (name) out.push(icon(name));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  // drop the space a removed emoji leaves at the start
  if (typeof out[0] === 'string') out[0] = out[0].replace(/^\s+/, '');
  return out.filter((n) => n !== '');
}

/** Same, as an HTML string (input must already be safe HTML). */
export function richHTML(html) {
  return String(html ?? '').replace(EMOJI_RE, (m) => {
    const name = emojiIcon(m);
    return name ? iconHTML(name) : '';
  });
}

/** Leading emoji of a label → icon name (e.g. scenario/app icons from mods). */
export function iconFor(value, fallback = 'square') {
  if (!value) return fallback;
  if (ICONS[value]) return value;
  const m = String(value).match(EMOJI_RE);
  return (m && emojiIcon(m[0])) || fallback;
}

/** Paint an icon into a 2D canvas (lucide nodes are 24×24 stroke drawings). */
export function drawIcon(ctx, name, x, y, size, color = '#fff', lineWidth = 2) {
  const node = ICONS[name] || ICONS[emojiIcon(name)] || null;
  if (!node) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [tag, a] of node) {
    const p = new Path2D();
    if (tag === 'path') p.addPath(new Path2D(a.d));
    else if (tag === 'circle') p.arc(+a.cx, +a.cy, +a.r, 0, Math.PI * 2);
    else if (tag === 'ellipse') p.ellipse(+a.cx, +a.cy, +a.rx, +a.ry, 0, 0, Math.PI * 2);
    else if (tag === 'rect') {
      if (p.roundRect) p.roundRect(+a.x, +a.y, +a.width, +a.height, +(a.rx || 0));
      else p.rect(+a.x, +a.y, +a.width, +a.height);
    } else if (tag === 'line') {
      p.moveTo(+a.x1, +a.y1);
      p.lineTo(+a.x2, +a.y2);
    } else if (tag === 'polyline' || tag === 'polygon') {
      const pts = a.points.trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i < pts.length; i += 2) (i ? p.lineTo(pts[i], pts[i + 1]) : p.moveTo(pts[i], pts[i + 1]));
      if (tag === 'polygon') p.closePath();
    }
    ctx.stroke(p);
  }
  ctx.restore();
}

setTextRenderers(richText, richHTML);
