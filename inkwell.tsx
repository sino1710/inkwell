import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://bohusdrjecedpoytaksv.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvaHVzZHJqZWNlZHBveXRha3N2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzA4MzEsImV4cCI6MjA5ODMwNjgzMX0.hEMxIBy1c248_0qQNa6Ef2ArKj-B_iIPtQNWmKFEyn8";

const sb = async (path, options = {}, token = null) => {
  const headers = {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${token || SUPABASE_ANON}`,
    "Content-Type": "application/json",
    ...(options.body ? { Prefer: "return=representation" } : {}),
    ...options.headers,
  };
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  if (res.status === 204 || res.status === 205) return null;
  return res.json();
};

const GENRES = ["All", "Mystery", "Slice of Life", "Sci-Fi", "Fantasy", "Romance", "Horror"];

export default function App() {
  const [view, setView] = useState("feed");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [notification, setNotification] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "" });
  const [authError, setAuthError] = useState("");
  const [publishStep, setPublishStep] = useState(1);
  const [publishForm, setPublishForm] = useState({ title: "", genre: "Mystery", body: "" });

  const showNotif = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const loadStories = useCallback(async () => {
    const data = await sb("/rest/v1/stories?select=*,reactions(emoji,user_id)&order=created_at.desc");
    if (Array.isArray(data)) setStories(data);
  }, []);

  const loadProfile = async (userId, token) => {
    const data = await sb(`/rest/v1/profiles?id=eq.${userId}&select=*`, {}, token);
    if (Array.isArray(data) && data.length > 0) setProfile(data[0]);
  };

  // Check for existing session on load
  useEffect(() => {
    const stored = localStorage.getItem("inkwell_session");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSession(parsed);
        loadProfile(parsed.user.id, parsed.access_token).finally(() => setPageLoading(false));
      } catch { setPageLoading(false); }
    } else { setPageLoading(false); }
    loadStories();
  }, [loadStories]);

  const freeStoriesLeft = () => {
    if (!profile) return 0;
    if (profile.is_premium) return Math.max(0, 4 - profile.stories_posted);
    return profile.stories_posted === 0 ? 1 : 0;
  };
  const mustPay = () => freeStoriesLeft() === 0;

  const handleSignup = async () => {
    setAuthError("");
    if (!authForm.name.trim() || !authForm.email.trim() || !authForm.password.trim()) {
      setAuthError("Please fill in all fields."); return;
    }
    if (authForm.password.length < 6) { setAuthError("Password must be at least 6 characters."); return; }
    setLoading(true);
    const data = await sb("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({ email: authForm.email, password: authForm.password, data: { name: authForm.name } }),
    });
    if (data?.error) { setAuthError(data.error.message); setLoading(false); return; }
    if (!data?.access_token) {
      setAuthError("Check your email to confirm your account, then log in."); setLoading(false); return;
    }
    const token = data.access_token;
    const userId = data.user?.id;
    await sb("/rest/v1/profiles", {
      method: "POST",
      body: JSON.stringify({ id: userId, name: authForm.name, is_premium: false, stories_posted: 0 }),
    }, token);
    const sess = { access_token: token, user: data.user };
    setSession(sess);
    localStorage.setItem("inkwell_session", JSON.stringify(sess));
    await loadProfile(userId, token);
    setAuthForm({ email: "", password: "", name: "" });
    setView("feed");
    showNotif(`Welcome to Inkwell, ${authForm.name}!`);
    setLoading(false);
  };

  const handleLogin = async () => {
    setAuthError("");
    setLoading(true);
    const data = await sb("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: authForm.email, password: authForm.password }),
    });
    if (data?.error) { setAuthError(data.error.message); setLoading(false); return; }
    const token = data.access_token;
    const userId = data.user?.id;
    const sess = { access_token: token, user: data.user };
    setSession(sess);
    localStorage.setItem("inkwell_session", JSON.stringify(sess));
    await loadProfile(userId, token);
    setAuthForm({ email: "", password: "", name: "" });
    setView("feed");
    showNotif("Welcome back!");
    setLoading(false);
  };

  const handleLogout = async () => {
    if (session) await sb("/auth/v1/logout", { method: "POST" }, session.access_token);
    setSession(null);
    setProfile(null);
    localStorage.removeItem("inkwell_session");
    setView("feed");
    showNotif("You've been logged out.");
  };

  const handleUpgradeToPremium = async () => {
    if (!session || !profile) return;
    setLoading(true);
    await sb(`/rest/v1/profiles?id=eq.${profile.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_premium: true }),
    }, session.access_token);
    setProfile((p) => ({ ...p, is_premium: true }));
    setView("feed");
    showNotif("✦ Welcome to Premium!");
    setLoading(false);
  };

  const handlePublish = async () => {
    if (!publishForm.title.trim() || !publishForm.body.trim()) { showNotif("Please fill in all fields."); return; }
    setLoading(true);
    const preview = publishForm.body.slice(0, 120) + "...";
    await sb("/rest/v1/stories", {
      method: "POST",
      body: JSON.stringify({
        author_id: profile.id,
        author_name: profile.name,
        is_author_premium: profile.is_premium,
        title: publishForm.title,
        genre: publishForm.genre,
        preview,
        body: publishForm.body,
      }),
    }, session.access_token);
    const newCount = profile.stories_posted + 1;
    await sb(`/rest/v1/profiles?id=eq.${profile.id}`, {
      method: "PATCH",
      body: JSON.stringify({ stories_posted: newCount }),
    }, session.access_token);
    setProfile((p) => ({ ...p, stories_posted: newCount }));
    setPublishForm({ title: "", genre: "Mystery", body: "" });
    setPublishStep(1);
    await loadStories();
    setView("feed");
    showNotif("✦ Your story has been published!");
    setLoading(false);
  };

  const handleReact = async (storyId, emoji) => {
    if (!session) { setView("auth"); return; }
    const story = stories.find((s) => s.id === storyId);
    if (story?.reactions?.some((r) => r.user_id === session.user.id && r.emoji === emoji)) return;
    const newReaction = { emoji, user_id: session.user.id };
    setStories((prev) => prev.map((s) => s.id === storyId ? { ...s, reactions: [...(s.reactions || []), newReaction] } : s));
    if (activeStory?.id === storyId) setActiveStory((p) => ({ ...p, reactions: [...(p.reactions || []), newReaction] }));
    await sb("/rest/v1/reactions", {
      method: "POST",
      body: JSON.stringify({ story_id: storyId, user_id: session.user.id, emoji }),
    }, session.access_token);
  };

  const reactionCounts = (reactions = []) =>
    reactions.reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, { "❤️": 0, "😮": 0, "😂": 0 });

  const hasReacted = (reactions = [], emoji) =>
    session ? reactions.some((r) => r.user_id === session.user.id && r.emoji === emoji) : false;

  const filtered = filter === "All" ? stories : stories.filter((s) => s.genre === filter);

  if (pageLoading) return (
    <div style={{ ...s.root, justifyContent: "center", alignItems: "center" }}>
      <div style={s.spinner}>✦</div>
    </div>
  );

  // ── AUTH ──
  if (view === "auth") return (
    <div style={s.root}>
      <nav style={s.nav}><span style={s.logo} onClick={() => setView("feed")}>✦ Inkwell</span></nav>
      <main style={s.main}>
        <div style={s.modal}>
          <div style={s.authTabs}>
            <button style={{ ...s.authTab, ...(authMode === "login" ? s.authTabActive : {}) }} onClick={() => { setAuthMode("login"); setAuthError(""); }}>Log In</button>
            <button style={{ ...s.authTab, ...(authMode === "signup" ? s.authTabActive : {}) }} onClick={() => { setAuthMode("signup"); setAuthError(""); }}>Sign Up</button>
          </div>
          {authMode === "signup" && (
            <div style={s.formGroup}>
              <label style={s.label}>Your name</label>
              <input style={s.input} placeholder="Jane Doe" value={authForm.name} onChange={(e) => setAuthForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
          )}
          <div style={s.formGroup}>
            <label style={s.label}>Email</label>
            <input style={s.input} placeholder="you@example.com" value={authForm.email} onChange={(e) => setAuthForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Password</label>
            <input style={s.input} type="password" placeholder="••••••••" value={authForm.password} onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))} />
          </div>
          {authError && <p style={s.authError}>{authError}</p>}
          <button style={{ ...s.publishBtn2, opacity: loading ? 0.6 : 1 }} onClick={authMode === "login" ? handleLogin : handleSignup} disabled={loading}>
            {loading ? "Please wait..." : authMode === "login" ? "Log In" : "Create Account"}
          </button>
          <p style={{ color: "#A7A9BE", fontSize: 13, textAlign: "center", marginTop: 16, cursor: "pointer" }} onClick={() => setView("feed")}>
            Continue reading without an account →
          </p>
        </div>
      </main>
    </div>
  );

  return (
    <div style={s.root}>
      {notification && <div style={s.notif}>{notification}</div>}

      {/* NAV */}
      <nav style={s.nav}>
        <span style={s.logo} onClick={() => setView("feed")}>✦ Inkwell</span>
        <div style={s.navRight}>
          {session ? (
            <>
              {profile?.is_premium && <span style={s.premBadge}>✦ Premium</span>}
              {!profile?.is_premium && <button style={s.navBtn} onClick={() => setView("premium")}>Go Premium — $1/mo</button>}
              <span style={s.navUser}>{profile?.name}</span>
              <button style={s.navBtnGhost} onClick={handleLogout}>Log out</button>
              <button style={s.publishBtn} onClick={() => { setPublishStep(1); setView("publish"); }}>+ Post a Story</button>
            </>
          ) : (
            <>
              <button style={s.navBtn} onClick={() => { setAuthMode("login"); setView("auth"); }}>Log In</button>
              <button style={s.publishBtn} onClick={() => { setAuthMode("signup"); setView("auth"); }}>Sign Up</button>
            </>
          )}
        </div>
      </nav>

      {/* FEED */}
      {view === "feed" && (
        <main style={s.main}>
          <div style={s.hero}>
            <h1 style={s.heroTitle}>Stories worth reading.</h1>
            <p style={s.heroSub}>Real stories from real people. Read free. Publish for 50¢.</p>
          </div>
          <div style={s.filterRow}>
            {GENRES.map((g) => (
              <button key={g} style={{ ...s.genreBtn, ...(filter === g ? s.genreBtnActive : {}) }} onClick={() => setFilter(g)}>{g}</button>
            ))}
          </div>
          {loading && <p style={{ color: "#A7A9BE", textAlign: "center" }}>Loading stories...</p>}
          {!loading && filtered.length === 0 && (
            <div style={s.emptyState}>
              <p style={{ fontSize: 40 }}>✦</p>
              <p style={{ fontSize: 20, fontWeight: 700, margin: "8px 0" }}>No stories yet</p>
              <p style={{ color: "#A7A9BE", marginBottom: 20 }}>Be the first to publish!</p>
              <button style={s.publishBtn} onClick={() => session ? setView("publish") : setView("auth")}>Post the First Story</button>
            </div>
          )}
          <div style={s.grid}>
            {filtered.map((story) => {
              const counts = reactionCounts(story.reactions);
              return (
                <div key={story.id} style={s.card} onClick={() => { setActiveStory(story); setView("read"); }}>
                  <div style={s.cardTop}>
                    <span style={s.genreTag}>{story.genre}</span>
                  </div>
                  <h2 style={s.cardTitle}>{story.title}</h2>
                  <p style={s.cardPreview}>{story.preview}</p>
                  <div style={s.cardFooter}>
                    <span style={s.authorName}>{story.author_name}{story.is_author_premium && <span style={s.badge}> ✦</span>}</span>
                    <div style={s.reactionRow}>
                      {Object.entries(counts).map(([emoji, count]) => (
                        <span key={emoji} style={s.reactionBubble} onClick={(e) => { e.stopPropagation(); handleReact(story.id, emoji); }}>{emoji} {count}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* READER */}
      {view === "read" && activeStory && (
        <main style={s.main}>
          <button style={s.backBtn} onClick={() => setView("feed")}>← Back to Feed</button>
          <article style={s.article}>
            <span style={s.genreTag}>{activeStory.genre}</span>
            <h1 style={s.articleTitle}>{activeStory.title}</h1>
            <div style={s.articleMeta}>
              <span>{activeStory.author_name}{activeStory.is_author_premium && <span style={s.badge}> ✦</span>}</span>
            </div>
            <div style={s.divider} />
            <div style={s.articleBody}>
              {activeStory.body.split("\n\n").map((para, i) => <p key={i} style={s.para}>{para}</p>)}
            </div>
            <div style={s.divider} />
            <div style={s.reactionSection}>
              <p style={s.reactionLabel}>How did this make you feel?</p>
              <div style={s.reactionBig}>
                {Object.entries(reactionCounts(activeStory.reactions)).map(([emoji, count]) => (
                  <button key={emoji}
                    style={{ ...s.reactionBigBtn, ...(hasReacted(activeStory.reactions, emoji) ? s.reactionActive : {}) }}
                    onClick={() => handleReact(activeStory.id, emoji)}>
                    <span style={{ fontSize: 28 }}>{emoji}</span>
                    <span style={s.reactionCount}>{count}</span>
                  </button>
                ))}
              </div>
              {!session && <p style={{ color: "#A7A9BE", fontSize: 13, marginTop: 12 }}>
                <span style={{ color: "#E8C547", cursor: "pointer" }} onClick={() => setView("auth")}>Log in</span> to react.
              </p>}
            </div>
          </article>
        </main>
      )}

      {/* PUBLISH */}
      {view === "publish" && (
        <main style={s.main}>
          <button style={s.backBtn} onClick={() => setView("feed")}>← Cancel</button>
          <div style={s.modal}>
            {profile && (
              <div style={s.slotBanner}>
                {profile.is_premium
                  ? `✦ Premium: ${freeStoriesLeft()} of 4 free slots remaining this month.`
                  : profile.stories_posted === 0
                  ? "🎉 Your first story is free!"
                  : "Your free story has been used. This post costs $0.50."}
              </div>
            )}
            {publishStep === 1 && (
              <>
                <h2 style={s.modalTitle}>Post Your Story</h2>
                <p style={s.modalSub}>Share your story with the Inkwell community.</p>
                <div style={s.formGroup}>
                  <label style={s.label}>Title</label>
                  <input style={s.input} placeholder="Give your story a title..." value={publishForm.title} onChange={(e) => setPublishForm((p) => ({ ...p, title: e.target.value }))} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Genre</label>
                  <select style={s.input} value={publishForm.genre} onChange={(e) => setPublishForm((p) => ({ ...p, genre: e.target.value }))}>
                    {GENRES.filter((g) => g !== "All").map((g) => <option key={g}>{g}</option>)}
                  </select>
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Your Story</label>
                  <textarea style={{ ...s.input, height: 200, resize: "vertical" }} placeholder="Write your story here..." value={publishForm.body} onChange={(e) => setPublishForm((p) => ({ ...p, body: e.target.value }))} />
                </div>
                <button style={s.publishBtn2} onClick={() => {
                  if (!publishForm.title.trim() || !publishForm.body.trim()) { showNotif("Please fill in all fields."); return; }
                  mustPay() ? setPublishStep(2) : handlePublish();
                }} disabled={loading}>
                  {loading ? "Publishing..." : mustPay() ? "Continue to Payment →" : "Publish for Free ✦"}
                </button>
              </>
            )}
            {publishStep === 2 && (
              <>
                <h2 style={s.modalTitle}>One Last Step</h2>
                <p style={s.modalSub}>A small fee keeps Inkwell running and spam-free.</p>
                <div style={s.payCard}>
                  <div style={s.payRow}><span>Publishing fee</span><span style={s.payAmt}>$0.50</span></div>
                  <div style={s.divider} />
                  <div style={{ ...s.payRow, fontWeight: 700 }}><span>Total today</span><span style={s.payAmt}>$0.50</span></div>
                </div>
                <div style={s.fakeCard}>
                  <div style={s.formGroup}><label style={s.label}>Card number</label><input style={s.input} placeholder="4242 4242 4242 4242" /></div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ ...s.formGroup, flex: 1 }}><label style={s.label}>Expiry</label><input style={s.input} placeholder="MM / YY" /></div>
                    <div style={{ ...s.formGroup, flex: 1 }}><label style={s.label}>CVC</label><input style={s.input} placeholder="123" /></div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button style={s.backBtn2} onClick={() => setPublishStep(1)}>← Edit Story</button>
                  <button style={s.publishBtn2} onClick={handlePublish} disabled={loading}>{loading ? "Publishing..." : "Pay & Publish ✦"}</button>
                </div>
              </>
            )}
          </div>
        </main>
      )}

      {/* PREMIUM */}
      {view === "premium" && (
        <main style={s.main}>
          <button style={s.backBtn} onClick={() => setView("feed")}>← Back</button>
          <div style={s.modal}>
            <div style={s.premiumBadgeLarge}>✦ Premium</div>
            <h2 style={s.modalTitle}>Upgrade to Premium</h2>
            <p style={s.modalSub}>For writers serious about sharing their work.</p>
            <div style={s.perks}>
              {[
                ["4 free story posts/month", "Post up to 4 stories included in your plan. Extra stories are $0.50 each."],
                ["✦ Premium badge", "A gold badge next to your name on every story you publish."],
                ["Priority in the feed", "Your stories get featured at the top of the genre feed."],
                ["Early access to new features", "Be first to try new reactions, stats, and tools."],
              ].map(([title, desc]) => (
                <div key={title} style={s.perkItem}>
                  <div style={s.perkTitle}>{title}</div>
                  <div style={s.perkDesc}>{desc}</div>
                </div>
              ))}
            </div>
            <div style={s.priceBox}><span style={s.price}>$1</span><span style={s.pricePer}> / month</span></div>
            {session ? (
              profile?.is_premium
                ? <div style={{ ...s.publishBtn2, background: "#1A1825", color: "#4ade80", cursor: "default", textAlign: "center" }}>✓ You're already Premium</div>
                : <button style={s.publishBtn2} onClick={handleUpgradeToPremium} disabled={loading}>{loading ? "Upgrading..." : "Subscribe for $1/month"}</button>
            ) : (
              <button style={s.publishBtn2} onClick={() => { setAuthMode("signup"); setView("auth"); }}>Sign up to Subscribe</button>
            )}
            <p style={{ color: "#A7A9BE", fontSize: 12, textAlign: "center", marginTop: 12 }}>Cancel anytime. No hidden fees.</p>
          </div>
        </main>
      )}

      <footer style={s.footer}>
        <span style={s.logo}>✦ Inkwell</span>
        <span style={{ color: "#A7A9BE", fontSize: 13 }}>Stories worth reading.</span>
      </footer>
    </div>
  );
}

const s = {
  root: { background: "#0F0E17", minHeight: "100vh", color: "#FFFFFE", fontFamily: "'Georgia', serif", display: "flex", flexDirection: "column" },
  spinner: { fontSize: 48, color: "#E8C547", animation: "spin 2s linear infinite" },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 32px", borderBottom: "1px solid #2a2836", position: "sticky", top: 0, background: "#0F0E17", zIndex: 100, flexWrap: "wrap", gap: 12 },
  logo: { fontSize: 22, fontWeight: 700, color: "#E8C547", cursor: "pointer", letterSpacing: 1 },
  navRight: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" },
  navBtn: { background: "transparent", border: "1px solid #E8C547", color: "#E8C547", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontFamily: "Georgia, serif", fontSize: 13 },
  navBtnGhost: { background: "transparent", border: "1px solid #2a2836", color: "#A7A9BE", padding: "8px 14px", borderRadius: 6, cursor: "pointer", fontFamily: "Georgia, serif", fontSize: 13 },
  navUser: { color: "#FFFFFE", fontSize: 14 },
  publishBtn: { background: "#E8C547", color: "#0F0E17", border: "none", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontFamily: "Georgia, serif", fontWeight: 700, fontSize: 14 },
  premBadge: { background: "#E8C547", color: "#0F0E17", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 },
  main: { flex: 1, maxWidth: 900, margin: "0 auto", padding: "32px 24px", width: "100%", boxSizing: "border-box" },
  hero: { textAlign: "center", padding: "32px 0 24px" },
  heroTitle: { fontSize: 42, fontWeight: 700, color: "#FFFFFE", margin: "0 0 12px", lineHeight: 1.15 },
  heroSub: { color: "#A7A9BE", fontSize: 17, margin: 0 },
  filterRow: { display: "flex", gap: 8, flexWrap: "wrap", margin: "20px 0 28px" },
  genreBtn: { background: "transparent", border: "1px solid #2a2836", color: "#A7A9BE", padding: "6px 14px", borderRadius: 20, cursor: "pointer", fontSize: 13, fontFamily: "Georgia, serif" },
  genreBtnActive: { background: "#E8C547", color: "#0F0E17", border: "1px solid #E8C547", fontWeight: 700 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 },
  emptyState: { textAlign: "center", padding: "60px 20px", color: "#FFFFFE" },
  card: { background: "#1A1825", border: "1px solid #2a2836", borderRadius: 12, padding: "22px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10 },
  cardTop: { display: "flex", gap: 8, alignItems: "center" },
  genreTag: { background: "#2a2836", color: "#E8C547", fontSize: 11, padding: "3px 10px", borderRadius: 20, fontFamily: "system-ui, sans-serif", letterSpacing: 0.5, textTransform: "uppercase" },
  cardTitle: { fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.3, color: "#FFFFFE" },
  cardPreview: { color: "#A7A9BE", fontSize: 14, lineHeight: 1.6, margin: 0, flex: 1 },
  cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 8 },
  authorName: { fontSize: 13, color: "#FFFFFE", fontFamily: "system-ui, sans-serif" },
  badge: { color: "#E8C547", fontWeight: 700 },
  reactionRow: { display: "flex", gap: 8 },
  reactionBubble: { background: "#2a2836", padding: "3px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer", fontFamily: "system-ui, sans-serif", color: "#FFFFFE" },
  backBtn: { background: "transparent", border: "none", color: "#A7A9BE", cursor: "pointer", fontSize: 14, fontFamily: "Georgia, serif", padding: 0, marginBottom: 24 },
  article: { maxWidth: 680, margin: "0 auto" },
  articleTitle: { fontSize: 36, fontWeight: 700, margin: "14px 0 12px", lineHeight: 1.2 },
  articleMeta: { display: "flex", gap: 24, color: "#FFFFFE", fontSize: 14, fontFamily: "system-ui, sans-serif" },
  divider: { borderTop: "1px solid #2a2836", margin: "24px 0" },
  articleBody: { lineHeight: 1.85 },
  para: { marginBottom: 20, fontSize: 17, color: "#E4E4F0" },
  reactionSection: { textAlign: "center" },
  reactionLabel: { color: "#A7A9BE", fontSize: 15, marginBottom: 16 },
  reactionBig: { display: "flex", justifyContent: "center", gap: 16 },
  reactionBigBtn: { background: "#1A1825", border: "2px solid #2a2836", borderRadius: 12, padding: "12px 24px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: "#FFFFFE" },
  reactionActive: { borderColor: "#E8C547" },
  reactionCount: { fontSize: 13, color: "#A7A9BE", fontFamily: "system-ui, sans-serif" },
  modal: { maxWidth: 540, margin: "0 auto", background: "#1A1825", borderRadius: 16, padding: "36px", border: "1px solid #2a2836" },
  modalTitle: { fontSize: 28, fontWeight: 700, margin: "0 0 8px" },
  modalSub: { color: "#A7A9BE", fontSize: 15, marginBottom: 28 },
  authTabs: { display: "flex", marginBottom: 28, borderBottom: "1px solid #2a2836" },
  authTab: { flex: 1, background: "transparent", border: "none", color: "#A7A9BE", padding: "12px", fontSize: 15, cursor: "pointer", fontFamily: "Georgia, serif" },
  authTabActive: { color: "#E8C547", borderBottom: "2px solid #E8C547" },
  authError: { color: "#f87171", fontSize: 13, margin: "-8px 0 16px", fontFamily: "system-ui, sans-serif" },
  formGroup: { marginBottom: 18 },
  label: { display: "block", fontSize: 13, color: "#A7A9BE", marginBottom: 6, fontFamily: "system-ui, sans-serif" },
  input: { width: "100%", background: "#0F0E17", border: "1px solid #2a2836", borderRadius: 8, padding: "10px 14px", color: "#FFFFFE", fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" },
  publishBtn2: { width: "100%", background: "#E8C547", color: "#0F0E17", border: "none", padding: "14px", borderRadius: 8, cursor: "pointer", fontFamily: "Georgia, serif", fontWeight: 700, fontSize: 16, marginTop: 8 },
  backBtn2: { flex: 1, background: "transparent", color: "#A7A9BE", border: "1px solid #2a2836", padding: "14px", borderRadius: 8, cursor: "pointer", fontFamily: "Georgia, serif", fontSize: 15, marginTop: 8 },
  payCard: { background: "#0F0E17", border: "1px solid #2a2836", borderRadius: 10, padding: "18px 20px", marginBottom: 24, fontFamily: "system-ui, sans-serif" },
  payRow: { display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 8, color: "#FFFFFE" },
  payAmt: { color: "#E8C547", fontWeight: 700 },
  fakeCard: { marginBottom: 8 },
  slotBanner: { background: "#2a2836", borderRadius: 8, padding: "10px 14px", marginBottom: 24, fontSize: 13, fontFamily: "system-ui, sans-serif", color: "#E8C547" },
  premiumBadgeLarge: { background: "#E8C547", color: "#0F0E17", display: "inline-block", padding: "6px 16px", borderRadius: 20, fontWeight: 700, fontSize: 14, marginBottom: 16 },
  perks: { display: "flex", flexDirection: "column", gap: 16, margin: "24px 0" },
  perkItem: { background: "#0F0E17", borderRadius: 10, padding: "14px 18px", border: "1px solid #2a2836" },
  perkTitle: { fontWeight: 700, fontSize: 15, marginBottom: 4 },
  perkDesc: { color: "#A7A9BE", fontSize: 13, fontFamily: "system-ui, sans-serif", lineHeight: 1.5 },
  priceBox: { textAlign: "center", margin: "8px 0 16px" },
  price: { fontSize: 52, fontWeight: 700, color: "#E8C547" },
  pricePer: { fontSize: 20, color: "#A7A9BE" },
  notif: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#E8C547", color: "#0F0E17", padding: "12px 24px", borderRadius: 30, fontWeight: 700, fontSize: 14, zIndex: 999, fontFamily: "Georgia, serif", boxShadow: "0 4px 20px rgba(0,0,0,0.4)", whiteSpace: "nowrap" },
  footer: { borderTop: "1px solid #2a2836", padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" },
};
