import { useMemo, useState } from 'react'
import {
  ArrowRight, Bell, CalendarDays, Check, ChevronRight, CircleHelp, Clock3,
  Compass, Flame, Flag, Leaf, LockKeyhole, Menu, Plus, Search, Settings,
  ShieldCheck, Sparkles, Swords, Target, Trophy, Users, X, Droplets, Moon,
  BookOpen, Dumbbell, Map, BarChart3, Play, Pause, CheckCircle2, Sprout,
  Mountain, ChefHat, Languages, Lightbulb, Heart, Coffee
} from 'lucide-react'
import './styles.css'

type Screen = 'home' | 'day' | 'growth' | 'squad' | 'insights'
type TaskStatus = 'Not started' | 'In progress' | 'Completed' | 'Skipped'
type Task = { id: number; title: string; category: string; start: string; end: string; status: TaskStatus; note?: string }

const demoTasks: Task[] = [
  { id: 1, title: 'Morning reset', category: 'Wellness', start: '06:30', end: '07:00', status: 'Completed', note: 'A gentle start to the day' },
  { id: 2, title: 'Deep work session', category: 'Deep Work', start: '09:00', end: '10:30', status: 'In progress', note: 'One important thing at a time' },
  { id: 3, title: 'Learn something new', category: 'Learning', start: '16:00', end: '16:45', status: 'Not started', note: 'Small steps count' },
]
const zones = [
  { name: 'Discipline Forest', sub: 'Build small, repeatable habits', icon: Sprout, level: 'Open realm', tone: 'forest', progress: 68 },
  { name: 'Knowledge Tower', sub: 'Curiosity becomes skill', icon: BookOpen, level: 'Open realm', tone: 'knowledge', progress: 34 },
  { name: 'Social Harbor', sub: 'Make meaningful connections', icon: Users, level: 'Open realm', tone: 'social', progress: 18 },
  { name: 'Adventure Isles', sub: 'Collect new experiences', icon: Mountain, level: 'Open realm', tone: 'adventure', progress: 12 },
  { name: 'Skill Forge', sub: 'Turn practice into mastery', icon: Lightbulb, level: 'Open realm', tone: 'forge', progress: 45 },
]
const initialQuests = [
  { id: 1, title: 'Learn one new word', category: 'Knowledge', progress: 0, target: 1, unit: 'word' },
  { id: 2, title: 'Start a conversation', category: 'Social', progress: 1, target: 3, unit: 'people' },
  { id: 3, title: 'Try a new recipe', category: 'Adventure', progress: 0, target: 1, unit: 'recipe' },
]

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [demo, setDemo] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [quests, setQuests] = useState(initialQuests)
  const [questFilter, setQuestFilter] = useState('All')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskStart, setTaskStart] = useState('09:00')
  const [taskEnd, setTaskEnd] = useState('10:00')
  const [focusRunning, setFocusRunning] = useState(false)
  const [activeTask, setActiveTask] = useState('Deep work session')
  const [toast, setToast] = useState('')
  const [hydration, setHydration] = useState(0)
  const [showSignup, setShowSignup] = useState(false)
  const completed = tasks.filter(t => t.status === 'Completed').length
  const percent = tasks.length ? Math.round(completed / tasks.length * 100) : 0
  const date = useMemo(() => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()), [])

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }
  const startDemo = () => {
    setDemo(true)
    setTasks(demoTasks)
    setScreen('home')
    notify('Demo world opened — sample data only')
  }
  const goScreen = (next: Screen) => {
    setScreen(next)
    setMobileMenu(false)
  }
  const addTask = () => {
    if (!taskTitle.trim()) return
    setTasks(old => [...old, { id: Date.now(), title: taskTitle.trim(), category: 'Personal', start: taskStart, end: taskEnd, status: 'Not started' }])
    setTaskTitle('')
    setShowTaskForm(false)
    notify('Task added to this local preview')
  }
  const updateStatus = (id: number, status: TaskStatus) => {
    setTasks(old => old.map(task => task.id === id ? { ...task, status } : task))
    notify('Preview task status updated')
  }
  const updateQuest = (id: number) => setQuests(old => old.map(q => q.id === id ? { ...q, progress: Math.min(q.target, q.progress + 1) } : q))
  const nav = [
    { id: 'home' as const, label: 'Home', icon: Compass },
    { id: 'day' as const, label: 'My Day', icon: CalendarDays },
    { id: 'growth' as const, label: 'Growth World', icon: Map },
    { id: 'squad' as const, label: 'Squad', icon: Users },
    { id: 'insights' as const, label: 'Insights', icon: BarChart3 },
  ]

  if (showSignup) return <main className="signup-shell"><button className="back-link" onClick={() => setShowSignup(false)}>← Back to DAYLOCK</button><section className="signup-card"><div className="eyebrow">YOUR JOURNEY STARTS HERE</div><h1>Create your DAYLOCK account</h1><p>This GitHub starter is a frontend foundation. Real account creation will be connected in the authentication phase.</p><label>Display name<input placeholder="What should we call you?" /></label><label>Email address<input type="email" placeholder="you@example.com" /></label><label>Password<input type="password" placeholder="Create a password" /></label><button className="primary" onClick={() => notify('Authentication is not connected in this starter yet.')}>Create account <ArrowRight size={16}/></button><small>No account is created in this preview. Firebase setup is the next engineering stage.</small></section></main>

  return (
    <div className="app-shell">
      <aside className={mobileMenu ? 'sidebar open' : 'sidebar'}>
        <div className="brand"><div className="brand-mark">✦</div><div><b>DAYLOCK</b><span>Plan tonight. Execute tomorrow.</span></div><button className="close-menu" onClick={() => setMobileMenu(false)}><X size={18}/></button></div>
        <div className="side-caption">YOUR COMMAND CENTRE</div>
        <nav>{nav.map(item => <button key={item.id} className={screen === item.id ? 'nav-item active' : 'nav-item'} onClick={() => goScreen(item.id)}><item.icon size={18}/>{item.label}{screen === item.id && <span className="nav-dot"/>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="realm-mini"><Sprout/><div><b>Explorer</b><span>{demo ? 'Demo profile' : 'Fresh beginning'}</span></div><span className="level">Lv. 1</span></div><div className="side-note"><ShieldCheck size={15}/> Your private journey</div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><button className="mobile-menu" onClick={() => setMobileMenu(true)}><Menu/></button><div className="crumb">DAYLOCK <span>/</span> {nav.find(n => n.id === screen)?.label}</div><div className="top-actions"><div className="search-box"><Search size={15}/><span>Search your world</span><kbd>⌘ K</kbd></div><button className="icon-button" aria-label="Notifications"><Bell size={18}/></button><button className="icon-button" aria-label="Settings"><Settings size={18}/></button></div></header>
        {screen === 'home' && <div className="content">
          <section className="hero-panel"><div className="hero-copy"><div className="eyebrow"><span className="pulse"/> {demo ? 'DEMO JOURNEY' : 'A FRESH BEGINNING'}</div><h1>Make room for<br/><em>your next chapter.</em></h1><p>Plan tomorrow with intention. Show up for today. Let the small wins become your story.</p><div className="hero-actions"><button className="primary" onClick={() => goScreen('day')}>Plan tomorrow <ArrowRight size={16}/></button><button className="secondary" onClick={() => goScreen('growth')}>Explore Growth World <Compass size={16}/></button></div></div><div className="hero-art"><div className="sun-orb"/><div className="mountain mountain-back"/><div className="mountain mountain-front"/><div className="floating-island"><div className="island-castle">✧</div></div><div className="hero-quote">“A little progress, every day.”</div></div></section>
          <div className="welcome-row"><div><div className="eyebrow">TUESDAY · {date.toUpperCase()}</div><h2>{demo ? 'Welcome back, Explorer.' : 'Your journey begins here.'}</h2><p>{demo ? 'A safe sample world to explore.' : 'Start with one plan. Build momentum at your pace.'}</p></div><div className="fresh-pill"><Sparkles size={16}/> {demo ? 'Demo mode · sample data' : 'Level 1 · 0 XP'}</div></div>
          <section className="stat-grid"><Stat icon={<Flame/>} label="Current streak" value={demo ? '4 days' : '0 days'} sub="Consistency over perfection"/><Stat icon={<Trophy/>} label="Journey XP" value={demo ? '840' : '0'} sub="Earned through completed goals"/><Stat icon={<Target/>} label="Today's progress" value={demo ? '2 / 3' : '0 / 0'} sub={demo ? 'Sample tasks' : 'No plan recorded yet'}/></section>
          <section className="home-grid"><div className="panel schedule-panel"><PanelTitle icon={<CalendarDays/>} title="The day, thoughtfully planned" action="Open My Day" onAction={() => goScreen('day')}/>{(demo ? tasks : []).length ? (demo ? tasks : []).slice(0,3).map(t => <TaskRow key={t.id} task={t} onStatus={updateStatus}/>) : <Empty icon={<CalendarDays/>} title="A blank page, full of possibility." detail="Create tomorrow's first time block when you're ready." action="Build my timetable" onAction={() => goScreen('day')}/>}</div><div className="panel quest-panel"><PanelTitle icon={<Flag/>} title="Side quests" action="Explore" onAction={() => goScreen('growth')}/>{(demo ? quests : []).slice(0,3).map(q => <div className="quest-line" key={q.id}><div className="quest-icon"><Sparkles size={16}/></div><div className="quest-text"><b>{q.title}</b><span>{q.category} · {q.progress}/{q.target} {q.unit}</span><div className="progress-track"><i style={{width:`${q.progress/q.target*100}%`}}/></div></div></div>)}{!demo && <Empty icon={<Sprout/>} title="Your first quest is waiting." detail="Choose a small challenge for this week." action="Find a quest" onAction={() => goScreen('growth')}/>}</div></section>
          <section className="world-strip"><div className="world-heading"><div><div className="eyebrow">A WORLD THAT GROWS WITH YOU</div><h2>Growth World</h2><p>Five realms. Countless small beginnings.</p></div><button className="text-button" onClick={() => goScreen('growth')}>Enter the world <ArrowRight size={15}/></button></div><div className="zone-grid">{zones.slice(0,3).map(z => <ZoneCard key={z.name} zone={z} onClick={() => goScreen('growth')}/>)}</div></section>
        </div>}
        {screen === 'day' && <div className="content"><div className="page-heading"><div className="eyebrow">MAKE SPACE FOR WHAT MATTERS</div><h1>My Day</h1><p>Prepare tomorrow before midnight. Then let today be about showing up.</p></div><div className="day-toolbar"><div><span className="lock-bullet"><LockKeyhole size={15}/> Tomorrow's plan</span><small>Planning window · your local timezone</small></div><div className="toolbar-date">{new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(Date.now()+86400000))}</div></div><div className="panel schedule-panel"><PanelTitle icon={<CalendarDays/>} title="Tomorrow's timetable" action="Add a block" onAction={() => setShowTaskForm(true)}/>{tasks.length ? tasks.map(t => <TaskRow key={t.id} task={t} onStatus={updateStatus}/>) : <Empty icon={<CalendarDays/>} title="Nothing scheduled yet." detail="Start with one useful block. You can shape the rest later." action="Add your first block" onAction={() => setShowTaskForm(true)}/>}</div>{showTaskForm && <div className="modal-backdrop"><form className="task-form panel" onSubmit={e => {e.preventDefault();addTask()}}><button type="button" className="close-form" onClick={() => setShowTaskForm(false)}><X/></button><div className="eyebrow">TOMORROW · NEW TIME BLOCK</div><h2>Add a block</h2><label>What will you work on?<input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="e.g. Study, gym, project" required/></label><div className="time-fields"><label>Starts<input type="time" value={taskStart} onChange={e => setTaskStart(e.target.value)} required/></label><label>Ends<input type="time" value={taskEnd} onChange={e => setTaskEnd(e.target.value)} required/></label></div><button className="primary" type="submit">Add to tomorrow <Plus size={16}/></button></form></div>}</div>}
        {screen === 'growth' && <div className="content"><div className="page-heading"><div className="eyebrow">YOUR PERSONAL ADVENTURE</div><h1>Growth World</h1><p>Small quests. New skills. A life with more stories.</p></div><div className="world-banner"><div><div className="eyebrow">CHOOSE YOUR NEXT REALM</div><h2>Every path begins<br/>with one small step.</h2><p>Explore a realm and pick a challenge that feels right for you.</p></div><div className="world-sigil">✧</div></div><div className="zone-grid full">{zones.map(z => <ZoneCard key={z.name} zone={z} onClick={() => notify(`${z.name} selected — realm detail page is on the roadmap.`)}/>)}</div><div className="panel"><PanelTitle icon={<Flag/>} title="Quest board" action="Create quest" onAction={() => notify('Custom quest creation is planned for the next build stage.')}/><div className="filter-row">{['All','Knowledge','Social','Adventure','Wellness','Skill'].map(f => <button className={questFilter===f?'filter active':'filter'} key={f} onClick={() => setQuestFilter(f)}>{f}</button>)}</div>{(demo ? quests : []).filter(q => questFilter==='All'||q.category===questFilter).map(q => <div className="quest-board-row" key={q.id}><div className="quest-icon"><Flag size={17}/></div><div className="quest-text"><b>{q.title}</b><span>{q.category} · {q.progress}/{q.target} {q.unit}</span></div><button className="small-action" onClick={() => updateQuest(q.id)}>Add progress</button></div>)}{!demo && <Empty icon={<Sprout/>} title="Your quest board is empty." detail="Demo Mode includes sample quests. Your personal quests will live here once created."/>}</div></div>}
        {screen === 'squad' && <div className="content"><div className="page-heading"><div className="eyebrow">BETTER, TOGETHER</div><h1>Squad</h1><p>Friendly challenges, shared momentum and room to cheer each other on.</p></div><div className="squad-hero"><div><div className="eyebrow">YOUR PEOPLE, YOUR PACE</div><h2>Find your crew.</h2><p>Create a private squad or join friends with an invite code. Share only the progress you choose.</p><button className="primary" onClick={() => notify('Squad creation will be connected after authentication and database setup.')}>Create a squad <Plus size={16}/></button></div><div className="squad-emblem"><Users size={52}/></div></div><div className="panel"><PanelTitle icon={<Trophy/>} title="Weekly friendly race" /><Empty icon={<Swords/>} title="Your arena is waiting." detail="Squad leaderboards will use verified, opted-in progress. No private schedules are shared."/></div></div>}
        {screen === 'insights' && <div className="content"><div className="page-heading"><div className="eyebrow">LOOK HOW FAR YOU'VE COME</div><h1>Insights</h1><p>Progress is personal. Notice patterns, not perfection.</p></div><div className="stat-grid"><Stat icon={<CheckCircle2/>} label="Tasks completed" value={demo ? '2' : '0'} sub="This week"/><Stat icon={<Target/>} label="Completion rate" value={demo ? '67%' : '—'} sub="Based on recorded plans"/><Stat icon={<Flame/>} label="Current streak" value={demo ? '4 days' : '0 days'} sub="Completed days only"/></div><div className="panel chart-panel"><PanelTitle icon={<BarChart3/>} title="Weekly rhythm"/>{demo ? <div className="bars">{[35,58,42,76,62,24,48].map((v,i)=><div className="bar-column" key={i}><div className="bar-track"><i style={{height:`${v}%`}}/></div><small>{['M','T','W','T','F','S','S'][i]}</small></div>)}</div> : <Empty icon={<BarChart3/>} title="Your story is just beginning." detail="Insights appear as you record plans and complete tasks."/ >}</div></div>}
      </main>
      {toast && <div className="toast"><CheckCircle2 size={16}/>{toast}</div>}
      {mobileMenu && <button className="scrim" onClick={() => setMobileMenu(false)} aria-label="Close navigation"/>}
    </div>
  )
}

function Stat({icon,label,value,sub}:{icon:React.ReactNode;label:string;value:string;sub:string}) { return <div className="stat-card"><div className="stat-icon">{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-sub">{sub}</div></div> }
function PanelTitle({icon,title,action,onAction}:{icon:React.ReactNode;title:string;action?:string;onAction?:()=>void}) { return <div className="panel-title"><div>{icon}<h3>{title}</h3></div>{action&&<button className="text-button" onClick={onAction}>{action} <ArrowRight size={14}/></button>}</div> }
function Empty({icon,title,detail,action,onAction}:{icon:React.ReactNode;title:string;detail:string;action?:string;onAction?:()=>void}) { return <div className="empty-state"><div className="empty-icon">{icon}</div><b>{title}</b><p>{detail}</p>{action&&<button className="secondary small" onClick={onAction}>{action} <ArrowRight size={14}/></button>}</div> }
function TaskRow({task,onStatus}:{task:Task;onStatus:(id:number,status:TaskStatus)=>void}) { return <div className="task-row"><div className="task-time">{task.start}<span>—</span>{task.end}</div><div className="task-main"><b>{task.title}</b><span>{task.category}{task.note? ` · ${task.note}`:''}</span></div><select value={task.status} onChange={e => onStatus(task.id,e.target.value as TaskStatus)}><option>Not started</option><option>In progress</option><option>Completed</option><option>Skipped</option></select></div> }
function ZoneCard({zone,onClick}:{zone:typeof zones[number];onClick:()=>void}) { const Icon=zone.icon; return <button className={`zone-card ${zone.tone}`} onClick={onClick}><div className="zone-art"><div className="zone-glow"/><Icon size={31}/><span className="zone-spark">✦</span></div><div className="zone-info"><b>{zone.name}</b><span>{zone.sub}</span><div className="progress-track"><i style={{width:`${zone.progress}%`}}/></div><small>{zone.level} · {zone.progress}% explored</small></div><ChevronRight size={16}/></button> }
export default App
