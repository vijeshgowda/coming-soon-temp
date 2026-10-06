/* Shared sample content and helpers for variations 13 to 15 (see docs/shared-content.md). */
(function () {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
  };

  const posts = [
    { slug: 'planning-this-site', title: 'Planning this site', cat: 'Notes', date: '2026-10-05', read: 4,
      excerpt: 'Choosing a stack that stays free, stays online and grows into a forum.',
      body: [
        ['p', 'I want a personal site that stays free, stays online and can grow into a forum. That rules out most of the usual hosting choices.'],
        ['h', 'What I looked at'],
        ['p', 'Free tiers have shrunk. Several platforms now put idle apps to sleep, expire after a few months or have no free plan at all. Static hosting with a serverless backend is the option that survives.'],
        ['h', 'What I picked'],
        ['p', 'A cream and ink design, Cloudflare for hosting, Supabase for accounts and data, and a forum I build myself so it matches the rest of the site.'],
        ['q', 'Free is only free until the terms change, so keep everything portable.'],
        ['p', 'Next up is writing here, one post at a time.']
      ] },
    { slug: 'enforcing-access-in-two-places', title: 'Enforcing access in two places', cat: 'Engineering', date: '2026-09-28', read: 5,
      excerpt: 'Why gateway rules alone are not enough, and what each layer should check.',
      body: [
        ['p', 'A gateway can check who is calling and which route they may use. It cannot know whether this user may edit that record.'],
        ['h', 'Coarse at the edge'],
        ['p', 'Put route-level rules at the gateway: signed in or not, which role, which API product. These checks are cheap, uniform and easy to audit.'],
        ['h', 'Fine inside the service'],
        ['p', 'Each service checks the record-level rule, because only it has the data. Never assume the gateway already did.'],
        ['q', 'Two checks cost a few milliseconds. One missing check costs an incident.'],
        ['p', 'The trade-off is duplication. Keep the rules in a shared library and test them once.']
      ] },
    { slug: 'quality-per-gb', title: 'Quality per GB', cat: 'Local AI', date: '2026-09-20', read: 6,
      excerpt: 'Comparing low-bit models fairly across sizes.',
      body: [
        ['p', 'Bigger models score higher, but they also need more memory. Comparing a 27B model with a 4B model on accuracy alone ignores that cost.'],
        ['h', 'A simple measure'],
        ['p', 'Divide a quality score by the size of the model in GB. One published approach takes the negative log of the error rate and divides that by model size, so a small model that keeps most of its quality wins.'],
        ['h', 'How I will test it'],
        ['p', 'Fix a task set, build the same model at several bit widths and plot the result. The memory calculator on the About page covers the size side.'],
        ['q', 'Fix the task set first, then vary one thing.']
      ] },
    { slug: 'saltbound-combat', title: 'Saltbound dev log: getting combat to feel right', cat: 'Games', date: '2026-09-12', read: 3,
      excerpt: 'Three small changes that made hits feel heavy.',
      body: [
        ['p', 'Combat in a top-down game lives or dies on feedback. This week I worked on three small things.'],
        ['h', 'Three changes'],
        ['p', 'A brief hit pause when a strike lands, a short screen shake scaled to the damage, and a slightly tighter dodge window so a good dodge feels earned.'],
        ['p', 'Each change is tiny on its own. Together they make hits feel heavy.'],
        ['q', 'If the player cannot read the attack, the fight is not fair.'],
        ['p', 'Next: enemy telegraphs, so players can read an attack before it lands.']
      ] }
  ];

  const categories = ['Announcements', 'Engineering', 'Local AI', 'Games', 'Off-topic'];
  const roles = { vije: 'admin', tomas: 'moderator', nora: 'member', ravi: 'member', mei: 'member', you: 'guest' };

  const baseThreads = [
    { id: 't1', title: 'Welcome, read this first', cat: 'Announcements', pinned: true, posts: [
      ['vije', '3d ago', 'Welcome. This is a place to talk about systems, small models and games. Be kind, be specific, and say what you tried.'],
      ['nora', '2d ago', 'Glad this exists. Will there be a category for hardware projects?'],
      ['vije', '2d ago', 'Good idea. I will add one this week.']] },
    { id: 't2', title: 'How are you comparing 4-bit and ternary builds?', cat: 'Local AI', posts: [
      ['ravi', '1d ago', 'I want a fair way to compare builds of different sizes. Raw accuracy hides the memory cost.'],
      ['mei', '1d ago', 'Quality per GB is a decent start. Fix the task set first, then vary only the bit width.'],
      ['vije', '20h ago', 'Agreed. I will post my harness once it runs end to end.']] },
    { id: 't3', title: 'Service mesh sidecars or ambient mode for a small cluster?', cat: 'Engineering', posts: [
      ['mei', '2d ago', 'Three services, one team. Is the extra moving part worth it yet?'],
      ['tomas', '1d ago', 'For three services I would start without a mesh and add mutual TLS at the edge first.']] },
    { id: 't4', title: 'Saltbound dev log: getting combat to feel right', cat: 'Games', posts: [
      ['vije', '4d ago', 'This week: hit pause, a short screen shake and a tighter dodge window. Feedback welcome.']] },
    { id: 't5', title: 'What are you reading this month?', cat: 'Off-topic', posts: [
      ['nora', '5d ago', 'Looking for something about distributed systems that is not a textbook.']] }
  ];

  /* Forum state: sample threads plus whatever this browser added (stored per variation). */
  function forum(key) {
    const extra = store.get(key, { threads: [], replies: {} });
    if (!extra.threads || !extra.replies) { extra.threads = []; extra.replies = {}; }
    const build = () => baseThreads.map(t => ({ ...t, posts: t.posts.concat(extra.replies[t.id] || []) }))
      .concat(extra.threads.map(t => ({ ...t, mine: true, posts: t.posts.concat(extra.replies[t.id] || []) })))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return {
      list: build,
      get: id => build().find(t => t.id === id),
      reply(id, text, who = 'you') {
        (extra.replies[id] = extra.replies[id] || []).push([who, 'just now', text]);
        store.set(key, extra);
      },
      create(title, cat, text, who = 'you') {
        const id = 'u' + Date.now().toString(36);
        extra.threads.unshift({ id, title, cat, posts: [[who, 'just now', text]] });
        store.set(key, extra);
        return id;
      },
      reset() { extra.threads = []; extra.replies = {}; store.set(key, extra); }
    };
  }

  const bits = [16, 8, 4, 2, 1.58, 1];
  const lab = (params, b) => {
    const gb = params * b / 8, full = params * 2;
    return { gb, full, ratio: full / gb,
      note: b === 16 ? 'This is the standard 16-bit size.' : `Standard 16-bit would be ${full.toFixed(0)} GB, about ${(full / gb).toFixed(1)}× larger.` };
  };

  const fmtDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', opts);

  /* Small seeded PRNG (mulberry32) and a string hash so generated art is stable per post. */
  const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  const RM = matchMedia('(prefers-reduced-motion: reduce)');

  window.VIJE = {
    esc, store, posts, categories, roles, forum, bits, lab, fmtDate, hash, rng, RM,
    identity: {
      name: 'Vijesh', tagline: 'Backend systems, quiet interfaces.',
      bio: 'Software engineer focused on distributed backend systems, security and developer tooling on GCP, with a growing interest in small, efficient AI models. This is where I keep what I\'m building and thinking about.',
      stats: ['8 yrs', 'MSc ML & AI', 'Node.js', 'React', 'GCP', 'Istio', 'Godot']
    },
    outside: [
      ['Game design', 'Saltbound, a 2D top-down pirate action RPG I\'m building in Godot.'],
      ['Hardware', 'A local wake-word detector on an ESP32-C3 that triggers an Echo Dot.'],
      ['Local AI', 'Running small, heavily compressed models on my own machine and measuring what they can do.'],
      ['PC gaming', 'Tuning a gaming rig and weighing the next GPU upgrade.']
    ],
    work: [
      ['GKE', 'platform', 'Microservice platform on GCP', 'Many services needing consistent traffic, security and messaging. Istio/Envoy mesh, Pub/Sub for async work, Spanner and GCS for data, Apigee as the gateway layer.'],
      ['SSO', 'identity', 'Sign-in and role-based access', 'Microsoft Entra ID with MSAL.js and PKCE, with access rules enforced twice: at the gateway and inside the Node.js services.'],
      ['ETL', 'batch', 'File-processing pipeline', 'A Node.js batch pipeline on GKE that picks up TIF and log files from GCS via Pub/Sub and processes them.'],
      ['DEV', 'tooling', 'Developer tooling package', 'An npm package built on GitHub Copilot Enterprise APIs to give teams shared developer tooling.'],
      ['P2P', 'open src', 'Omni', 'An open-source peer-to-peer app for encrypted file sharing and chat.']
    ],
    career: [
      ['2023', 'now', 'Senior Software Engineer', 'Meridian Systems', 'Own the service platform and API gateway layer used by every product team. Led the move to two-layer access control.'],
      ['2020', '2023', 'Software Engineer', 'Harbor Labs', 'Built event-driven pipelines on Pub/Sub that process large file batches. Shipped shared developer tooling.'],
      ['2018', '2020', 'Software Engineer', 'Kite Analytics', 'Full-stack React and Node.js features, including ML-powered recommendations.'],
      ['2017', '2018', 'MSc, Advanced Computer Science', 'University', 'Specialised in machine learning and AI.']
    ]
  };
})();
