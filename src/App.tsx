import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { User } from 'firebase/auth'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { auth, authPersistenceReady } from './firebase'
import {
  ArrowRight, ArrowUpRight, BarChart3, BookOpen, CalendarDays, Check,
  ChevronRight, Clock3, Compass, Flame, Flag, HeartHandshake, Leaf,
  LockKeyhole, Menu, Mountain, Plus, Search, Settings, ShieldCheck,
  Sparkles, Sprout, Star, Target, Trophy, Users, X
} from 'lucide-react'
import './styles.css'

type Screen = 'home' | 'day' | 'growth' | 'squad' | 'insights'
type AuthMode = 'login' | 'signup' | 'reset'
type TaskStatus = 'Not started' | 'In progress' | 'Completed' | 'Skipped'
type Task = { id: number; title: string; category: string; start: string; end: string; status: TaskStatus; note?: string }

const demoTasks: Task[] = [
  { id: 1, title: 'Morning reset', category: 'Wellness', start: '06:30', end: '07:00', status: 'Completed', note: 'A gentle start to the day' },
  { id: 2, title: 'Deep work session', category: 'Deep Work', start: '09:00', end: '10:30', status: 'In progress', note: 'One important thing at a time' },
  { id: 3, title: 'Learn something new', category: 'Learning', start: '16:00', end: '16:45', status: 'Not started', note: 'Small steps count' },
]
const zoneData = [
  { name: 'Discipline Forest', sub: 'Build small, repeatable habits', icon: Sprout, tone: 'forest', scene: 'forest', hint: 'A quiet place to begin again' },
  { name: 'Knowledge Tower', sub: 'Curiosity becomes skill', icon: BookOpen, tone: 'knowledge', scene: 'tower', hint: 'Follow the ideas that light you up' },
  { name: 'Social Harbor', sub: 'Make meaningful connections', icon: HeartHandshake, tone: 'social', scene: 'harbor', hint: 'Every conversation opens a door' },
  { name: 'Adventure Isles', sub: 'Collect new experiences', icon: Mountain, tone: 'adventure', scene: 'isles', hint: 'Make room for a new story' },
  { name: 'Skill Forge', sub: 'Turn practice into mastery', icon: Star, tone: 'forge', scene: 'forge', hint: 'Shape potential through practice' },
]
const demoQuests = [
  { id: 1, title: 'Learn one new word', category: 'Knowledge', progress: 0, target: 1, unit: 'word', reward: 20 },
  { id: 2, title: 'Start a conversation', category: 'Social', progress: 1, target: 3, unit: 'people', reward: 40 },
  { id: 3, title: 'Try a new recipe', category: 'Adventure', progress: 0, target: 1, unit: 'recipe', reward: 30 },
]

function App() {
  const [enteredApp, setEnteredApp] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [screen, setScreen] = useState<Screen>('home')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [demo, setDemo] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [quests, setQuests] = useState(demoQuests)
  const [questFilter, setQuestFilter] = useState('All')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskStart, setTaskStart] = useState('09:00')
  const [taskEnd, setTaskEnd] = useState('10:00')
  const [toast, setToast] = useState('')
  const completed = tasks.filter(task => task.status === 'Completed').length
  const percent = tasks.length ? Math.round(completed / tasks.length * 100) : 0
  const today = useMemo(() => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()), [])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false

    authPersistenceReady
      .then(() => {
        if (cancelled) return
        unsubscribe = onAuthStateChanged(auth, user => {
          setCurrentUser(user)
          setEnteredApp(Boolean(user))
          setDemo(false)
          setAuthReady(true)
        })
      })
      .catch(() => setAuthReady(true))

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const authenticate = async (mode: AuthMode, email: string, password: string, displayName: string) => {
    await authPersistenceReady
    const normalizedEmail = email.trim().toLowerCase()

    if (mode === 'signup') {
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password)
      if (displayName.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() })
      }
      setCurrentUser(credential.user)
      setDemo(false)
      setEnteredApp(true)
      return
    }

    if (mode === 'login') {
      const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password)
      setCurrentUser(credential.user)
      setDemo(false)
      setEnteredApp(true)
      return
    }

    await sendPasswordResetEmail(auth, normalizedEmail)
  }

  const handleSignOut = async () => {
    await signOut(auth)
    setCurrentUser(null)
    setDemo(false)
    setEnteredApp(false)
    setScreen('home')
  }

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }
  const openDemo = () => {
    setDemo(true)
    setTasks(demoTasks)
    setQuests(demoQuests)
    setEnteredApp(true)
    setScreen('home')
    notify('Demo opened · sample data only')
  }
  const goScreen = (next: Screen) => {
    setScreen(next)
    setMobileMenu(false)
  }
  const leaveDemo = () => {
    setEnteredApp(false)
    setDemo(false)
    setTasks([])
    setScreen('home')
  }
  const addTask = () => {
    if (!taskTitle.trim()) return
    setTasks(old => [...old, { id: Date.now(), title: taskTitle.trim(), category: 'Personal', start: taskStart, end: taskEnd, status: 'Not started' as const }].sort((a,b) => a.start.localeCompare(b.start)))
    setTaskTitle('')
    setShowTaskForm(false)
    notify('Added to this local demo · not saved to an account')
  }
  const updateStatus = (id: number, status: TaskStatus) => {
    setTasks(old => old.map(task => task.id === id ? { ...task, status } : task))
    notify('Demo task updated · no XP is awarded in this prototype')
  }
  const updateQuest = (id: number) => setQuests(old => old.map(quest => quest.id === id ? { ...quest, progress: Math.min(quest.target, quest.progress + 1) } : quest))
  const nav = [
    { id: 'home' as const, label: 'Home', icon: Compass },
    { id: 'day' as const, label: 'My Day', icon: CalendarDays },
    { id: 'growth' as const, label: 'Growth World', icon: MapIcon },
    { id: 'squad' as const, label: 'Squad', icon: Users },
    { id: 'insights' as const, label: 'Insights', icon: BarChart3 },
  ]

  if (!authReady) {
    return <main className="auth-loading"><div className="loading-mark">✦</div><b>Opening your DAYLOCK</b><span>Checking your secure session…</span></main>
  }

  if (!enteredApp) return <Landing onDemo={openDemo} onAuth={authenticate} toast={toast}/>

  return (
    <div className="app-shell">
      <aside className={mobileMenu ? 'sidebar open' : 'sidebar'}>
        <div className="brand"><div className="brand-mark">✦</div><div><b>DAYLOCK</b><span>Plan tonight. Execute tomorrow.</span></div><button className="close-menu" onClick={() => setMobileMenu(false)}><X size={18}/></button></div>
        <div className="side-caption">YOUR COMMAND CENTRE</div>
        <nav>{nav.map(item => <button key={item.id} className={screen === item.id ? 'nav-item active' : 'nav-item'} onClick={() => goScreen(item.id)}><item.icon size={18}/>{item.label}{screen === item.id && <span className="nav-dot"/>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="realm-mini"><Sprout/><div><b>{demo ? 'Explorer' : currentUser?.displayName || 'DAYLOCK Member'}</b><span>{demo ? 'Demo profile' : currentUser?.email || 'Signed in'}</span></div><span className="level">Lv. 1</span></div><div className="side-note"><ShieldCheck size={15}/> {demo ? 'Sample data · isolated demo' : 'Signed in · personal account'}</div><button className="leave-demo" onClick={demo ? leaveDemo : () => { void handleSignOut().catch(() => notify('Could not sign out. Please try again.')) }}>{demo ? 'Exit demo' : 'Sign out'} <ArrowUpRight size={14}/></button></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><button className="mobile-menu" onClick={() => setMobileMenu(true)}><Menu/></button><div className="crumb">DAYLOCK <span>/</span> {nav.find(item => item.id === screen)?.label}</div><div className="top-actions"><div className="demo-pill"><span/> {demo ? 'ISOLATED DEMO' : 'ACCOUNT ACTIVE'}</div><button className="icon-button" aria-label="Search"><Search size={17}/></button><button className="icon-button" aria-label="Settings"><Settings size={18}/></button></div></header>
        {screen === 'home' && <div className="content">
          <section className="hero-panel"><div className="hero-copy"><div className="eyebrow"><span className="pulse"/> YOUR NEXT CHAPTER BEGINS</div><h1>Make room for<br/><em>your next chapter.</em></h1><p>Plan tomorrow with intention. Show up for today. Let the small wins become your story.</p><div className="hero-actions"><button className="primary" onClick={() => goScreen('day')}>Plan tomorrow <ArrowRight size={16}/></button><button className="secondary" onClick={() => goScreen('growth')}>Explore Growth World <Compass size={16}/></button></div></div><HeroLandscape/></section>
          <div className="welcome-row"><div><div className="eyebrow">{today.toUpperCase()} · DEMO JOURNEY</div><h2>{demo ? 'Welcome, Explorer.' : `Welcome, ${currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there'}.`}</h2><p>{demo ? 'A safe sample world to explore.' : 'Your personal DAYLOCK account is ready. Start by planning tomorrow.'}</p></div><div className="fresh-pill"><Sparkles size={16}/> {demo ? 'Sample profile · Level 1' : 'Level 1 · 0 XP'}</div></div>
          <section className="stat-grid"><Stat icon={<Flame/>} label="Current streak" value={demo ? '4 sample days' : '0 days'} sub={demo ? 'Illustrative demo data' : 'Your journey starts today'}/><Stat icon={<Trophy/>} label="Journey XP" value={demo ? '840 sample XP' : '0 XP'} sub={demo ? 'Not connected to rewards' : 'No rewards have been earned yet'}/><Stat icon={<Target/>} label="Today's progress" value={`${completed} / ${tasks.length}`} sub="Sample tasks only"/></section>
          <section className="home-grid"><div className="panel schedule-panel"><PanelTitle icon={<CalendarDays/>} title="A day with intention" action="Open My Day" onAction={() => goScreen('day')}/>{tasks.slice(0,3).map(task => <TaskRow key={task.id} task={task} onStatus={updateStatus}/>)}<div className="panel-footnote">Sample timetable · demo changes reset when you leave</div></div><div className="panel quest-panel"><PanelTitle icon={<Flag/>} title="Side quests" action="Explore" onAction={() => goScreen('growth')}/>{quests.slice(0,3).map(quest => <QuestLine key={quest.id} quest={quest}/>)}<button className="text-button" onClick={() => goScreen('growth')}>Explore all quests <ArrowRight size={14}/></button></div></section>
          <section className="world-strip"><div className="world-heading"><div><div className="eyebrow">A WORLD THAT GROWS WITH YOU</div><h2>Five realms. One evolving you.</h2><p>Explore a new path, practise a skill or celebrate a small win.</p></div><button className="text-button" onClick={() => goScreen('growth')}>Enter the world <ArrowRight size={15}/></button></div><div className="zone-grid">{zoneData.slice(0,3).map(zone => <ZoneCard key={zone.name} zone={zone} onClick={() => goScreen('growth')}/>)}</div></section>
        </div>}
        {screen === 'day' && <div className="content"><div className="page-heading"><div className="eyebrow">MAKE SPACE FOR WHAT MATTERS</div><h1>My Day</h1><p>Prepare tomorrow before midnight. Then let today be about showing up.</p></div><div className="day-toolbar"><div><span className="lock-bullet"><LockKeyhole size={15}/> Tomorrow's plan</span><small>{demo ? 'Demo timetable · sample data only.' : 'This timetable is still a local preview. Cloud saving and server-side midnight locking are the next build stage.'}</small></div><div className="toolbar-date">{new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(Date.now()+86400000))}</div></div><div className="panel schedule-panel"><PanelTitle icon={<CalendarDays/>} title="Tomorrow's timetable" action="Add a block" onAction={() => setShowTaskForm(true)}/>{tasks.length ? tasks.map(task => <TaskRow key={task.id} task={task} onStatus={updateStatus}/>) : <Empty icon={<CalendarDays/>} title="Nothing scheduled yet." detail="Start with one useful block. You can shape the rest later." action="Add your first block" onAction={() => setShowTaskForm(true)}/>}</div>{showTaskForm && <div className="modal-backdrop"><form className="task-form panel" onSubmit={event => {event.preventDefault();addTask()}}><button type="button" className="close-form" onClick={() => setShowTaskForm(false)}><X/></button><div className="eyebrow">TOMORROW · NEW TIME BLOCK</div><h2>Add a block</h2><label>What will you work on?<input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="e.g. Study, gym, project" required/></label><div className="time-fields"><label>Starts<input type="time" value={taskStart} onChange={event => setTaskStart(event.target.value)} required/></label><label>Ends<input type="time" value={taskEnd} onChange={event => setTaskEnd(event.target.value)} required/></label></div><button className="primary" type="submit">Add to tomorrow <Plus size={16}/></button></form></div>}</div>}
        {screen === 'growth' && <div className="content"><div className="page-heading"><div className="eyebrow">YOUR PERSONAL ADVENTURE</div><h1>Growth World</h1><p>Small quests. New skills. A life with more stories.</p></div><div className="world-banner"><div><div className="eyebrow">CHOOSE YOUR NEXT REALM</div><h2>Every path begins<br/>with one small step.</h2><p>Explore a realm and pick a challenge that feels right for you.</p></div><div className="world-sigil">✧</div></div><div className="zone-grid full">{zoneData.map(zone => <ZoneCard key={zone.name} zone={zone} onClick={() => notify(`${zone.name} selected · realm interactions are preview-only.`)}/>)}</div><div className="panel"><PanelTitle icon={<Flag/>} title="Quest board" action="Create quest" onAction={() => notify('Custom quest creation will be implemented with the Growth database.')}/><div className="filter-row">{['All','Knowledge','Social','Adventure','Wellness','Skill'].map(filter => <button className={questFilter===filter?'filter active':'filter'} key={filter} onClick={() => setQuestFilter(filter)}>{filter}</button>)}</div>{quests.filter(quest => questFilter==='All'||quest.category===questFilter).map(quest => <div className="quest-board-row" key={quest.id}><div className="quest-icon"><Flag size={17}/></div><div className="quest-text"><b>{quest.title}</b><span>{quest.category} · {quest.progress}/{quest.target} {quest.unit} · {quest.reward} sample XP</span></div><button className="small-action" onClick={() => updateQuest(quest.id)} disabled={quest.progress>=quest.target}>Add progress</button></div>)}</div></div>}
        {screen === 'squad' && <div className="content"><div className="page-heading"><div className="eyebrow">BETTER, TOGETHER</div><h1>Squad</h1><p>Friendly challenges, shared momentum and room to cheer each other on.</p></div><div className="squad-hero"><div><div className="eyebrow">YOUR PEOPLE, YOUR PACE</div><h2>Find your crew.</h2><p>Create a private squad or join friends with an invite code. Share only the progress you choose.</p><button className="primary" onClick={() => notify('Real squad invitations and private sharing will be connected after authentication.')}>Create a squad <Plus size={16}/></button></div><div className="squad-emblem"><Users size={52}/></div></div><div className="panel"><PanelTitle icon={<Trophy/>} title="Weekly friendly race"/><Empty icon={<Users/>} title="Your arena is waiting." detail="Leaderboards will use opted-in progress. Private schedules are never shared."/></div></div>}
        {screen === 'insights' && <div className="content"><div className="page-heading"><div className="eyebrow">LOOK HOW FAR YOU'VE COME</div><h1>Insights</h1><p>Progress is personal. Notice patterns, not perfection.</p></div><div className="stat-grid"><Stat icon={<Target/>} label="Tasks completed" value={`${completed} sample`} sub="Demo activity only"/><Stat icon={<Flame/>} label="Current streak" value="4 sample days" sub="Not a real account streak"/><Stat icon={<Trophy/>} label="Journey XP" value="840 sample XP" sub="Not a live reward balance"/></div><div className="panel chart-panel"><PanelTitle icon={<BarChart3/>} title="A sample weekly rhythm"/><div className="bars">{[35,58,42,76,62,24,48].map((value,index)=><div className="bar-column" key={index}><div className="bar-track"><i style={{height:`${value}%`}}/></div><small>{['M','T','W','T','F','S','S'][index]}</small></div>)}</div><div className="panel-footnote">Illustrative chart · connected analytics are not implemented yet</div></div></div>}
      </main>
      {toast && <div className="toast"><Check size={16}/>{toast}</div>}
      {mobileMenu && <button className="scrim" onClick={() => setMobileMenu(false)} aria-label="Close navigation"/>}
    </div>
  )
}

function Landing({onDemo,onAuth,toast}:{onDemo:()=>void;onAuth:(mode:AuthMode,email:string,password:string,displayName:string)=>Promise<void>;toast:string}) {
  const [menuOpen,setMenuOpen]=useState(false)
  const [authMode,setAuthMode]=useState<AuthMode|null>(null)
  return <main className="landing">
    <header className="landing-nav"><a className="landing-brand" href="#top"><span className="brand-emblem">✦</span><span><b>DAYLOCK</b><small>PLAN TONIGHT. EXECUTE TOMORROW.</small></span></a><nav className={menuOpen?'landing-links open':'landing-links'}><a href="#ritual" onClick={()=>setMenuOpen(false)}>The ritual</a><a href="#realms" onClick={()=>setMenuOpen(false)}>Growth World</a><a href="#squad" onClick={()=>setMenuOpen(false)}>Squad</a></nav><div className="landing-actions"><button className="text-link" onClick={() => setAuthMode('login')}>Log in</button><button className="nav-cta" onClick={() => setAuthMode('signup')}>Create account <ArrowRight size={15}/></button></div><button className="landing-menu" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Toggle menu">{menuOpen?<X/>:<Menu/>}</button></header>
    <section className="landing-hero" id="top"><div className="hero-background"><div className="hero-moon"/><div className="hero-mountain hero-mountain-a"/><div className="hero-mountain hero-mountain-b"/><div className="hero-island"><div className="island-tower">✧</div></div><div className="hero-forest-line"/></div><div className="hero-content"><div className="hero-kicker"><span/> A CALMER WAY TO MAKE PROGRESS</div><h1>Plan tonight.<br/><em>Become tomorrow.</em></h1><p>Give tomorrow a little direction. Seal your plan at midnight, follow through at your own pace, and build a life beyond the checklist.</p><div className="landing-cta-row"><button className="nav-cta large" onClick={() => setAuthMode('signup')}>Start your fresh journey <ArrowRight size={16}/></button><button className="glass-cta" onClick={onDemo}><Compass size={16}/> Explore isolated demo</button></div><div className="trust-row"><span><ShieldCheck/> Private by design</span><span><LockKeyhole/> A midnight planning ritual</span><span><Sparkles/> Personal growth quests</span></div></div><div className="hero-side-note"><span>01 / 05</span><i/> FIVE REALMS. ONE JOURNEY.</div><div className="hero-scroll">SCROLL TO EXPLORE <span>↓</span></div></section>
    <section className="intro-band"><div className="intro-statement"><span className="section-kicker">NOT ANOTHER CHECKLIST</span><h2>Make plans with intention.<br/><em>Make room for real life.</em></h2></div><p>DAYLOCK brings your daily plan, personal quests and friendly accountability into one considered space. Less noise. More follow-through. A little more adventure.</p></section>
    <section className="ritual-section" id="ritual"><div className="section-head"><div><span className="section-kicker">THE DAILY RITUAL</span><h2>Three moments.<br/><em>A clearer day.</em></h2></div><p>A simple rhythm to help tomorrow feel less overwhelming before it even begins.</p></div><div className="ritual-grid"><article className="ritual-card ritual-one"><span className="ritual-number">01</span><div className="ritual-icon"><CalendarDays/></div><h3>Plan tonight</h3><p>Give tomorrow a thoughtful shape with time blocks that leave room to breathe.</p><span className="ritual-word">INTENTION</span></article><article className="ritual-card ritual-two"><span className="ritual-number">02</span><div className="ritual-icon"><LockKeyhole/></div><h3>Seal at midnight</h3><p>Your schedule becomes read-only at midnight in your chosen timezone.</p><span className="ritual-word">COMMITMENT</span></article><article className="ritual-card ritual-three"><span className="ritual-number">03</span><div className="ritual-icon"><Sprout/></div><h3>Grow as you go</h3><p>Turn small side quests, habits and milestones into a story of your own.</p><span className="ritual-word">MOMENTUM</span></article></div></section>
    <section className="realms-section" id="realms"><div className="realms-heading"><div><span className="section-kicker">A WORLD THAT GROWS WITH YOU</span><h2>Find your next<br/><em>horizon.</em></h2></div><p>Five imagined realms for the parts of life you want to nurture. Choose a path. Take one small step. Come back whenever you're ready.</p></div><div className="realms-map"><div className="map-orbit orbit-one"/><div className="map-orbit orbit-two"/><div className="realm-feature realm-feature-main"><div className="realm-art art-forest"><span className="art-sun"/><span className="art-tree">♧</span></div><div className="realm-caption"><span>01 · BEGIN HERE</span><b>Discipline Forest</b><small>Build the habits that hold you</small></div></div><div className="realm-feature realm-feature-top"><div className="realm-art art-tower"><span className="art-spire">✧</span></div><div className="realm-caption"><span>02 · STAY CURIOUS</span><b>Knowledge Tower</b><small>Follow a question somewhere new</small></div></div><div className="realm-feature realm-feature-right"><div className="realm-art art-harbor"><span className="art-sail">△</span></div><div className="realm-caption"><span>03 · CONNECT</span><b>Social Harbor</b><small>Make room for good conversations</small></div></div><div className="realm-feature realm-feature-bottom"><div className="realm-art art-isles"><span className="art-star">✦</span></div><div className="realm-caption"><span>04 · EXPLORE</span><b>Adventure Isles</b><small>Collect experiences, not pressure</small></div></div><div className="realm-feature realm-feature-left"><div className="realm-art art-forge"><span className="art-forge-mark">✧</span></div><div className="realm-caption"><span>05 · PRACTISE</span><b>Skill Forge</b><small>Turn effort into something lasting</small></div></div></div><div className="realms-foot"><span>FIVE PATHS · ONE PERSONAL JOURNEY</span><button className="underlined-action" onClick={onDemo}>Explore the demo world <ArrowUpRight size={15}/></button></div></section>
    <section className="squad-promo" id="squad"><div className="squad-art"><div className="squad-sun"/><div className="squad-silhouette silhouette-one"/><div className="squad-silhouette silhouette-two"/><div className="squad-silhouette silhouette-three"/></div><div className="squad-copy"><span className="section-kicker">BETTER, TOGETHER</span><h2>Make progress.<br/><em>Bring your people.</em></h2><p>Create a private Squad, take on weekly challenges and celebrate each other's wins. Friendly competition, shared on your terms.</p><button className="nav-cta" onClick={onDemo}>See the Squad preview <ArrowRight size={15}/></button></div></section>
    <section className="closing-cta"><span className="section-kicker">YOUR NEXT CHAPTER IS YOURS</span><h2>Small plans.<br/><em>Wide-open possibilities.</em></h2><p>Start with tomorrow. See where it takes you.</p><div><button className="nav-cta large" onClick={() => setAuthMode('signup')}>Create your account <ArrowRight size={16}/></button><button className="text-link" onClick={onDemo}>Explore the demo instead</button></div></section>
    <footer className="landing-footer"><a className="landing-brand" href="#top"><span className="brand-emblem">✦</span><span><b>DAYLOCK</b><small>PLAN TONIGHT. EXECUTE TOMORROW.</small></span></a><span>Designed for intentional days and curious lives.</span><span>© {new Date().getFullYear()} DAYLOCK</span></footer>
    {toast&&<div className="toast"><Check size={16}/>{toast}</div>}
    {authMode && <AuthDialog mode={authMode} onClose={() => setAuthMode(null)} onModeChange={setAuthMode} onSubmit={onAuth}/>}
  </main>
}


function AuthDialog({mode,onClose,onModeChange,onSubmit}:{mode:AuthMode;onClose:()=>void;onModeChange:(mode:AuthMode)=>void;onSubmit:(mode:AuthMode,email:string,password:string,displayName:string)=>Promise<void>}) {
  const [displayName,setDisplayName]=useState('')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')

  const readableError=(value:unknown)=>{
    const code=(value as {code?:string})?.code || ''
    if(code.includes('email-already-in-use')) return 'An account already exists with this email. Try logging in instead.'
    if(code.includes('invalid-email')) return 'Please enter a valid email address.'
    if(code.includes('weak-password')) return 'Choose a stronger password with at least 8 characters.'
    if(code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Email or password is incorrect. Check your details and try again.'
    if(code.includes('too-many-requests')) return 'Too many attempts. Please wait a little and try again.'
    if(code.includes('network-request-failed')) return 'Network connection failed. Check your internet and retry.'
    if(code.includes('unauthorized-domain')) return 'This website domain is not authorised in Firebase Authentication.'
    return (value as {message?:string})?.message || 'Something went wrong. Please try again.'
  }

  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    setError('')
    setSuccess('')
    if(mode==='signup' && displayName.trim().length<2){setError('Please enter a display name with at least 2 characters.');return}
    if(mode!=='reset' && password.length<8){setError('Use a password with at least 8 characters.');return}
    setBusy(true)
    try{
      await onSubmit(mode,email,password,displayName)
      if(mode==='reset'){
        setSuccess('Password reset email sent. Check your inbox and spam folder.')
        setPassword('')
      }
    }catch(value){
      setError(readableError(value))
    }finally{
      setBusy(false)
    }
  }

  return <div className="auth-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
    <section className="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close" type="button" onClick={onClose} aria-label="Close"><X/></button>
      <div className="auth-mark">✦</div>
      <div className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div>
      <h2 id="auth-title">{mode==='signup'?'Create your DAYLOCK account':mode==='login'?'Welcome back':'Reset your password'}</h2>
      <p className="auth-intro">{mode==='signup'?'One account for your plans, quests and personal progress.':mode==='login'?'Sign in to return to your personal command centre.':'We will email you a secure password reset link.'}</p>
      <form onSubmit={submit}>
        {mode==='signup' && <label>Display name<input autoComplete="name" value={displayName} onChange={event=>setDisplayName(event.target.value)} placeholder="What should we call you?" required maxLength={40}/></label>}
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com" required/></label>
        {mode!=='reset' && <label>Password<input type="password" autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={event=>setPassword(event.target.value)} placeholder={mode==='signup'?'At least 8 characters':'Your password'} minLength={8} required/></label>}
        {mode==='login' && <button type="button" className="auth-inline-link" onClick={()=>{setError('');setSuccess('');onModeChange('reset')}}>Forgot password?</button>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {success && <p className="auth-success" role="status">{success}</p>}
        <button className="nav-cta auth-submit" type="submit" disabled={busy}>{busy?'Please wait…':mode==='signup'?'Create account':mode==='login'?'Log in':'Send reset link'} <ArrowRight size={16}/></button>
      </form>
      <div className="auth-switch">{mode==='signup'?'Already have an account?':mode==='login'?'New to DAYLOCK?':'Remembered your password?'} <button type="button" onClick={()=>{setError('');setSuccess('');onModeChange(mode==='signup'?'login':'signup')}}>{mode==='signup'?'Log in':mode==='login'?'Create account':'Back to log in'}</button></div>
      <div className="auth-privacy"><ShieldCheck size={14}/> Your personal data is associated with your account.</div>
    </section>
  </div>
}

function MapIcon({size=18}:{size?:number}) { return <Compass size={size}/> }
function HeroLandscape() { return <div className="hero-art"><div className="hero-light"/><div className="hero-range range-back"/><div className="hero-range range-mid"/><div className="hero-range range-front"/><div className="hero-islet"><span>✧</span></div><div className="hero-reflection"/></div> }
function Stat({icon,label,value,sub}:{icon:ReactNode;label:string;value:string;sub:string}) { return <div className="stat-card"><div className="stat-icon">{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div> }
function PanelTitle({icon,title,action,onAction}:{icon:ReactNode;title:string;action?:string;onAction?:()=>void}) { return <div className="panel-title"><div>{icon}<h3>{title}</h3></div>{action&&<button className="text-button" onClick={onAction}>{action} <ArrowRight size={14}/></button>}</div> }
function Empty({icon,title,detail,action,onAction}:{icon:ReactNode;title:string;detail:string;action?:string;onAction?:()=>void}) { return <div className="empty-state"><div className="empty-icon">{icon}</div><b>{title}</b><p>{detail}</p>{action&&<button className="secondary small" onClick={onAction}>{action} <ArrowRight size={14}/></button>}</div> }
function TaskRow({task,onStatus}:{task:Task;onStatus:(id:number,status:TaskStatus)=>void}) { return <div className="task-row"><div className="task-time">{task.start}<span>—</span>{task.end}</div><div className="task-main"><b>{task.title}</b><span>{task.category}{task.note? ` · ${task.note}`:''}</span></div><select value={task.status} onChange={event => onStatus(task.id,event.target.value as TaskStatus)}><option>Not started</option><option>In progress</option><option>Completed</option><option>Skipped</option></select></div> }
function QuestLine({quest}:{quest:typeof demoQuests[number]}) { return <div className="quest-line"><div className="quest-icon"><Sparkles size={16}/></div><div className="quest-text"><b>{quest.title}</b><span>{quest.category} · {quest.progress}/{quest.target} {quest.unit}</span><div className="progress-track"><i style={{width:`${quest.progress/quest.target*100}%`}}/></div></div></div> }
function ZoneCard({zone,onClick}:{zone:typeof zoneData[number];onClick:()=>void}) { const Icon=zone.icon;return <button className={`zone-card ${zone.tone}`} onClick={onClick}><div className={`zone-art scene-${zone.scene}`}><div className="zone-glow"/><Icon size={29}/><span className="zone-spark">✦</span></div><div className="zone-info"><b>{zone.name}</b><span>{zone.sub}</span><div className="progress-track"><i style={{width:'0%'}}/></div><small>{zone.hint}</small></div><ChevronRight size={16}/></button> }
export default App
