// RemoteHelp: connect to the caller's PC with the ID they read out, then poke around
// their files, bank, email, command prompt... Everything you do on their screen is
// described to the AI caller, who reacts to it.
import { el, setText, money, escapeHtml, pick } from '../../core/util.js';
import { bus } from '../../core/bus.js';
import { sfx } from '../../core/audio.js';
import { Desktop } from './os.js';
import { parseFacts } from '../../game/victimPC.js';
import { addIntel } from './apps.js';
import { icon } from '../icons.js';

export function remoteApp(game, win) {
  const body = el('div', { style: { height: '100%' } });
  const calls = game.calls;
  const renderConnect = (msg = '') => {
    const input = el('input', { placeholder: '123 456 789', maxLength: 11, onkeydown: (e) => (e.stopPropagation(), e.key === 'Enter' && connect()) });
    const status = el('div', { style: { color: '#c62828', minHeight: '18px', fontWeight: 700 } }, msg);
    const connect = () => {
      const code = input.value.replace(/\D/g, '');
      if (game.internetDown) return (setText(status, '📡 No internet connection. Reboot the router!'));
      if (!calls.active) return (status.textContent = 'No session request. You need a caller on the line first.');
      if (!calls.conv.remoteGranted) return (status.textContent = `Partner hasn't installed RemoteHelp. Convince ${calls.caller.firstName} to install it and read you their ID.`);
      if (code !== calls.caller.profile.remoteCode.replace(/\D/g, '')) {
        sfx('error');
        return (status.textContent = 'Invalid partner ID. (Did you mishear them?)');
      }
      sfx('notify');
      calls.remoteConnected = true;
      calls.screenEvent('connected to your computer with RemoteHelp; you can see the mouse moving by itself', { react: true });
      renderSession();
    };
    body.replaceChildren(el('div.remote-connect',
      el('div', { style: { fontSize: '44px' } }, '🖥️↔️🖥️'),
      el('h2', { style: { margin: 0, fontFamily: 'var(--display)', color: '#0a4fd1' } }, 'RemoteHelp™'),
      el('div', { style: { color: '#555' } }, 'Ask the caller to go to remotehelp.co, install it, and read you their 9-digit ID.'),
      input,
      el('button.xp-btn.primary', { onclick: connect, style: { fontSize: '15px', padding: '8px 22px' } }, 'Connect'),
      status,
      el('div', { style: { fontSize: '11px', color: '#888' } }, 'Your ID: 404 555 0123 • "Trusted by 9 out of 10 grandmas"')));
    setTimeout(() => input.focus(), 50);
  };

  const renderSession = () => {
    const pc = calls.pc;
    const caller = calls.caller;
    // Blanking only blacks out THEIR monitor. You keep seeing their desktop (with a
    // badge), and while it's blank they can't see — or react to — what you do.
    const badge = el('div.blank-badge', { style: { display: 'none' } }, icon('monitor-off'), el('span', 'Their screen is BLACK — they can\'t see what you do'));
    const desktop = victimDesktop(game, pc, caller);
    desktop.root.append(badge);
    let blanked = calls.screenBlanked = false;
    const blankBtn = el('button.xp-btn', { onclick: () => {
      blanked = !blanked;
      badge.style.display = blanked ? '' : 'none';
      desktop.root.classList.toggle('blanked', blanked);
      setText(blankBtn, blanked ? 'Unblank their screen' : 'Blank their screen');
      blankBtn.prepend(icon(blanked ? 'monitor' : 'monitor-off'));
      // tell them it went dark BEFORE suppressing screen events
      if (blanked) calls.screenEvent('made your computer screen go completely black so you can\'t see anything', { react: true });
      calls.screenBlanked = blanked;
      if (!blanked) calls.screenEvent('turned your screen back on');
    } }, icon('monitor-off'), 'Blank their screen');
    body.replaceChildren(el('div.remote-view',
      el('div.rbar', el('span.live-dot'), el('b', `${caller.name}'s PC`), el('span', { style: { color: '#999' } }, pc.vm ? '• VirtualBox Guest' : `• ${caller.profile.computer}`), el('span', { style: { flex: 1 } }),
        blankBtn,
        el('button.xp-btn.red', { onclick: () => {
          calls.screenBlanked = false;
          calls.remoteConnected = false;
          calls.screenEvent('disconnected the remote session');
          renderConnect('Disconnected.');
        } }, icon('plug'), 'Disconnect')),
      desktop.root));
  };

  if (calls.active && calls.remoteConnected && calls.pc) renderSession();
  else renderConnect();
  const off = bus.on('call:end', () => body.replaceChildren(el('div.remote-connect', el('div', { style: { fontSize: '40px' } }, '🔌'), el('b', 'Session ended — the call is over.'), el('button.xp-btn', { onclick: () => renderConnect() }, 'OK'))));
  win.onClose = off;
  return body;
}

// ---------------------------------------------------------------------------
function victimDesktop(game, pc, caller) {
  const calls = game.calls;
  const ev = (text, react = false) => calls.screenEvent(text, { react });
  const apps = {
    mycomputer: { name: 'My Files', icon: '🗂️', width: 560, height: 380, render: (w, o) => explorer(o.folder || 'Documents') },
    browser: { name: 'Internet Exploder', icon: '🌍', width: 760, height: 480, render: (w, o) => victimBrowser(o.url || 'bank') },
    cmd: { name: 'Command Prompt', icon: '⬛', width: 600, height: 360, bodyClass: 'dark', render: () => terminal() },
    eventvwr: { name: 'Event Viewer', icon: '⚠️', width: 640, height: 380, render: () => eventViewer() },
    notepad: { name: 'Notepad', icon: '🗒️', width: 460, height: 320, render: () => notepad() },
    recycle: { name: 'Recycle Bin', icon: '🗑️', width: 480, height: 320, render: () => explorer('Recycle Bin') },
  };
  if (pc.baiter) {
    apps.obs = { name: 'OBS Studio', icon: '🔴', width: 520, height: 320, render: () => {
      ev('opened your OBS streaming software, which shows you are LIVE streaming this call to thousands of viewers', true);
      return el('div', { style: { background: '#1d1f22', color: '#ddd', height: '100%', padding: '12px', fontFamily: 'var(--font)' } },
        el('div', { style: { color: '#ff4d4d', fontWeight: 900, fontSize: '20px' } }, '● LIVE  02:14:37'),
        el('div', `Viewers: ${(40000 + Math.floor(Math.random() * 20000)).toLocaleString()}`),
        el('div', { style: { marginTop: '10px' } }, 'Scene: "Granny Cam + Scammer Screen"'),
        el('div', { style: { marginTop: '10px', background: '#000', padding: '8px', fontSize: '12px' } }, 'chat: LMAOOO he believes it 😂 / ask his name again / OPEN THE FILE OPEN THE FILE'));
    } };
    apps.vbox = { name: 'VirtualBox', icon: '📦', width: 420, height: 260, render: () => {
      ev('opened VirtualBox — this whole computer is a virtual machine honeypot');
      return el('div.pad', el('b', 'Oracle VM VirtualBox Manager'), el('p', '🟢 Running: "Granny_Honeypot_v7"'), el('p', '🟢 Running: "Scammer_Trap_Win7"'));
    } };
  }
  const desktop = new Desktop({ theme: 'victim', apps, icons: Object.keys(apps), user: caller.firstName, vm: pc.vm });
  desktop.root.style.background = pc.wallpaper;
  desktop.trayExtra.replaceChildren(...pc.trays.map((t) => el('span', { class: /REC/.test(t) ? 'rec' : '' }, t)));

  function viewFile(f) {
    const w = desktop.open('mycomputer', { key: f.name, title: f.name, width: 520, height: 380 });
    if (!w) return;
    if (f.kind === 'image') {
      w.setBody(el('div.photo', el('div', { style: { textAlign: 'center' } }, f.emoji, el('div', { style: { fontSize: '16px', marginTop: '6px' } }, f.caption, f.fact ? el('div', el('span.fact', { style: { background: '#fff3a1', cursor: 'pointer', fontSize: '13px', padding: '2px 6px' }, onclick: () => grab({ label: f.fact[0], value: f.fact[1] }) }, `📌 Save "${f.fact[1]}" as intel`)) : null))));
      ev(f.event || `opened your photo ${f.name}`, Math.random() < 0.5);
      return;
    }
    if (f.kind === 'exe') {
      if (f.trap) {
        w.close();
        calls.infected(f.name);
        return;
      }
      w.setBody(el('div.pad', '⚙️ Installing FreeSolitaire… also installing 14 toolbars, a crypto miner and "BonziBuddy". Done!'));
      ev(f.event || `ran ${f.name}`, true);
      return;
    }
    const view = el('div.fileview');
    for (const seg of parseFacts(f.content || '')) {
      if (seg.text) view.append(seg.text);
      else view.append(el('span.fact', { title: 'Click to save as intel', onclick: () => grab(seg.fact) }, seg.fact.value));
    }
    w.setBody(el('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      el('div.app-toolbar', el('span', { style: { fontSize: '12px', color: '#555', flex: 1 } }, '💡 Click highlighted details to save them as intel'), el('button.xp-btn', { onclick: () => { w.close(); f.deleted = true; ev(`deleted your file "${f.name}"`, true); } }, '🗑 Delete file')),
      el('div', { style: { flex: 1, overflow: 'auto' } }, view)));
    ev(f.event || `opened your file ${f.name}`, Math.random() < 0.45);
  }

  function grab(fact) {
    if (addIntel(game, fact)) bus.emit('toast', { text: `🕵️ Intel saved: ${fact.label} — ${fact.value}`, ms: 2500 });
  }

  function explorer(start) {
    let folder = start;
    const side = el('div.side');
    const main = el('div.main');
    const render = () => {
      side.replaceChildren(...Object.keys(pc.folders).map((k) => el('div.li', { style: { padding: '8px 10px', cursor: 'pointer', fontWeight: k === folder ? 800 : 400 }, onclick: () => ((folder = k), render(), ev(`is browsing your ${k} folder`)) }, `${k === 'Recycle Bin' ? '🗑️' : '📁'} ${k}`)));
      const files = pc.folders[folder].filter((f) => !f.deleted);
      main.replaceChildren(el('div.list', files.length ? files.map((f) => el('div.li', { onclick: () => viewFile(f) }, el('span', f.icon), el('span', f.name))) : el('div.li', { style: { color: '#888' } }, '(empty)')));
    };
    render();
    return el('div.split', side, main);
  }

  function victimBrowser(startUrl) {
    const page = el('div.page');
    const addr = el('input.addr', { onkeydown: (e) => (e.stopPropagation(), e.key === 'Enter' && go(addr.value)) });
    const bank = pc.bank;
    const go = (url) => {
      url = String(url || '').trim().toLowerCase().replace(/^https?:\/\//, '');
      addr.value = url;
      if (game.internetDown) {
        page.replaceChildren(el('div.pad', '📡 This page can’t be reached (the scammer’s Wi-Fi is down).'));
        return;
      }
      if (url === 'bank' || url.includes(bank.name.toLowerCase().replace(/[^a-z]/g, ''))) return bankPage();
      if (url === 'mail' || url.includes('mail')) return mailPage();
      if (url === 'history') return historyPage();
      const site = (game.run.sites || []).find((s) => url.includes(s.domain.toLowerCase()));
      if (site) {
        page.replaceChildren(renderSite(site));
        ev(`opened a website on your screen: "${site.domain}" titled "${site.title}" which says: ${site.message}`, true);
        return;
      }
      page.replaceChildren(el('div.pad', el('h3', '404'), `Hmm, ${url} doesn't exist. (Build your own fake sites in SiteForge!)`));
    };
    const bankPage = () => {
      addr.value = `secure.${bank.name.toLowerCase().replace(/[^a-z]/g, '')}.com/accounts`;
      let inspect = false;
      const bal = (label, key) => {
        const span = el('span.balance', money(bank[key], { cents: true }));
        span.dataset.key = key;
        span.addEventListener('blur', () => {
          const v = Number(span.textContent.replace(/[^0-9.]/g, ''));
          if (!Number.isFinite(v) || v === bank[key]) return;
          const old = bank[key];
          bank[key] = v;
          span.textContent = money(v, { cents: true });
          ev(`used "Inspect Element" to edit your bank page so your ${label} balance now shows ${money(v)} (it was ${money(old)}) — it looks like ${v > old ? `you received ${money(v - old)} extra` : `you lost ${money(old - v)}`}`, true);
        });
        span.addEventListener('keydown', (e) => (e.stopPropagation(), e.key === 'Enter' && (e.preventDefault(), span.blur())));
        return span;
      };
      const chk = bal('checking', 'checking');
      const sav = bal('savings', 'savings');
      const inspectBtn = el('button.xp-btn', { onclick: () => {
        inspect = !inspect;
        for (const s of [chk, sav]) {
          s.contentEditable = inspect;
          s.classList.toggle('editable', inspect);
        }
        setText(inspectBtn, inspect ? '✅ Done editing' : '🛠 Inspect Element (F12)');
        if (inspect) bus.emit('toast', { text: '🛠 Inspect mode: click a balance, type a new number, press Enter. The caller sees the change.' });
        else ev('closed the weird code window on your bank page');
      } }, '🛠 Inspect Element (F12)');
      const to = el('input', { value: 'GLOBAL SOL. ACCT 8841-2210', style: { width: '220px' } });
      const amt = el('input', { type: 'number', value: 500, style: { width: '100px' } });
      page.replaceChildren(el('div.site',
        el('header', { style: { background: '#0b3d91' } }, el('span', { style: { fontSize: '28px' } }, '🏦'), el('h1', bank.name), el('span', { style: { flex: 1 } }), inspectBtn),
        el('div.body',
          el('p', `Welcome back, ${bank.holder}`),
          el('div.card', el('div', `Checking ••••${bank.last4}`), chk),
          el('div.card', el('div', 'Savings'), sav),
          el('div.card', el('b', 'Recent transactions'), el('table', bank.tx.map(([d, n, a]) => el('tr', el('td', d), el('td', n), el('td', { style: { color: a < 0 ? '#c62828' : '#137a43' } }, money(a, { cents: true })))))),
          el('div.card', el('b', '💸 Transfer money'), el('div.row', { style: { marginTop: '6px' } }, 'To:', to, 'Amount: $', amt, el('button.xp-btn.primary', { onclick: () => {
            ev(`filled in a bank transfer on your screen: ${money(Number(amt.value))} from your account to "${to.value}". It's waiting for YOU to confirm it`, true);
            bus.emit('toast', { text: '🏦 Transfer drafted. Now convince them to approve it (they decide on the phone).' });
          } }, 'Send')))),
      ));
      ev('opened your online banking and can see your account balances', Math.random() < 0.6);
    };
    const mailPage = () => {
      addr.value = 'webmail.aol.com/inbox';
      const view = el('div.pad');
      page.replaceChildren(el('div.site', el('header', { style: { background: '#3b2a8f' } }, el('h1', '✉️ Webmail')), el('div.split', { style: { height: 'auto' } },
        el('div.side', { style: { width: '260px' } }, el('div.list', pc.email.map((m) => el('div.li', { onclick: () => {
          view.replaceChildren(el('b', m.subject), el('div', { style: { fontSize: '12px', color: '#777' } }, `From: ${m.from}`), el('p', m.body));
          ev(`opened your email "${m.subject}"`);
        } }, el('div', el('b', { style: { fontSize: '12px' } }, m.from), el('div', { style: { fontSize: '12px' } }, m.subject)))))),
        el('div.main', view))));
      ev('opened your email inbox and is reading your emails', true);
    };
    const historyPage = () => {
      addr.value = 'about:history';
      page.replaceChildren(el('div.pad', el('h3', 'History'), el('ul', pc.history.map((h) => el('li', h)))));
      ev('is looking through your browser history', true);
    };
    const root = el('div.browser',
      el('div.app-toolbar', el('button.xp-btn', { onclick: () => go('bank') }, '🏦 Bank'), el('button.xp-btn', { onclick: () => go('mail') }, '✉️ Email'), el('button.xp-btn', { onclick: () => go('history') }, '🕘 History'), addr, el('button.xp-btn', { onclick: () => go(addr.value) }, 'Go')),
      page);
    setTimeout(() => go(startUrl), 0);
    return root;
  }

  function terminal() {
    const out = el('div');
    const input = el('input', { spellcheck: false });
    const term = el('div.terminal', out, el('div', { style: { display: 'flex' } }, el('span', 'C:\\Users\\' + caller.firstName + '>'), input));
    const print = (t, color) => {
      const line = el('div', t);
      if (color) line.style.color = color;
      out.append(line);
      term.scrollTop = term.scrollHeight;
    };
    print(`Windoze XD [Version 5.1.2600]\n(C) Copyright 1985-2001 Macrohard Corp.\nType "help" for commands.\n`);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const raw = input.value.trim();
      input.value = '';
      print(`C:\\Users\\${caller.firstName}>${raw}`);
      run(raw);
    });
    term.addEventListener('mousedown', () => setTimeout(() => input.focus(), 0));
    setTimeout(() => input.focus(), 50);
    const run = (raw) => {
      const [cmd, ...rest] = raw.split(' ');
      const arg = rest.join(' ');
      switch (cmd.toLowerCase()) {
        case '':
          return;
        case 'help':
          return print('dir  tree  netstat  ipconfig  systeminfo  echo <text>  color a  cls  shutdown  hack');
        case 'dir':
          return print(Object.values(pc.folders).flat().map((f) => `  ${f.name}`).join('\n'));
        case 'tree': {
          ev('ran a command that makes thousands of lines of scary-looking text scroll by in a black window (it is the "tree" command, harmless, but looks like hacking)', true);
          let i = 0;
          const dirs = ['System32', 'drivers', 'etc', 'Temp', 'Prefetch', 'WinSxS', 'x86_microsoft-windoze', 'Fonts', 'INF', 'Logs', 'CatRoot'];
          const t = setInterval(() => {
            for (let k = 0; k < 12; k++) print(`│   ${'│   '.repeat(i % 5)}├───${pick(dirs)}_${(Math.random() * 1e6) | 0}`);
            if (++i > 18) {
              clearInterval(t);
              print('\nScan complete. 1,337 suspicious folders found.', '#ff5555');
            }
          }, 60);
          return;
        }
        case 'netstat':
          ev('ran "netstat" showing a list of active "foreign" network connections, and claims these are hackers inside your computer right now', true);
          print('Active Connections\n\n  Proto  Local Address        Foreign Address         State');
          ['RUSSIA', 'NORTH KOREA', 'NIGERIA', 'UNKNOWN', 'HACKER', 'ANTARCTICA'].forEach((c) => print(`  TCP    192.168.1.${(Math.random() * 200) | 0}:${49152 + ((Math.random() * 999) | 0)}   ${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}:443   ESTABLISHED  [${c}]`, '#ff7777'));
          return;
        case 'ipconfig':
          return print('IPv4 Address. . . : 192.168.1.4\nSubnet Mask . . . : 255.255.255.0\nDefault Gateway . : 192.168.1.1\nHacker Detected . : YES (trust me)');
        case 'systeminfo':
          return print(`OS Name: Windoze XD Home\nSystem Model: ${caller.profile.computer}\nRegistered Owner: ${caller.profile.fullName}\nRAM: 2 GB (sad)`);
        case 'echo':
          ev(`typed a message into your black command window that says: "${arg}"`, true);
          return print(arg, '#ffff55');
        case 'color':
          term.style.color = '#33ff66';
          return ev('turned your command window text bright green like in hacker movies');
        case 'cls':
          return out.replaceChildren();
        case 'shutdown':
          ev('tried to shut down your computer', true);
          return print('Shutdown aborted: "But the hackers!!" — Windoze', '#ff5555');
        case 'hack':
          ev('typed "hack" into the command window. Nothing happened. It looked very unprofessional', true);
          return print("'hack' is not recognized as an internal or external command. Nice try.");
        default:
          return print(`'${escapeHtml(cmd)}' is not recognized as an internal or external command.`);
      }
    };
    return term;
  }

  function eventViewer() {
    ev('opened Event Viewer, which shows HUNDREDS of red ERROR and yellow WARNING entries (they are normal, but look terrifying)', true);
    const rows = Array.from({ length: 60 }, (_, i) => {
      const err = Math.random() < 0.7;
      return el('tr', el('td', err ? '🔴 Error' : '🟡 Warning'), el('td', `${(i % 12) + 1}:${String((i * 7) % 60).padStart(2, '0')} PM`), el('td', pick(['DCOM', 'Service Control Manager', 'Disk', 'HACKER.exe', 'Kernel-Power', 'VirusDetected', 'Application Error'])), el('td', 1000 + ((Math.random() * 9000) | 0)));
    });
    return el('div', el('div.app-toolbar', el('b', 'Event Viewer (Local) — System'), el('span', { style: { color: '#c62828' } }, ` ${rows.length} errors`)), el('table.eventviewer', { style: { width: '100%', borderCollapse: 'collapse' } }, rows));
  }

  function notepad() {
    const ta = el('textarea', { style: { width: '100%', height: 'calc(100% - 40px)', border: '0', resize: 'none', fontFamily: 'Courier New, monospace', fontSize: '15px' }, value: 'YOUR COMPUTER HAS BEEN HACKED.\nDO NOT HANG UP THE PHONE.', onkeydown: (e) => e.stopPropagation() });
    return el('div', { style: { height: '100%' } }, el('div.app-toolbar', el('button.xp-btn.primary', { onclick: () => ev(`typed a message in Notepad on your screen that says: "${ta.value.replace(/\s+/g, ' ').slice(0, 200)}"`, true) }, '📢 Make sure they read it')), ta);
  }

  return desktop;
}

export function renderSite(site) {
  const c = site.color || '#0a4fd1';
  const T = {
    bank: () => [el('div.card', el('b', '🔒 Secure Login'), el('div', el('input', { placeholder: 'Username' })), el('div', { style: { marginTop: '6px' } }, el('input', { placeholder: 'Password', type: 'password' })), el('button', { style: { marginTop: '8px', background: c, color: '#fff', border: 0, padding: '6px 14px' } }, 'Sign in'))],
    support: () => [el('div.card', el('b', '🟢 Certified Technician Online'), el('p', 'Ticket #' + ((Math.random() * 99999) | 0)), el('div', '★★★★★ "They fixed my computer AND my marriage" — Linda'))],
    government: () => [el('div.card', el('b', '⚖️ Outstanding Balance Notice'), el('p', 'Case No. ' + ((Math.random() * 999999) | 0)), el('div', { style: { color: '#c62828', fontWeight: 900 } }, 'PAY IMMEDIATELY TO AVOID ARREST'))],
    crypto: () => [el('div.card', el('b', '📈 Portfolio'), el('div', { style: { fontSize: '30px', fontWeight: 900, color: '#137a43' } }, '+4,207%'), el('div', 'Balance: 13.37 BTC ($' + ((Math.random() * 900000) | 0).toLocaleString() + ')'))],
    lottery: () => [el('div.card', el('div', { style: { fontSize: '40px' } }, '🎉🏆🎉'), el('b', 'CONGRATULATIONS WINNER!'), el('p', 'Claim code: WIN-' + ((Math.random() * 99999) | 0)))],
  };
  return el('div.site', el('header', { style: { background: c } }, el('span', { style: { fontSize: '30px' } }, site.logo || '🌐'), el('h1', site.title)), el('div.body', el('p', { style: { fontSize: '15px' } }, site.message), ...(T[site.template]?.() || []), el('div', { style: { fontSize: '11px', color: '#999', marginTop: '20px' } }, `© ${new Date().getFullYear()} ${site.domain} • 100% Legit • SSL Certified™`)));
}
