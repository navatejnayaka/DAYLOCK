import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { User } from 'firebase/auth'
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  verifyBeforeUpdateEmail,
} from 'firebase/auth'
import { auth, authPersistenceReady, getDaylockMessaging, vapidPublicKey } from './firebase'
import { getToken } from 'firebase/messaging'
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, writeBatch, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import {
  AlertTriangle, ArrowRight, ArrowUpRight, BarChart3, BookOpen, CalendarDays, Check, History,
  ChevronRight, Clock3, Compass, Flame, Flag, HeartHandshake, Leaf,
  LockKeyhole, Menu, Mountain, Plus, Search, Settings, ShieldCheck,
  Sparkles, Sprout, Star, Target, Trophy, Users, X
} from 'lucide-react'
import './styles.css'

type Screen = 'home' | 'day' | 'growth' | 'squad' | 'insights'
type AuthMode = 'login' | 'signup' | 'reset'
type TaskStatus = 'Not started' | 'In progress' | 'Completed' | 'Skipped'
type Task = { id: number | string; title: string; category: string; start: string; end: string; status: TaskStatus; note?: string }
type Quest = { id: string | number; title: string; category: string; progress: number; target: number; unit: string; reward?: number }
type Habit = { id: string; title: string; category: string }
type InsightDay = { dateKey: string; label: string; totalTasks: number; completedTasks: number; habitCheckins: number }
type ReminderKey = 'planning' | 'hydration' | 'meal' | 'habit'
type ReminderSettings = Record<ReminderKey, { enabled: boolean; time: string }>
const defaultReminders: ReminderSettings = { planning: { enabled: true, time: '21:30' }, hydration: { enabled: false, time: '11:00' }, meal: { enabled: false, time: '13:00' }, habit: { enabled: false, time: '19:00' } }
const reminderLabels: Record<ReminderKey, { title: string; detail: string; message: string }> = {
  planning: { title: 'Plan tomorrow', detail: 'A gentle evening planning reminder', message: 'Take a few minutes to plan tomorrow in DAYLOCK.' },
  hydration: { title: 'Hydration', detail: 'A reminder to take a water break', message: 'Time for a water break. Stay comfortably hydrated.' },
  meal: { title: 'Meal reminder', detail: 'A flexible reminder for your meal routine', message: 'Meal-time check-in: take a break and have your planned meal.' },
  habit: { title: 'Daily habits', detail: 'Check in on the habits you chose', message: 'Your daily habit check-in is ready in DAYLOCK.' },
}

function normalizeQuests(items: Array<Record<string, unknown>>): Quest[] {
  return items.flatMap(item => {
    if (typeof item.title !== 'string' || typeof item.category !== 'string' || typeof item.progress !== 'number' || typeof item.target !== 'number' || typeof item.unit !== 'string') return []
    const target = Math.max(1, Math.min(1000, item.target))
    return [{ id: String(item.id || ''), title: item.title.slice(0, 100), category: item.category, progress: Math.max(0, Math.min(target, item.progress)), target, unit: item.unit.slice(0, 30) }]
  })
}

function localDateKey(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizeTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) return []
  const statuses: TaskStatus[] = ['Not started', 'In progress', 'Completed', 'Skipped']
  return value.slice(0, 100).flatMap((item): Task[] => {
    if (!item || typeof item !== 'object') return []
    const t = item as Record<string, unknown>
    if ((typeof t.id !== 'string' && typeof t.id !== 'number') || typeof t.title !== 'string' || typeof t.start !== 'string' || typeof t.end !== 'string') return []
    return [{ id: t.id, title: t.title.slice(0, 100), category: typeof t.category === 'string' ? t.category.slice(0, 40) : 'Personal', start: t.start, end: t.end, status: statuses.includes(t.status as TaskStatus) ? t.status as TaskStatus : 'Not started', ...(typeof t.note === 'string' ? { note: t.note.slice(0, 160) } : {}) }]
  })
}

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
const demoQuests: Quest[] = [
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
  const [dayTarget, setDayTarget] = useState<'today' | 'tomorrow'>('today')
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleExists, setScheduleExists] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [overrideTaskId, setOverrideTaskId] = useState('')
  const [overrideTitle, setOverrideTitle] = useState('')
  const [overrideStart, setOverrideStart] = useState('09:00')
  const [overrideEnd, setOverrideEnd] = useState('10:00')
  const [overrideReason, setOverrideReason] = useState('')
  const [showAuditHistory, setShowAuditHistory] = useState(false)
  const [auditHistory, setAuditHistory] = useState<Array<{id:string;reason:string;occurredAt:string;beforeTasks:Task[];afterTasks:Task[]}>>([])
  const [xpTotal, setXpTotal] = useState(0)
  const [level, setLevel] = useState(1)
  const [habits, setHabits] = useState<Habit[]>([])
  const [completedHabitIds, setCompletedHabitIds] = useState<string[]>([])
  const [habitsLoading, setHabitsLoading] = useState(false)
  const [habitSaving, setHabitSaving] = useState(false)
  const [showHabitForm, setShowHabitForm] = useState(false)
  const [habitTitle, setHabitTitle] = useState('')
  const [habitCategory, setHabitCategory] = useState('Wellness')
  const [weeklyInsights, setWeeklyInsights] = useState<InsightDay[]>([])
  const [currentStreak, setCurrentStreak] = useState(0)
  const [longestStreak, setLongestStreak] = useState(0)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [quests, setQuests] = useState<Quest[]>([])
  const [questFilter, setQuestFilter] = useState('All')
  const [questsLoading, setQuestsLoading] = useState(false)
  const [questSaving, setQuestSaving] = useState(false)
  const [showQuestForm, setShowQuestForm] = useState(false)
  const [questTitle, setQuestTitle] = useState('')
  const [questCategory, setQuestCategory] = useState('Knowledge')
  const [questTarget, setQuestTarget] = useState('1')
  const [questUnit, setQuestUnit] = useState('step')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskStart, setTaskStart] = useState('09:00')
  const [taskEnd, setTaskEnd] = useState('10:00')
  const [toast, setToast] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [emailChangeInput, setEmailChangeInput] = useState('')
  const [emailChangePassword, setEmailChangePassword] = useState('')
  const [emailChanging, setEmailChanging] = useState(false)
  const [exportingData, setExportingData] = useState(false)
  const [privacyShareDisplayName, setPrivacyShareDisplayName] = useState(true)
  const [privacySaving, setPrivacySaving] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)
  const [verificationSending, setVerificationSending] = useState(false)
  const [currentPasswordInput, setCurrentPasswordInput] = useState('')
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deletePhrase, setDeletePhrase] = useState('')
  const [accountDeleting, setAccountDeleting] = useState(false)
  const [reminders, setReminders] = useState<ReminderSettings>(defaultReminders)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('default')
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

  useEffect(() => { setProfileName(currentUser?.displayName || '') }, [currentUser?.uid, currentUser?.displayName])
  useEffect(() => { setEmailVerified(Boolean(currentUser?.emailVerified)) }, [currentUser?.uid, currentUser?.emailVerified])
  useEffect(() => {
    if (!currentUser || demo) { setPrivacyShareDisplayName(true); return }
    let active = true
    getDoc(doc(db, 'users', currentUser.uid, 'settings', 'privacy'))
      .then(snapshot => { if (active) setPrivacyShareDisplayName(snapshot.exists() ? snapshot.data().shareDisplayNameWithSquads !== false : true) })
      .catch(() => { if (active) notify('Could not load your privacy settings.') })
    return () => { active = false }
  }, [currentUser?.uid, demo])

  const saveProfile = async () => {
    if (!currentUser) { notify('Sign in to edit your profile.'); return }
    const name = profileName.trim()
    if (name.length < 2 || name.length > 40) { notify('Display name must be between 2 and 40 characters.'); return }
    setProfileSaving(true)
    try {
      await updateProfile(currentUser, { displayName: name })
      await currentUser.reload()
      setCurrentUser(auth.currentUser)
      notify('Profile updated successfully.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update your profile.')
    } finally { setProfileSaving(false) }
  }

  const resendVerificationEmail = async () => {
    if (!currentUser) return
    setVerificationSending(true)
    try {
      await sendEmailVerification(currentUser)
      notify('Verification email sent. Check your inbox and spam folder.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not send the verification email.')
    } finally { setVerificationSending(false) }
  }

  const refreshVerificationStatus = async () => {
    if (!currentUser) return
    try {
      await currentUser.reload()
      const verified = Boolean(auth.currentUser?.emailVerified)
      setEmailVerified(verified)
      notify(verified ? 'Email address verified successfully.' : 'Email is not verified yet. Open the link in your inbox first.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not refresh verification status.')
    }
  }

  const changeAccountEmail = async () => {
    if (!currentUser?.email) { notify('A signed-in email account is required.'); return }
    const nextEmail = emailChangeInput.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) { notify('Enter a valid new email address.'); return }
    if (nextEmail === currentUser.email.toLowerCase()) { notify('That is already your current email address.'); return }
    if (!emailChangePassword) { notify('Enter your current password to continue.'); return }
    setEmailChanging(true)
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, emailChangePassword)
      await reauthenticateWithCredential(currentUser, credential)
      await verifyBeforeUpdateEmail(currentUser, nextEmail)
      setEmailChangeInput('')
      setEmailChangePassword('')
      notify('Confirmation link sent to your new email address. Your login email changes after you open it.')
    } catch (error) {
      const code = (error as { code?: string })?.code || ''
      notify(code.includes('auth/wrong-password') || code.includes('auth/invalid-credential')
        ? 'Your current password is incorrect.'
        : error instanceof Error ? error.message : 'Could not start the email change.')
    } finally { setEmailChanging(false) }
  }

  const savePrivacyPreference = async (share: boolean) => {
    if (!currentUser) return
    setPrivacySaving(true)
    try {
      const memberships = await getDocs(collection(db, 'users', currentUser.uid, 'squads'))
      const refs = await Promise.all(memberships.docs.map(async membership => {
        const memberRef = doc(db, 'squads', membership.id, 'members', currentUser.uid)
        const memberSnap = await getDoc(memberRef)
        return memberSnap.exists() ? memberRef : null
      }))
      for (let start = 0; start < refs.length; start += 450) {
        const chunk = refs.slice(start, start + 450)
        const batch = writeBatch(db)
        chunk.forEach(ref => { if (ref) batch.update(ref, { displayName: share ? (currentUser.displayName?.trim() || 'DAYLOCK Member') : 'DAYLOCK Member' }) })
        if (chunk.some(Boolean)) await batch.commit()
      }
      await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'privacy'), {
        shareDisplayNameWithSquads: share,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setPrivacyShareDisplayName(share)
      notify(share ? 'Your display name is visible to your squad members.' : 'Your name is now hidden from squad member lists.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save your privacy preference.')
    } finally { setPrivacySaving(false) }
  }

  const exportAccountData = async () => {
    if (!currentUser) { notify('Sign in to export your data.'); return }
    setExportingData(true)
    try {
      const uid = currentUser.uid
      const [scheduleSnap, habitSnap, questSnap, progressSnap, xpSnap, habitDaySnap, squadSnap, reminderSnap, privacySnap] = await Promise.all([
        getDocs(collection(db, 'users', uid, 'schedules')),
        getDocs(collection(db, 'users', uid, 'habits')),
        getDocs(collection(db, 'users', uid, 'quests')),
        getDocs(collection(db, 'users', uid, 'progress')),
        getDocs(collection(db, 'users', uid, 'xpEvents')),
        getDocs(collection(db, 'users', uid, 'habitDays')),
        getDocs(collection(db, 'users', uid, 'squads')),
        getDocs(collection(db, 'users', uid, 'reminderSettings')),
        getDoc(doc(db, 'users', uid, 'settings', 'privacy')),
      ])
      const schedules = await Promise.all(scheduleSnap.docs.map(async item => {
        const audit = await getDocs(collection(db, 'users', uid, 'schedules', item.id, 'audit'))
        return { id: item.id, ...item.data(), audit: audit.docs.map(entry => ({ id: entry.id, ...entry.data() })) }
      }))
      const habits = await Promise.all(habitSnap.docs.map(async item => {
        const completions = await getDocs(collection(db, 'users', uid, 'habits', item.id, 'completions'))
        return { id: item.id, ...item.data(), completions: completions.docs.map(entry => ({ id: entry.id, ...entry.data() })) }
      }))
      const payload = {
        product: 'DAYLOCK',
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        account: { email: currentUser.email, displayName: currentUser.displayName, emailVerified: currentUser.emailVerified, uid },
        schedules,
        habits,
        quests: questSnap.docs.map(item => ({ id: item.id, ...item.data() })),
        progress: progressSnap.docs.map(item => ({ id: item.id, ...item.data() })),
        xpEvents: xpSnap.docs.map(item => ({ id: item.id, ...item.data() })),
        habitDays: habitDaySnap.docs.map(item => ({ id: item.id, ...item.data() })),
        squads: squadSnap.docs.map(item => ({ id: item.id, ...item.data() })),
        privacy: privacySnap.exists() ? privacySnap.data() : { shareDisplayNameWithSquads: true },
        reminders: reminderSnap.docs.map(item => {
          const data = item.data()
          return { id: item.id, timezone: data.timezone || null, reminders: data.reminders || null, updatedAt: data.updatedAt || null, deviceRegistered: Boolean(data.token) }
        }),
        privacyNote: 'Push notification tokens and authentication credentials are not included in this export.',
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'daylock-data-' + new Date().toISOString().slice(0, 10) + '.json'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      notify('Your DAYLOCK data export is ready.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not export your DAYLOCK data.')
    } finally { setExportingData(false) }
  }

  const changeAccountPassword = async () => {
    if (!currentUser?.email) { notify('A signed-in email account is required.'); return }
    if (newPasswordInput.length < 8) { notify('Your new password must contain at least 8 characters.'); return }
    if (newPasswordInput !== confirmNewPasswordInput) { notify('The new passwords do not match.'); return }
    if (currentPasswordInput === newPasswordInput) { notify('Choose a different password from your current one.'); return }
    setPasswordSaving(true)
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPasswordInput)
      await reauthenticateWithCredential(currentUser, credential)
      await updatePassword(currentUser, newPasswordInput)
      setCurrentPasswordInput('')
      setNewPasswordInput('')
      setConfirmNewPasswordInput('')
      notify('Your password has been changed successfully.')
    } catch (error) {
      const code = (error as { code?: string })?.code || ''
      notify(code.includes('auth/wrong-password') || code.includes('auth/invalid-credential')
        ? 'Your current password is incorrect.'
        : error instanceof Error ? error.message : 'Could not change your password.')
    } finally { setPasswordSaving(false) }
  }

  const cancelAccountDeletion = () => {
    setShowDeleteConfirm(false)
    setDeletePassword('')
    setDeletePhrase('')
  }

  const deleteAccount = async () => {
    if (!currentUser?.email) { notify('A signed-in email account is required for deletion.'); return }
    if (deletePhrase !== 'DELETE' || !deletePassword) { notify('Enter your password and type DELETE to confirm.'); return }
    setAccountDeleting(true)
    let dataCleaned = false
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, deletePassword)
      await reauthenticateWithCredential(currentUser, credential)
      const idToken = await currentUser.getIdToken(true)
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Account data cleanup could not be completed.')
      dataCleaned = true
      await deleteUser(currentUser)
      try { localStorage.removeItem('daylock-reminders-' + currentUser.uid) } catch { /* Local storage may be unavailable. */ }
      setCurrentUser(null)
      setDemo(false)
      setEnteredApp(false)
      setScreen('home')
      setShowSettings(false)
      notify('Your DAYLOCK account and saved data have been deleted.')
    } catch (error) {
      const code = (error as { code?: string })?.code || ''
      const message = code.includes('auth/wrong-password') || code.includes('auth/invalid-credential')
        ? 'That password was not accepted. Check it and try again.'
        : error instanceof Error ? error.message : 'Account deletion failed. Please try again.'
      notify(dataCleaned
        ? 'Your DAYLOCK data was cleared, but Firebase could not delete the login. Sign in again and contact support.'
        : message)
    } finally { setAccountDeleting(false) }
  }

  const reminderStorageKey = 'daylock-reminders-' + (currentUser?.uid || 'guest')
  useEffect(() => {
    try {
      const saved = localStorage.getItem(reminderStorageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ReminderSettings>
        setReminders({ planning: { ...defaultReminders.planning, ...parsed.planning }, hydration: { ...defaultReminders.hydration, ...parsed.hydration }, meal: { ...defaultReminders.meal, ...parsed.meal }, habit: { ...defaultReminders.habit, ...parsed.habit } })
      } else setReminders(defaultReminders)
    } catch { setReminders(defaultReminders) }
    setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported')
  }, [reminderStorageKey])

  useEffect(() => {
    try { localStorage.setItem(reminderStorageKey, JSON.stringify(reminders)) } catch { /* Storage may be unavailable in private browsing. */ }
  }, [reminderStorageKey, reminders])

  useEffect(() => {
    if (!enteredApp || demo) return
    const checkReminders = () => {
      const now = new Date()
      const dateKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
      const timeKey = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
      ;(Object.keys(reminders) as ReminderKey[]).forEach(key => {
        const reminder = reminders[key]
        if (!reminder.enabled || reminder.time !== timeKey) return
        const firedKey = 'daylock-reminder-fired-' + (currentUser?.uid || 'guest') + '-' + key
        if (localStorage.getItem(firedKey) === dateKey) return
        localStorage.setItem(firedKey, dateKey)
        const content = reminderLabels[key]
        if ('Notification' in window && Notification.permission === 'granted') new Notification('DAYLOCK · ' + content.title, { body: content.message, tag: 'daylock-' + key + '-' + dateKey })
        else setToast(content.title + ': ' + content.message)
      })
    }
    checkReminders()
    const timer = window.setInterval(checkReminders, 15000)
    return () => window.clearInterval(timer)
  }, [enteredApp, demo, currentUser?.uid, reminders])

  const saveReminderSettings = async () => {
    if (!currentUser) { notify('Sign in to sync reminders.'); return }
    try {
      if (!('Notification' in window)) throw new Error('Notifications are not supported in this browser.')
      if (Notification.permission !== 'granted') throw new Error('Enable notification permission first.')
      const messaging = await getDaylockMessaging()
      if (!messaging) throw new Error('Push notifications are not supported in this browser.')
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
      const token = await getToken(messaging, { vapidKey: vapidPublicKey, serviceWorkerRegistration: registration })
      if (!token) throw new Error('Could not register this device for push notifications.')
      const idToken = await currentUser.getIdToken()
      const response = await fetch('/api/reminders/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ token, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', reminders })
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not save background reminders.')
      notify('Background reminders saved for this device.')
      setShowSettings(false)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not enable background reminders.') }
  }
  const enableBrowserNotifications = async () => {
    if (!('Notification' in window)) { setNotificationPermission('unsupported'); return }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    notify(permission === 'granted' ? 'Permission enabled. Save settings to activate background reminders.' : permission === 'denied' ? 'Notifications are blocked in your browser settings.' : 'Notification permission was not granted.')
  }
  const authenticate = async (mode: AuthMode, email: string, password: string, displayName: string) => {
    await authPersistenceReady
    const normalizedEmail = email.trim().toLowerCase()

    if (mode === 'signup') {
      const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password)
      if (displayName.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() })
      }
      try {
        await sendEmailVerification(credential.user)
        notify('Verification email sent. Check your inbox and spam folder.')
      } catch {
        notify('Account created. You can resend the verification email from Settings.')
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

  useEffect(() => {
    if (!currentUser || demo) return
    let active = true
    const dateKey = localDateKey(dayTarget === 'today' ? 0 : 1)
    setScheduleLoading(true)
    setScheduleExists(false)
    setTasks([])
    getDoc(doc(db, 'users', currentUser.uid, 'schedules', dateKey))
      .then(snapshot => {
        if (!active) return
        setScheduleExists(snapshot.exists())
        setTasks(snapshot.exists() ? normalizeTasks(snapshot.data().tasks) : [])
      })
      .catch(() => { if (active) notify('Could not load this timetable. Check your connection and try again.') })
      .finally(() => { if (active) setScheduleLoading(false) })
    return () => { active = false }
  }, [currentUser?.uid, demo, dayTarget])

  const persistSchedule = async (nextTasks: Task[]) => {
    if (!currentUser) throw new Error('Please sign in to save your timetable.')
    const dateKey = localDateKey(dayTarget === 'today' ? 0 : 1)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const idToken = await currentUser.getIdToken()
    const response = await fetch('/api/schedules/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ dateKey, timezone, tasks: nextTasks }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'The schedule could not be saved.')
  }
  useEffect(() => {
    if (!currentUser || demo) {
      if (demo) { setXpTotal(0); setLevel(1) }
      return
    }
    let active = true
    getDoc(doc(db, 'users', currentUser.uid, 'progress', 'stats'))
      .then(snapshot => {
        if (!active) return
        const data = snapshot.exists() ? snapshot.data() : {}
        const total = Number(data.xpTotal || 0)
        setXpTotal(Number.isFinite(total) && total >= 0 ? total : 0)
        setLevel(Math.max(1, Number(data.level || 1)))
      })
      .catch(() => { if (active) notify('Could not load your XP balance.') })
    return () => { active = false }
  }, [currentUser?.uid, demo])

  useEffect(() => {
    if (!currentUser || demo) {
      if (demo) {
        setHabits([
          { id: 'demo-habit-1', title: 'Drink water regularly', category: 'Wellness' },
          { id: 'demo-habit-2', title: 'Read for 15 minutes', category: 'Knowledge' },
        ])
        setCompletedHabitIds([])
      }
      return
    }
    let active = true
    const dateKey = localDateKey(0)
    setHabits([])
    setCompletedHabitIds([])
    setHabitsLoading(true)
    getDocs(collection(db, 'users', currentUser.uid, 'habits'))
      .then(async snapshot => {
        const items = snapshot.docs.flatMap(item => {
          const data = item.data()
          if (typeof data.title !== 'string' || typeof data.category !== 'string') return []
          return [{ id: item.id, title: data.title.slice(0, 80), category: data.category.slice(0, 24) }]
        })
        const completionSnapshots = await Promise.all(items.map(item =>
          getDoc(doc(db, 'users', currentUser.uid, 'habits', item.id, 'completions', dateKey))
        ))
        if (!active) return
        setHabits(items)
        setCompletedHabitIds(items.filter((_, index) => completionSnapshots[index].exists()).map(item => item.id))
      })
      .catch(() => { if (active) notify('Could not load your daily habits. Please retry.') })
      .finally(() => { if (active) setHabitsLoading(false) })
    return () => { active = false }
  }, [currentUser?.uid, demo])

  useEffect(() => {
    if (!currentUser || demo) return
    let active = true
    setQuests([])
    setQuestsLoading(true)
    getDocs(collection(db, 'users', currentUser.uid, 'quests'))
      .then(snapshot => {
        if (active) setQuests(normalizeQuests(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))))
      })
      .catch(() => { if (active) notify('Could not load your Growth World quests. Please retry.') })
      .finally(() => { if (active) setQuestsLoading(false) })
    return () => { active = false }
  }, [currentUser?.uid, demo])


  useEffect(() => {
    if (screen !== 'insights') return
    if (demo) {
      const sample = [
        { tasks: [3, 2], habits: 1 },
        { tasks: [4, 3], habits: 2 },
        { tasks: [2, 2], habits: 1 },
        { tasks: [4, 3], habits: 2 },
        { tasks: [3, 2], habits: 1 },
        { tasks: [2, 1], habits: 2 },
        { tasks: [3, 2], habits: 2 },
      ]
      setCurrentStreak(3)
      setLongestStreak(7)
      setWeeklyInsights(Array.from({ length: 7 }, (_, index) => ({
        dateKey: localDateKey(index - 6),
        label: new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(new Date(localDateKey(index - 6) + 'T12:00:00')),
        totalTasks: sample[index].tasks[0],
        completedTasks: sample[index].tasks[1],
        habitCheckins: sample[index].habits,
      })))
      return
    }
    if (!currentUser) {
      setWeeklyInsights([])
      setCurrentStreak(0)
      setLongestStreak(0)
      return
    }

    let active = true
    const dateKeys = Array.from({ length: 7 }, (_, index) => localDateKey(index - 6))
    const todayKey = localDateKey(0)
    const yesterdayKey = localDateKey(-1)
    Promise.all([todayKey, yesterdayKey].map(dateKey => getDoc(doc(db, 'users', currentUser.uid, 'habitDays', dateKey))))
      .then(([todaySnapshot, yesterdaySnapshot]) => {
        if (!active) return
        const streakData = todaySnapshot.exists() ? todaySnapshot.data() : yesterdaySnapshot.exists() ? yesterdaySnapshot.data() : {}
        setCurrentStreak(Number(streakData.currentStreak || 0))
        setLongestStreak(Number(streakData.longestStreak || 0))
      })
      .catch(() => { if (active) notify('Could not load your habit streak.') })
    setInsightsLoading(true)
    Promise.all([
      Promise.all(dateKeys.map(dateKey => getDoc(doc(db, 'users', currentUser.uid, 'schedules', dateKey)))),
      getDocs(collection(db, 'users', currentUser.uid, 'habits')),
    ])
      .then(async ([scheduleSnapshots, habitSnapshot]) => {
        const habitIds = habitSnapshot.docs.map(item => item.id)
        const completionMatrix = await Promise.all(habitIds.map(habitId =>
          Promise.all(dateKeys.map(dateKey =>
            getDoc(doc(db, 'users', currentUser.uid, 'habits', habitId, 'completions', dateKey))
          ))
        ))
        if (!active) return
        const days = dateKeys.map((dateKey, index) => {
          const schedule = scheduleSnapshots[index].exists() ? scheduleSnapshots[index].data() : {}
          const tasks = Array.isArray(schedule.tasks) ? schedule.tasks as Array<{ status?: string }> : []
          const completedTasks = tasks.filter(task => task.status === 'Completed').length
          const habitCheckins = completionMatrix.filter(records => records[index]?.exists()).length
          const dayDate = new Date(dateKey + 'T12:00:00')
          return {
            dateKey,
            label: new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(dayDate),
            totalTasks: tasks.length,
            completedTasks,
            habitCheckins,
          }
        })
        setWeeklyInsights(days)
      })
      .catch(() => {
        if (active) notify('Could not load your weekly insights. Please try again.')
      })
      .finally(() => {
        if (active) setInsightsLoading(false)
      })

    return () => { active = false }
  }, [screen, currentUser?.uid, demo])

  const createHabit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = habitTitle.trim()
    if (!title || habitSaving) return
    if (title.length > 80) { notify('Habit names must be 80 characters or fewer.'); return }
    if (demo) {
      setHabits(old => [...old, { id: `demo-habit-${Date.now()}`, title, category: habitCategory }])
      setHabitTitle('')
      setShowHabitForm(false)
      notify('Habit added to the demo.')
      return
    }
    if (!currentUser) return
    setHabitSaving(true)
    try {
      const ref = await addDoc(collection(db, 'users', currentUser.uid, 'habits'), {
        title,
        category: habitCategory,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setHabits(old => [...old, { id: ref.id, title, category: habitCategory }])
      setHabitTitle('')
      setShowHabitForm(false)
      notify('Daily habit saved.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save this habit. Check Firestore rules.')
    } finally {
      setHabitSaving(false)
    }
  }

  const completeHabit = async (habitId: string) => {
    if (completedHabitIds.includes(habitId) || habitSaving) return
    if (demo) {
      setCompletedHabitIds(old => [...old, habitId])
      setXpTotal(old => {
        const next = old + 5
        setLevel(Math.floor(next / 100) + 1)
        return next
      })
      notify('Habit completed · +5 XP')
      return
    }
    if (!currentUser) return
    setHabitSaving(true)
    try {
      const idToken = await currentUser.getIdToken()
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const response = await fetch('/api/habits/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ habitId, timezone }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not mark this habit complete.')
      setCompletedHabitIds(old => old.includes(habitId) ? old : [...old, habitId])
      if (typeof result.xpTotal === 'number') setXpTotal(result.xpTotal)
      if (typeof result.level === 'number') setLevel(result.level)
      notify(result.alreadyCompleted ? 'This habit is already complete for today.' : `Habit completed · +${result.xpAwarded || 0} XP`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save today\'s habit.')
    } finally {
      setHabitSaving(false)
    }
  }

  const createQuest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!questTitle.trim() || !currentUser || questSaving) return
    const target = Number(questTarget)
    const unit = questUnit.trim()
    if (!Number.isInteger(target) || target < 1 || target > 1000) { notify('Choose a target from 1 to 1000.'); return }
    if (!unit || unit.length > 30) { notify('Enter a short progress unit.'); return }
    if (demo) {
      setQuests(old => [...old, { id: `demo-${Date.now()}`, title: questTitle.trim(), category: questCategory, progress: 0, target, unit }])
      setShowQuestForm(false)
      setQuestTitle('')
      notify('Quest added to the isolated demo.')
      return
    }
    setQuestSaving(true)
    try {
      const ref = await addDoc(collection(db, 'users', currentUser.uid, 'quests'), {
        title: questTitle.trim(), category: questCategory, progress: 0, target, unit,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      setQuests(old => [...old, { id: ref.id, title: questTitle.trim(), category: questCategory, progress: 0, target, unit }])
      setShowQuestForm(false)
      setQuestTitle('')
      setQuestTarget('1')
      setQuestUnit('step')
      notify('Quest saved to your Growth World.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save this quest. Check Firestore rules.')
    } finally {
      setQuestSaving(false)
    }
  }

  const updateQuest = async (id: string | number) => {
    const quest = quests.find(item => String(item.id) === String(id))
    if (!quest || quest.progress >= quest.target || questSaving) return
    if (demo) {
      setQuests(old => old.map(item => item.id === id ? { ...item, progress: Math.min(item.target, item.progress + 1) } : item))
      return
    }
    if (!currentUser) return
    setQuestSaving(true)
    try {
      const idToken = await currentUser.getIdToken()
      const response = await fetch('/api/quests/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ questId: String(id) }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not update quest progress.')
      const next = Number(result.progress)
      setQuests(old => old.map(item => String(item.id) === String(id) ? { ...item, progress: next } : item))
      const total = Number(result.xpTotal || 0)
      setXpTotal(Number.isFinite(total) ? total : 0)
      setLevel(Math.max(1, Number(result.level || 1)))
      if (Number(result.xpAwarded) > 0) notify(`Quest completed! +${result.xpAwarded} XP · Level ${result.level}`)
      else notify('Quest progress saved.')
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update quest progress.')
    } finally {
      setQuestSaving(false)
    }
  }

  const loadAuditHistory = async () => {
    if (!currentUser) return
    const dateKey = localDateKey(dayTarget === 'today' ? 0 : 1)
    try {
      const snapshot = await getDocs(collection(db, 'users', currentUser.uid, 'schedules', dateKey, 'audit'))
      const records = snapshot.docs.map(item => {
        const data = item.data()
        return {
          id: item.id,
          reason: String(data.reason || ''),
          occurredAt: String(data.occurredAt || ''),
          beforeTasks: normalizeTasks(data.beforeTasks),
          afterTasks: normalizeTasks(data.afterTasks),
        }
      }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      setAuditHistory(records)
      setShowAuditHistory(true)
    } catch {
      notify('Could not load audit history. Check that the latest Firestore rules are published.')
    }
  }

  const openEmergencyOverride = () => {
    if (!tasks.length) { notify('There are no saved tasks to amend today.'); return }
    const first = tasks[0]
    setOverrideTaskId(String(first.id))
    setOverrideTitle(first.title)
    setOverrideStart(first.start)
    setOverrideEnd(first.end)
    setOverrideReason('')
    setShowOverrideForm(true)
  }

  const saveEmergencyOverride = async () => {
    if (!currentUser) { notify('Please sign in again.'); return }
    if (overrideReason.trim().length < 10) { notify('Please explain the emergency in at least 10 characters.'); return }
    if (!overrideTitle.trim()) { notify('Enter a task title.'); return }
    if (overrideEnd <= overrideStart) { notify('Choose an end time after the start time.'); return }
    const nextTasks = tasks.map(task => String(task.id) === overrideTaskId
      ? { ...task, title: overrideTitle.trim(), start: overrideStart, end: overrideEnd }
      : task).sort((a, b) => a.start.localeCompare(b.start))
    if (nextTasks.every((task, index) => task.id === tasks[index]?.id && task.title === tasks[index]?.title && task.start === tasks[index]?.start && task.end === tasks[index]?.end)) {
      notify('Change a task detail before submitting the override.')
      return
    }
    setScheduleSaving(true)
    try {
      const dateKey = localDateKey(0)
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const idToken = await currentUser.getIdToken()
      const response = await fetch('/api/schedules/override', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ dateKey, timezone, tasks: nextTasks, reason: overrideReason.trim() }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Emergency amendment failed.')
      setTasks(normalizeTasks(result.tasks))
      setShowOverrideForm(false)
      setOverrideReason('')
      notify('Emergency amendment saved. Original and amended schedules were recorded.')
      await loadAuditHistory()
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Emergency amendment failed. Please retry.')
    } finally {
      setScheduleSaving(false)
    }
  }

  const openDemo = () => {
    setDemo(true)
    setTasks(demoTasks)
    setHabits([{ id: 'demo-habit-1', title: 'Drink water regularly', category: 'Wellness' }, { id: 'demo-habit-2', title: 'Read for 15 minutes', category: 'Knowledge' }])
    setCompletedHabitIds([])
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
  const addTask = async () => {
    if (!taskTitle.trim() || scheduleLoading || scheduleSaving) return
    if (!demo && dayTarget === 'today') { notify('Today is sealed. You can only update task statuses.'); return }
    if (taskEnd <= taskStart) { notify('Choose an end time that is after the start time.'); return }
    const nextTasks = [...tasks, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: taskTitle.trim(), category: 'Personal', start: taskStart, end: taskEnd, status: 'Not started' as const }].sort((a,b) => a.start.localeCompare(b.start))
    if (demo) { setTasks(nextTasks); notify('Added to the isolated demo.') }
    else {
      setScheduleSaving(true)
      try { await persistSchedule(nextTasks); setTasks(nextTasks); notify('Saved to your DAYLOCK account.') }
      catch (error) { notify(error instanceof Error ? error.message : 'Could not save. Please retry.') }
      finally { setScheduleSaving(false) }
    }
    setTaskTitle('')
    setShowTaskForm(false)
  }
  const updateStatus = async (id: number | string, status: TaskStatus) => {
    if (scheduleLoading || scheduleSaving) return
    const nextTasks = tasks.map(task => task.id === id ? { ...task, status } : task)
    if (demo) { setTasks(nextTasks); notify('Demo task updated · no XP is awarded.'); return }
    setScheduleSaving(true)
    try { await persistSchedule(nextTasks); setTasks(nextTasks); notify('Task status saved.') }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save the status. Please retry.') }
    finally { setScheduleSaving(false) }
  }
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
        <header className="topbar"><button className="mobile-menu" onClick={() => setMobileMenu(true)}><Menu/></button><div className="crumb">DAYLOCK <span>/</span> {nav.find(item => item.id === screen)?.label}</div><div className="top-actions"><div className="demo-pill"><span/> {demo ? 'ISOLATED DEMO' : 'ACCOUNT ACTIVE'}</div><button className="icon-button" aria-label="Search"><Search size={17}/></button><button className="icon-button" aria-label="Settings" onClick={() => setShowSettings(true)}><Settings size={18}/></button></div></header>
        {screen === 'home' && <div className="content">
          <section className="hero-panel"><div className="hero-copy"><div className="eyebrow"><span className="pulse"/> YOUR NEXT CHAPTER BEGINS</div><h1>Make room for<br/><em>your next chapter.</em></h1><p>Plan tomorrow with intention. Show up for today. Let the small wins become your story.</p><div className="hero-actions"><button className="primary" onClick={() => { setDayTarget('tomorrow'); goScreen('day') }}>Plan tomorrow <ArrowRight size={16}/></button><button className="secondary" onClick={() => goScreen('growth')}>Explore Growth World <Compass size={16}/></button></div></div><HeroLandscape/></section>
          <div className="welcome-row"><div><div className="eyebrow">{today.toUpperCase()} · DAILY CHECK-IN</div><h2>{demo ? 'Welcome, Explorer.' : `Welcome, ${currentUser?.displayName || currentUser?.email?.split('@')[0] || 'there'}.`}</h2><p>{demo ? 'A safe sample world to explore.' : 'Your personal DAYLOCK account is ready. Start by planning tomorrow.'}</p></div><div className="fresh-pill"><Sparkles size={16}/> {demo ? 'Sample profile · Level 1' : `Level ${level} · ${xpTotal} XP`}</div></div>
          <section className="stat-grid"><Stat icon={<Flame/>} label="Current streak" value={demo ? '4 sample days' : '0 days'} sub={demo ? 'Illustrative demo data' : 'Your journey starts today'}/><Stat icon={<Trophy/>} label="Journey XP" value={demo ? '840 sample XP' : `${xpTotal} XP`} sub={demo ? 'Illustrative demo data' : `Level ${level} · Saved to your account`}/><Stat icon={<Target/>} label={dayTarget === 'today' ? "Today's progress" : "Tomorrow's progress"} value={`${completed} / ${tasks.length}`} sub={demo ? "Isolated demo activity" : "Your saved timetable"}/></section>
          <section className="home-grid"><div className="panel schedule-panel"><PanelTitle icon={<CalendarDays/>} title="A day with intention" action="Open My Day" onAction={() => goScreen('day')}/>{tasks.slice(0,3).map(task => <TaskRow key={task.id} task={task} onStatus={updateStatus}/>)}<div className="panel-footnote">{demo ? "Demo timetable · changes reset when you leave" : "Account timetable · saved to your DAYLOCK profile"}</div></div><div className="panel quest-panel"><PanelTitle icon={<Flag/>} title="Side quests" action="Explore" onAction={() => goScreen('growth')}/>{quests.slice(0,3).map(quest => <QuestLine key={quest.id} quest={quest}/>)}<button className="text-button" onClick={() => goScreen('growth')}>Explore all quests <ArrowRight size={14}/></button></div></section>
          <section className="world-strip"><div className="world-heading"><div><div className="eyebrow">A WORLD THAT GROWS WITH YOU</div><h2>Five realms. One evolving you.</h2><p>Explore a new path, practise a skill or celebrate a small win.</p></div><button className="text-button" onClick={() => goScreen('growth')}>Enter the world <ArrowRight size={15}/></button></div><div className="zone-grid">{zoneData.slice(0,3).map(zone => <ZoneCard key={zone.name} zone={zone} onClick={() => goScreen('growth')}/>)}</div></section>
        </div>}
        {screen === 'day' && <div className="content"><div className="page-heading"><div className="eyebrow">MAKE SPACE FOR WHAT MATTERS</div><h1>My Day</h1><p>Plan ahead, then focus on following through.</p></div><div className="day-toolbar"><div><span className="lock-bullet"><LockKeyhole size={15}/> {dayTarget === 'today' ? "Today's plan" : "Tomorrow's plan"}</span><small>{demo ? 'Isolated demo · changes are not saved.' : dayTarget === 'today' ? 'Sealed by the server. You can update task statuses, but not task details.' : 'Tomorrow is editable until midnight in your timezone. The server enforces the lock.'}</small><div className="day-tabs"><button className={dayTarget === 'today' ? 'day-tab active' : 'day-tab'} onClick={() => { setShowTaskForm(false); setDayTarget('today') }}>Today</button><button className={dayTarget === 'tomorrow' ? 'day-tab active' : 'day-tab'} onClick={() => { setShowTaskForm(false); setDayTarget('tomorrow') }}>Tomorrow</button></div></div><div className="toolbar-date">{new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(Date.now()+(dayTarget === 'today' ? 0 : 86400000)))}</div></div><div className="panel schedule-panel"><PanelTitle icon={<CalendarDays/>} title={dayTarget === 'today' ? "Today's timetable" : "Tomorrow's timetable"} action={demo || dayTarget === 'tomorrow' ? "Add a block" : undefined} onAction={() => setShowTaskForm(true)}/>{scheduleLoading ? <div className="empty-state"><b>Loading your timetable…</b></div> : tasks.length ? tasks.map(task => <TaskRow key={task.id} task={task} onStatus={updateStatus}/>) : <Empty icon={<CalendarDays/>} title="Nothing scheduled yet." detail="Start with one useful block. You can shape the rest later." action={demo || dayTarget === 'tomorrow' ? "Add your first block" : undefined} onAction={() => setShowTaskForm(true)} />}{scheduleSaving && <div className="panel-footnote">Saving your changes…</div>}</div>{!demo && dayTarget === 'today' && scheduleExists && <div className="emergency-actions"><button className="secondary" onClick={openEmergencyOverride}><AlertTriangle size={15}/> Emergency override</button><button className="text-button" onClick={loadAuditHistory}><History size={15}/> View audit history</button></div>}{showAuditHistory && <div className="panel audit-panel"><PanelTitle icon={<History/>} title="Emergency audit history" action="Close" onAction={() => setShowAuditHistory(false)}/>{auditHistory.length ? auditHistory.map(record => <article className="audit-entry" key={record.id}><div className="audit-entry-top"><b>Emergency amendment</b><time>{record.occurredAt ? new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(record.occurredAt)) : 'Timestamp unavailable'}</time></div><p><strong>Reason:</strong> {record.reason}</p><details><summary>View preserved before/after snapshots</summary><div className="audit-snapshots"><div><b>Original</b>{record.beforeTasks.map(task => <span key={task.id}>{task.start}–{task.end} · {task.title}</span>)}</div><div><b>Amended</b>{record.afterTasks.map(task => <span key={task.id}>{task.start}–{task.end} · {task.title}</span>)}</div></div></details></article>) : <div className="empty-state"><b>No emergency amendments recorded.</b><p>Every approved emergency change will appear here.</p></div>}</div>}{showOverrideForm && <div className="modal-backdrop"><form className="task-form panel override-form" onSubmit={event => {event.preventDefault();void saveEmergencyOverride()}}><button type="button" className="close-form" onClick={() => setShowOverrideForm(false)}><X/></button><div className="eyebrow">SEALED SCHEDULE · AUDITED CHANGE</div><h2>Emergency override</h2><p className="override-explainer">Use this only when an important unexpected event requires a change. The original timetable will remain in the audit history.</p><label>Task to amend<select value={overrideTaskId} onChange={event => {const task=tasks.find(item=>String(item.id)===event.target.value);setOverrideTaskId(event.target.value);if(task){setOverrideTitle(task.title);setOverrideStart(task.start);setOverrideEnd(task.end)}}}>{tasks.map(task=><option key={task.id} value={String(task.id)}>{task.start} · {task.title}</option>)}</select></label><label>Updated task title<input value={overrideTitle} onChange={event=>setOverrideTitle(event.target.value)} required maxLength={100}/></label><div className="time-fields"><label>Starts<input type="time" value={overrideStart} onChange={event=>setOverrideStart(event.target.value)} required/></label><label>Ends<input type="time" value={overrideEnd} onChange={event=>setOverrideEnd(event.target.value)} required/></label></div><label>Reason for emergency change<textarea value={overrideReason} onChange={event=>setOverrideReason(event.target.value)} placeholder="Explain what changed and why this amendment is necessary…" minLength={10} maxLength={500} required rows={3}/></label><button className="primary" type="submit" disabled={scheduleSaving}>{scheduleSaving ? 'Recording amendment…' : 'Confirm emergency override'} <AlertTriangle size={15}/></button></form></div>}{showTaskForm && <div className="modal-backdrop"><form className="task-form panel" onSubmit={event => {event.preventDefault();void addTask()}}><button type="button" className="close-form" onClick={() => setShowTaskForm(false)}><X/></button><div className="eyebrow">{dayTarget.toUpperCase()} · NEW TIME BLOCK</div><h2>Add a block</h2><label>What will you work on?<input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="e.g. Study, project, reading" required maxLength={100}/></label><div className="time-fields"><label>Starts<input type="time" value={taskStart} onChange={event => setTaskStart(event.target.value)} required/></label><label>Ends<input type="time" value={taskEnd} onChange={event => setTaskEnd(event.target.value)} required/></label></div><button className="primary" type="submit" disabled={scheduleLoading || scheduleSaving}>{scheduleSaving ? 'Saving…' : 'Save time block'} <Plus size={16}/></button></form></div>}</div>}
        {screen === 'growth' && <div className="content"><div className="page-heading"><div className="eyebrow">YOUR PERSONAL ADVENTURE</div><h1>Growth World</h1><p>Small quests. New skills. A life with more stories.</p><div className="eyebrow">LEVEL {level} · {xpTotal} XP EARNED</div></div><div className="world-banner"><div><div className="eyebrow">CHOOSE YOUR NEXT REALM</div><h2>Every path begins<br/>with one small step.</h2><p>Explore a realm and pick a challenge that feels right for you.</p></div><div className="world-sigil">✧</div></div><div className="zone-grid full">{zoneData.map(zone => <ZoneCard key={zone.name} zone={zone} onClick={() => {setQuestFilter(zone.name==='Discipline Forest'?'Wellness':zone.name==='Knowledge Tower'?'Knowledge':zone.name==='Social Harbor'?'Social':zone.name==='Adventure Isles'?'Adventure':'Skill');notify(`${zone.name} · matching quests selected below.`)}}/>)}</div><div className="panel"><PanelTitle icon={<Sprout/>} title="Daily habits" action="Add habit" onAction={() => setShowHabitForm(true)}/><p className="panel-footnote">Small actions you can check off once each day. Your check-ins are saved to your account.</p>{habitsLoading ? <div className="empty-state"><b>Loading your habits…</b></div> : habits.length ? habits.map(habit => <div className="quest-board-row" key={habit.id}><div className="quest-icon"><Sprout size={17}/></div><div className="quest-text"><b>{habit.title}</b><span>{habit.category} · {completedHabitIds.includes(habit.id) ? 'Completed today' : 'Not completed today'}</span></div><button className="small-action" onClick={() => void completeHabit(habit.id)} disabled={completedHabitIds.includes(habit.id) || habitSaving}>{completedHabitIds.includes(habit.id) ? 'Done today' : 'Mark done'}</button></div>) : <Empty icon={<Sprout/>} title="Start with one small habit." detail={demo ? 'Add a habit to try the daily check-in.' : 'Add a daily habit and mark it complete when you do it.'} action="Add your first habit" onAction={() => setShowHabitForm(true)}/>}</div>{showHabitForm && <div className="modal-backdrop"><form className="task-form panel quest-form" onSubmit={createHabit}><button type="button" className="close-form" onClick={() => setShowHabitForm(false)}><X/></button><div className="eyebrow">GROWTH WORLD · DAILY RITUAL</div><h2>Add a daily habit</h2><label>Habit name<input value={habitTitle} onChange={event=>setHabitTitle(event.target.value)} placeholder="e.g. Walk for 15 minutes" maxLength={80} required/></label><label>Category<select value={habitCategory} onChange={event=>setHabitCategory(event.target.value)}><option>Wellness</option><option>Knowledge</option><option>Skill</option><option>Social</option><option>Personal</option></select></label><p className="override-explainer">Check off each habit once per day to earn 5 XP. Your daily check-ins and rewards are saved to your account.</p><button className="primary" type="submit" disabled={habitSaving}>{habitSaving ? 'Saving habit…' : 'Save daily habit'} <Plus size={16}/></button></form></div>}<div className="panel"><PanelTitle icon={<Flag/>} title="Quest board" action="Create quest" onAction={() => setShowQuestForm(true)}/><div className="filter-row">{['All','Knowledge','Social','Adventure','Wellness','Skill'].map(filter => <button className={questFilter===filter?'filter active':'filter'} key={filter} onClick={() => setQuestFilter(filter)}>{filter}</button>)}</div>{questsLoading ? <div className="empty-state"><b>Loading your quests…</b></div> : quests.filter(quest => questFilter==='All'||quest.category===questFilter).length ? quests.filter(quest => questFilter==='All'||quest.category===questFilter).map(quest => <div className="quest-board-row" key={quest.id}><div className="quest-icon"><Flag size={17}/></div><div className="quest-text"><b>{quest.title}</b><span>{quest.category} · {quest.progress}/{quest.target} {quest.unit}{quest.progress >= quest.target ? ' · Completed' : ''}</span><div className="progress-track"><i style={{width:`${quest.progress/quest.target*100}%`}}/></div></div><button className="small-action" onClick={() => void updateQuest(quest.id)} disabled={quest.progress>=quest.target || questSaving}>{quest.progress>=quest.target ? 'Completed' : 'Add progress'}</button></div>) : <Empty icon={<Flag/>} title="Your quest board is quiet." detail={demo ? "Create a sample quest to explore how progress works." : "Create your first personal quest. It will be saved to your account."} action="Create your first quest" onAction={() => setShowQuestForm(true)}/>}</div>{showQuestForm && <div className="modal-backdrop"><form className="task-form panel quest-form" onSubmit={createQuest}><button type="button" className="close-form" onClick={() => setShowQuestForm(false)}><X/></button><div className="eyebrow">GROWTH WORLD · NEW QUEST</div><h2>Create a quest</h2><label>Quest title<input value={questTitle} onChange={event=>setQuestTitle(event.target.value)} placeholder="e.g. Practise guitar" maxLength={100} required/></label><label>Realm / category<select value={questCategory} onChange={event=>setQuestCategory(event.target.value)}><option>Knowledge</option><option>Social</option><option>Adventure</option><option>Wellness</option><option>Skill</option></select></label><div className="time-fields"><label>Target count<input type="number" min="1" max="1000" value={questTarget} onChange={event=>setQuestTarget(event.target.value)} required/></label><label>Unit<input value={questUnit} onChange={event=>setQuestUnit(event.target.value)} placeholder="e.g. pages, sessions" maxLength={30} required/></label></div><p className="override-explainer">Progress is saved to your account. Completing a quest earns 25 XP; every 100 XP advances your level.</p><button className="primary" type="submit" disabled={questSaving}>{questSaving ? 'Saving quest…' : 'Save quest'} <Plus size={16}/></button></form></div>}</div>}
        {screen === 'squad' && currentUser && <SquadCenter user={currentUser} shareDisplayName={privacyShareDisplayName}/>} 
        {screen === 'insights' && <div className="content"><div className="page-heading"><div className="eyebrow">LOOK HOW FAR YOU'VE COME</div><h1>Insights</h1><p>Your real activity over the last seven days.</p></div><div className="stat-grid"><Stat icon={<Target/>} label="Tasks completed · 7 days" value={insightsLoading ? '…' : `${weeklyInsights.reduce((sum, day) => sum + day.completedTasks, 0)}`} sub={demo ? 'Illustrative demo activity' : `${weeklyInsights.reduce((sum, day) => sum + day.totalTasks, 0)} scheduled tasks found`}/><Stat icon={<Flame/>} label="Habit check-ins · 7 days" value={insightsLoading ? '…' : `${weeklyInsights.reduce((sum, day) => sum + day.habitCheckins, 0)}`} sub={demo ? 'Illustrative demo activity' : 'Saved daily habit completions'}/><Stat icon={<Flame/>} label="Current streak" value={demo ? '3 days' : `${currentStreak} days`} sub={demo ? 'Illustrative demo streak' : 'Consecutive days with a habit check-in'}/><Stat icon={<Trophy/>} label="Longest streak" value={demo ? '7 days' : `${longestStreak} days`} sub={demo ? 'Illustrative demo record' : 'Your best consecutive run'}/><Stat icon={<Trophy/>} label="Journey XP" value={demo ? '840 sample XP' : `${xpTotal} XP`} sub={demo ? 'Illustrative demo data' : `Level ${level} · Saved to your account`}/></div><div className="panel chart-panel"><PanelTitle icon={<BarChart3/>} title="Daily task completion · last 7 days"/>{insightsLoading ? <div className="empty-state"><b>Loading your activity…</b></div> : weeklyInsights.some(day => day.totalTasks > 0) ? <><div className="bars">{weeklyInsights.map(day => { const rate = day.totalTasks ? Math.round(day.completedTasks / day.totalTasks * 100) : 0; return <div className="bar-column" key={day.dateKey}><div className="bar-track" title={`${day.completedTasks} of ${day.totalTasks} tasks completed`}><i style={{height:`${rate}%`}}/></div><small>{day.label}</small></div> })}</div><div className="panel-footnote">Bars show the share of scheduled tasks marked Completed each day.</div></> : <div className="empty-state"><div className="empty-icon"><BarChart3/></div><b>No timetable activity yet.</b><p>Save a daily timetable and update task statuses to see your progress here.</p></div>}</div><div className="panel chart-panel"><PanelTitle icon={<Sprout/>} title="Daily habit check-ins · last 7 days"/>{insightsLoading ? <div className="empty-state"><b>Loading your habits…</b></div> : <div className="insight-days">{weeklyInsights.map(day => <div className="insight-day" key={day.dateKey}><span>{day.label}</span><b>{day.habitCheckins}</b><small>{day.habitCheckins === 1 ? 'habit' : 'habits'}</small></div>)}</div>}</div></div>}
      </main>
      {showSettings && <div className="modal-backdrop"><section className="task-form panel settings-form" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button type="button" className="close-form" onClick={() => setShowSettings(false)} aria-label="Close settings"><X/></button>
        <div className="eyebrow">YOUR ACCOUNT</div><h2>Profile settings</h2>
        <div className="profile-settings"><div className="email-verification"><div><b>Email verification</b><span className={emailVerified ? "verification-status is-verified" : "verification-status"}>{emailVerified ? "Verified" : "Not verified"}</span></div><div className="verification-actions"><button type="button" className="secondary" onClick={() => void resendVerificationEmail()} disabled={!currentUser || emailVerified || verificationSending}>{verificationSending ? "Sending…" : "Resend email"}</button><button type="button" className="secondary" onClick={() => void refreshVerificationStatus()} disabled={!currentUser}>Refresh status</button></div></div><label>Display name<input type="text" value={profileName} onChange={event => setProfileName(event.target.value)} minLength={2} maxLength={40} placeholder="Your display name"/></label><label>Email address<input type="email" value={currentUser?.email || ""} readOnly disabled/></label><button type="button" className="secondary" onClick={() => void saveProfile()} disabled={profileSaving || !currentUser || profileName.trim().length < 2}>{profileSaving ? "Saving…" : "Save profile"}</button></div>
        <div className="settings-divider"/>
        <div className="eyebrow">EMAIL</div><h2>Change email address</h2>
        <p className="override-explainer">We’ll send a confirmation link to your new address. Your sign-in email stays the same until you confirm it.</p>
        <div className="profile-settings">
          <label>New email address<input type="email" autoComplete="email" value={emailChangeInput} onChange={event => setEmailChangeInput(event.target.value)} placeholder="new-email@example.com"/></label>
          <label>Current password<input type="password" autoComplete="current-password" value={emailChangePassword} onChange={event => setEmailChangePassword(event.target.value)} placeholder="Confirm it's you"/></label>
          <button type="button" className="secondary" onClick={() => void changeAccountEmail()} disabled={emailChanging || !emailChangeInput.trim() || !emailChangePassword}>{emailChanging ? 'Sending confirmation…' : 'Send confirmation link'}</button>
        </div>
        <div className="settings-divider"/>
        <div className="eyebrow">ACCOUNT SECURITY</div><h2>Change password</h2>
        <div className="profile-settings password-settings">
          <label>Current password<input type="password" autoComplete="current-password" value={currentPasswordInput} onChange={event => setCurrentPasswordInput(event.target.value)} placeholder="Enter current password"/></label>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPasswordInput} onChange={event => setNewPasswordInput(event.target.value)} placeholder="At least 8 characters"/></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={confirmNewPasswordInput} onChange={event => setConfirmNewPasswordInput(event.target.value)} placeholder="Enter the new password again"/></label>
          <button type="button" className="secondary" onClick={() => void changeAccountPassword()} disabled={passwordSaving || !currentPasswordInput || newPasswordInput.length < 8 || !confirmNewPasswordInput}>{passwordSaving ? "Updating…" : "Update password"}</button>
        </div>
        <div className="settings-divider"/>
        <div className="settings-divider"/>
        <div className="eyebrow">PRIVACY CONTROLS</div><h2>Manage your data</h2>
        <div className="privacy-control-row"><div><b>Show my display name in Squads</b><p>When off, squad members see “DAYLOCK Member” instead of your profile name. Your timetables, notes and email remain private.</p></div><label className="privacy-switch"><input type="checkbox" checked={privacyShareDisplayName} disabled={privacySaving || !currentUser} onChange={event => void savePrivacyPreference(event.target.checked)}/><span>{privacySaving ? 'Saving…' : privacyShareDisplayName ? 'On' : 'Off'}</span></label></div>
        <div className="privacy-control-row"><div><b>Download a copy of my data</b><p>Export your timetables and audit history, habits, quests, XP activity, squad memberships and reminder preferences as JSON. Push tokens and passwords are excluded.</p></div><button type="button" className="secondary" onClick={() => void exportAccountData()} disabled={exportingData || !currentUser}>{exportingData ? 'Preparing…' : 'Export my data'}</button></div>
        <div className="settings-divider"/>
        <div className="eyebrow">PERSONALISE YOUR DAYLOCK</div><h2 id="settings-title">Reminder settings</h2>
        <p className="override-explainer">Background reminders can arrive while DAYLOCK is closed on this device. Times use your device local timezone.</p>
        <div className="notification-permission"><div><b>Browser notifications</b><span>{notificationPermission === "granted" ? "Enabled" : notificationPermission === "denied" ? "Blocked in browser settings" : notificationPermission === "unsupported" ? "Not supported by this browser" : "Permission not enabled"}</span></div><button type="button" className="secondary" onClick={() => void enableBrowserNotifications()} disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}>{notificationPermission === "granted" ? "Enabled" : "Enable"}</button></div>
        <div className="reminder-list">{(Object.keys(reminders) as ReminderKey[]).map(key => <div className="reminder-setting" key={key}><label className="reminder-toggle"><input type="checkbox" checked={reminders[key].enabled} onChange={event => setReminders(old => ({ ...old, [key]: { ...old[key], enabled: event.target.checked } }))}/><span><b>{reminderLabels[key].title}</b><small>{reminderLabels[key].detail}</small></span></label><input aria-label={reminderLabels[key].title + " time"} type="time" value={reminders[key].time} onChange={event => setReminders(old => ({ ...old, [key]: { ...old[key], time: event.target.value } }))}/></div>)}</div>
        <button className="primary" type="button" onClick={() => void saveReminderSettings()}>Save & enable background reminders <Check size={15}/></button>
        <div className="settings-divider"/>
        <div className="danger-zone">
          <div className="eyebrow">DANGER ZONE</div>
          <h2>Delete your account</h2>
          <p>This permanently deletes your DAYLOCK profile, timetables, habits, quests, XP history, reminders, and squad membership. Squads you own will also be removed for their members. This cannot be undone.</p>
          {!showDeleteConfirm ? <button type="button" className="danger-button" onClick={() => setShowDeleteConfirm(true)}>Delete my account</button> : <div className="delete-confirm-panel">
            <label>Current password<input type="password" autoComplete="current-password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} placeholder="Enter your password"/></label>
            <label>Type DELETE to confirm<input type="text" value={deletePhrase} onChange={event => setDeletePhrase(event.target.value)} placeholder="DELETE" autoComplete="off"/></label>
            <div className="delete-actions"><button type="button" className="secondary" onClick={cancelAccountDeletion} disabled={accountDeleting}>Cancel</button><button type="button" className="danger-button" onClick={() => void deleteAccount()} disabled={accountDeleting || !deletePassword || deletePhrase !== 'DELETE'}>{accountDeleting ? 'Deleting…' : 'Permanently delete'}</button></div>
          </div>}
        </div>
      </section></div>}
      {toast && <div className="toast"><Check size={16}/>{toast}</div>}
      {mobileMenu && <button className="scrim" onClick={() => setMobileMenu(false)} aria-label="Close navigation"/>}
    </div>
  )
}


type SquadSummary = { id: string; name: string; role: string }
type SquadMember = { uid: string; displayName: string; role: string }

function makeInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(10)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, value => alphabet[value % alphabet.length]).join('')
}
function squadErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code || ''
  if (code.includes('permission-denied')) return 'Firestore rules are not published yet. Once the DAYLOCK Squad rules are enabled, this action will work.'
  if (code.includes('unavailable') || code.includes('network')) return 'Could not reach Firestore. Check your connection and try again.'
  return (error as { message?: string })?.message || 'Something went wrong. Please try again.'
}
function SquadCenter({ user, shareDisplayName }: { user: User; shareDisplayName: boolean }) {
  const [squads,setSquads]=useState<SquadSummary[]>([])
  const [selected,setSelected]=useState<SquadSummary|null>(null)
  const [members,setMembers]=useState<SquadMember[]>([])
  const [challenges,setChallenges]=useState<Array<{id:string;title:string;description:string;target:number;unit:string;status:string;progress:Record<string,number>}>>([])
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [mode,setMode]=useState<'create'|'join'|null>(null)
  const [squadName,setSquadName]=useState('')
  const [inviteInput,setInviteInput]=useState('')
  const [inviteCode,setInviteCode]=useState('')
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [challengeTitle,setChallengeTitle]=useState('')
  const [challengeDescription,setChallengeDescription]=useState('')
  const [challengeTarget,setChallengeTarget]=useState('10')
  const [challengeUnit,setChallengeUnit]=useState('points')
  const displayName=user.displayName?.trim()||user.email?.split('@')[0]||'DAYLOCK Member'
  const visibleDisplayName=shareDisplayName?displayName:'DAYLOCK Member'

  const loadSquads=async()=>{
    setLoading(true);setError('')
    try{
      const snap=await getDocs(collection(db,'users',user.uid,'squads'))
      const items=snap.docs.map(d=>({id:d.id,name:String(d.data().name||'Untitled squad'),role:String(d.data().role||'member')}))
      setSquads(items)
      if(selected&&!items.some(item=>item.id===selected.id)){setSelected(null);setMembers([]);setInviteCode('');setChallenges([])}
    }catch(e){setError(squadErrorMessage(e))}
    finally{setLoading(false)}
  }
  useEffect(()=>{void loadSquads()},[user.uid])
  const loadChallenges=async(id:string, roster:SquadMember[])=>{
    const snap=await getDocs(collection(db,'squads',id,'challenges'))
    const docs=await Promise.all(snap.docs.map(async d=>{
      const data=d.data()
      const progressSnap=await getDocs(collection(db,'squads',id,'challenges',d.id,'progress'))
      const progress:Record<string,number>={}
      progressSnap.docs.forEach(p=>{progress[p.id]=Math.max(0,Number(p.data().progress||0))})
      return {id:d.id,title:String(data.title||'Squad challenge'),description:String(data.description||''),target:Number(data.target||1),unit:String(data.unit||'points'),status:String(data.status||'active'),progress}
    }))
    setChallenges(docs.filter(c=>c.status==='active'))
  }
  const openSquad=async(item:SquadSummary)=>{
    setBusy(true);setError('');setMessage('')
    try{
      const [squadSnap,memberSnap]=await Promise.all([getDoc(doc(db,'squads',item.id)),getDocs(collection(db,'squads',item.id,'members'))])
      if(!squadSnap.exists())throw new Error('This squad could not be found.')
      const roster=memberSnap.docs.map(d=>({uid:String(d.data().uid||d.id),displayName:String(d.data().displayName||'DAYLOCK Member'),role:String(d.data().role||'member')}))
      setSelected(item);setInviteCode(String(squadSnap.data().inviteCode||''));setMembers(roster)
      await loadChallenges(item.id,roster)
    }catch(e){setError(squadErrorMessage(e))}
    finally{setBusy(false)}
  }
  const createSquad=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    const name=squadName.trim()
    if(name.length<3||name.length>32){setError('Squad names must be between 3 and 32 characters.');return}
    setBusy(true);setError('');setMessage('')
    try{
      const code=makeInviteCode(),squadRef=doc(collection(db,'squads')),memberRef=doc(db,'squads',squadRef.id,'members',user.uid),userIndexRef=doc(db,'users',user.uid,'squads',squadRef.id),inviteRef=doc(db,'squadInvites',code)
      const batch=writeBatch(db)
      batch.set(squadRef,{name,createdBy:user.uid,inviteCode:code,createdAt:serverTimestamp()})
      batch.set(memberRef,{uid:user.uid,displayName:visibleDisplayName,role:'owner',joinedAt:serverTimestamp()})
      batch.set(userIndexRef,{squadId:squadRef.id,name,role:'owner',joinedAt:serverTimestamp()})
      batch.set(inviteRef,{squadId:squadRef.id,squadName:name,createdBy:user.uid,active:true,createdAt:serverTimestamp()})
      await batch.commit()
      const item={id:squadRef.id,name,role:'owner'}
      setSquads(items=>[item,...items]);setSelected(item);setMembers([{uid:user.uid,displayName:visibleDisplayName,role:'owner'}]);setInviteCode(code);setChallenges([]);setSquadName('');setMode(null)
      setMessage('Your private squad is ready. Share this invite code with friends.')
    }catch(e){setError(squadErrorMessage(e))}
    finally{setBusy(false)}
  }
  const joinSquad=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    const code=inviteInput.trim().toUpperCase()
    if(!/^[A-HJ-NP-Z2-9]{10}$/.test(code)){setError('Enter the 10-character invite code your friend shared.');return}
    setBusy(true);setError('');setMessage('')
    try{
      const inviteSnap=await getDoc(doc(db,'squadInvites',code))
      if(!inviteSnap.exists()||inviteSnap.data().active!==true)throw new Error('That invite code is invalid or inactive.')
      const invite=inviteSnap.data(),squadId=String(invite.squadId||''),memberRef=doc(db,'squads',squadId,'members',user.uid)
      if((await getDoc(memberRef)).exists())throw new Error('You are already a member of this squad.')
      const name=String(invite.squadName||'DAYLOCK Squad'),batch=writeBatch(db)
      batch.set(memberRef,{uid:user.uid,displayName:visibleDisplayName,role:'member',inviteCode:code,joinedAt:serverTimestamp()})
      batch.set(doc(db,'users',user.uid,'squads',squadId),{squadId,name,role:'member',joinedAt:serverTimestamp()})
      await batch.commit()
      const item={id:squadId,name,role:'member'}
      setSquads(items=>items.some(x=>x.id===squadId)?items:[item,...items]);setSelected(item);setInviteCode('');setInviteInput('');setMode(null)
      await openSquad(item);setMessage(`You joined ${name}. Welcome to the crew!`)
    }catch(e){setError(squadErrorMessage(e))}
    finally{setBusy(false)}
  }
  const createChallenge=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(!selected||selected.role!=='owner'||busy)return
    const title=challengeTitle.trim(),description=challengeDescription.trim(),target=Number(challengeTarget),unit=challengeUnit.trim()
    if(title.length<3||title.length>80){setError('Challenge title must be 3–80 characters.');return}
    if(description.length>240||!Number.isInteger(target)||target<1||target>100000||!unit||unit.length>24){setError('Check the description, target (1–100000), and unit (1–24 characters).');return}
    setBusy(true);setError('');setMessage('')
    try{
      await addDoc(collection(db,'squads',selected.id,'challenges'),{title,description,target,unit,status:'active',createdBy:user.uid,createdAt:serverTimestamp()})
      await loadChallenges(selected.id,members);setChallengeTitle('');setChallengeDescription('');setChallengeTarget('10');setChallengeUnit('points');setMessage('Squad challenge created!')
    }catch(e){setError(squadErrorMessage(e))}
    finally{setBusy(false)}
  }
  const addProgress=async(challengeId:string)=>{
    if(!selected||busy)return
    setBusy(true);setError('');setMessage('')
    try{
      const token=await user.getIdToken()
      const response=await fetch('/api/squad-challenges/progress',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({squadId:selected.id,challengeId,amount:1})})
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.error||'Could not update challenge progress.')
      setChallenges(old=>old.map(c=>c.id===challengeId?{...c,progress:{...c.progress,[user.uid]:Number(result.progress)}}:c))
      setMessage('Progress updated. Your squad leaderboard is refreshed.')
    }catch(e){setError(squadErrorMessage(e))}
    finally{setBusy(false)}
  }
  const copyInvite=async()=>{
    if(!inviteCode)return
    try{await navigator.clipboard.writeText(inviteCode);setMessage('Invite code copied. Share it privately with friends.')}
    catch{setMessage(`Invite code: ${inviteCode}. Copy it manually to share privately.`)}
  }
  return <div className="content">
    <div className="page-heading"><div className="eyebrow">BETTER, TOGETHER</div><h1>Squad</h1><p>Private crews, friendly challenges and shared momentum — on your terms.</p></div>
    <div className="squad-hero"><div><div className="eyebrow">YOUR PEOPLE, YOUR PACE</div><h2>{selected?selected.name:'Find your crew.'}</h2><p>{selected?'Your squad space is private. Share its invite code with people you trust.':'Create a private squad or join friends with a 10-character invite code. Your full timetable stays private.'}</p><div className="squad-action-row"><button className="primary" onClick={()=>{setMode('create');setError('');setMessage('')}}><Plus size={16}/> Create a squad</button><button className="secondary" onClick={()=>{setMode('join');setError('');setMessage('')}}>Join with code <ArrowRight size={15}/></button></div></div><div className="squad-emblem"><Users size={52}/></div></div>
    {mode&&<div className="panel squad-form-panel"><button className="squad-form-close" type="button" onClick={()=>setMode(null)} aria-label="Close"><X size={17}/></button><div className="eyebrow">{mode==='create'?'START A PRIVATE CREW':'JOIN YOUR FRIENDS'}</div><h2>{mode==='create'?'Create your squad':'Enter an invite code'}</h2>{mode==='create'?<form onSubmit={createSquad}><label>Squad name<input value={squadName} onChange={e=>setSquadName(e.target.value)} placeholder="e.g. The Night Owls" maxLength={32} required/></label><button className="primary" type="submit" disabled={busy}>{busy?'Creating…':'Create private squad'} <ArrowRight size={15}/></button></form>:<form onSubmit={joinSquad}><label>10-character invite code<input value={inviteInput} onChange={e=>setInviteInput(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g,'').slice(0,10))} placeholder="ABCD2345FG" maxLength={10} required/></label><button className="primary" type="submit" disabled={busy}>{busy?'Joining…':'Join squad'} <ArrowRight size={15}/></button></form>}</div>}
    {error&&<div className="squad-alert error" role="alert">{error}</div>}{message&&<div className="squad-alert success" role="status">{message}</div>}
    <div className="squad-layout"><section className="panel squad-list-panel"><div className="panel-title"><div><Users size={18}/><h3>Your squads</h3></div><button className="text-button" onClick={()=>void loadSquads()} disabled={loading}>Refresh <ArrowRight size={14}/></button></div>{loading?<p className="squad-muted">Loading your squads…</p>:squads.length===0?<div className="empty-state"><div className="empty-icon"><Users/></div><b>No squads yet</b><p>Create your first crew or join one using a friend's invite code.</p></div>:<div className="squad-list">{squads.map(item=><button key={item.id} className={selected?.id===item.id?'squad-list-item selected':'squad-list-item'} onClick={()=>void openSquad(item)} disabled={busy}><span className="squad-list-icon"><Users size={16}/></span><span><b>{item.name}</b><small>{item.role==='owner'?'Squad owner':'Member'}</small></span><ChevronRight size={15}/></button>)}</div>}</section>
    <section className="panel squad-detail-panel"><div className="panel-title"><div><Trophy size={18}/><h3>Squad space</h3></div><button className="text-button" onClick={()=>selected&&void openSquad(selected)} disabled={!selected||busy}>Refresh</button></div>{!selected?<div className="empty-state"><div className="empty-icon"><HeartHandshake/></div><b>Your arena is waiting</b><p>Choose a squad to see its members and invite code. Members only see shared squad details — never each other's private schedules.</p></div>:<><div className="squad-detail-heading"><div><span className="eyebrow">PRIVATE SQUAD</span><h2>{selected.name}</h2><p>{members.length} {members.length===1?'member':'members'} · {selected.role==='owner'?'You created this squad':'You joined this squad'}</p></div><div className="squad-emblem small-emblem"><Users size={27}/></div></div>{selected.role==='owner'&&<div className="invite-share"><div><span>INVITE CODE</span><b>{inviteCode||'Loading…'}</b></div><button className="secondary" onClick={()=>void copyInvite()} disabled={!inviteCode}>Copy code</button></div>}<div className="member-list"><div className="eyebrow">MEMBERS</div>{members.map(member=><div className="member-row" key={member.uid}><span className="member-avatar">{member.displayName.slice(0,1).toUpperCase()}</span><span><b>{member.displayName}</b><small>{member.role==='owner'?'Squad owner':'Member'}</small></span>{member.role==='owner'&&<span className="owner-pill">OWNER</span>}</div>)}</div>
      <div className="challenge-section"><div className="challenge-heading"><div><span className="eyebrow">SQUAD QUESTS</span><h3>Challenges</h3><p>Shared goals. Individual progress. One leaderboard.</p></div><Trophy size={24}/></div>
      {selected.role==='owner'&&<form className="challenge-create" onSubmit={createChallenge}><div className="eyebrow">CREATE A CHALLENGE</div><label>Challenge title<input value={challengeTitle} onChange={e=>setChallengeTitle(e.target.value)} placeholder="e.g. Read 100 pages" maxLength={80} required/></label><label>Description <input value={challengeDescription} onChange={e=>setChallengeDescription(e.target.value)} placeholder="What are we aiming for?" maxLength={240}/></label><div className="challenge-fields"><label>Target<input type="number" min="1" max="100000" value={challengeTarget} onChange={e=>setChallengeTarget(e.target.value)} required/></label><label>Unit<input value={challengeUnit} onChange={e=>setChallengeUnit(e.target.value)} maxLength={24} placeholder="pages" required/></label></div><button className="primary" type="submit" disabled={busy}>{busy?'Saving…':'Launch challenge'} <ArrowRight size={15}/></button></form>}
      {challenges.length===0?<div className="challenge-empty">No active challenges yet.{selected.role==='owner'?' Create the first one above.':' The squad owner can launch one anytime.'}</div>:challenges.map(challenge=>{const ranked=[...members].sort((a,b)=>(challenge.progress[b.uid]||0)-(challenge.progress[a.uid]||0));return <article className="challenge-card" key={challenge.id}><div className="challenge-card-top"><div><h4>{challenge.title}</h4>{challenge.description&&<p>{challenge.description}</p>}</div><span>{challenge.target} {challenge.unit}</span></div><button className="secondary challenge-progress-button" onClick={()=>void addProgress(challenge.id)} disabled={busy||(challenge.progress[user.uid]||0)>=challenge.target}>+1 {challenge.unit} · Update my progress</button><div className="challenge-board"><div className="eyebrow">LEADERBOARD</div>{ranked.map((member,index)=>{const value=challenge.progress[member.uid]||0;return <div className="challenge-rank" key={member.uid}><span className="rank-number">{index+1}</span><span className="rank-name">{member.displayName}{member.uid===user.uid?' (you)':''}</span><div className="rank-track"><i style={{width:`${Math.min(100,value/challenge.target*100)}%`}}/></div><b>{value}/{challenge.target}</b></div>})}</div></article>})}
      </div></>}</section></div>
    <div className="squad-note"><ShieldCheck size={15}/> Private by default. Your full timetable and notes are never shared with your squad.</div>
  </div>
}

function Landing({onDemo,onAuth,toast}:{onDemo:()=>void;onAuth:(mode:AuthMode,email:string,password:string,displayName:string)=>Promise<void>;toast:string}) {
  const [menuOpen,setMenuOpen]=useState(false)
  const [authMode,setAuthMode]=useState<AuthMode|null>(null)
  return <main className="landing">
    <header className="landing-nav"><a className="landing-brand" href="#top"><span className="brand-emblem">✦</span><span><b>DAYLOCK</b><small>PLAN TONIGHT. EXECUTE TOMORROW.</small></span></a><nav className={menuOpen?'landing-links open':'landing-links'}><a href="#ritual" onClick={()=>setMenuOpen(false)}>The ritual</a><a href="#realms" onClick={()=>setMenuOpen(false)}>Growth World</a><a href="#squad" onClick={()=>setMenuOpen(false)}>Squad</a></nav><div className="landing-actions"><button className="text-link" onClick={() => setAuthMode('login')}>Log in</button><button className="nav-cta" onClick={() => setAuthMode('signup')}>Create account <ArrowRight size={15}/></button></div><button className="landing-menu" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Toggle menu">{menuOpen?<X/>:<Menu/>}</button></header>
    <section className="landing-hero" id="top"><div className="hero-background"><div className="hero-moon"/><div className="hero-mountain hero-mountain-a"/><div className="hero-mountain hero-mountain-b"/><div className="hero-island"><div className="island-tower">✧</div></div><div className="hero-forest-line"/></div><div className="hero-content"><div className="hero-kicker"><span/> A CALMER WAY TO MAKE PROGRESS</div><h1>Plan tonight.<br/><em>Become tomorrow.</em></h1><p>Give tomorrow a little direction. Seal your plan at midnight, follow through at your own pace, and build a life beyond the checklist.</p><div className="landing-cta-row"><button className="nav-cta large" onClick={() => setAuthMode('signup')}>Start your fresh journey <ArrowRight size={16}/></button><button className="glass-cta" onClick={onDemo}><Compass size={16}/> Explore isolated demo</button></div><div className="trust-row"><span><ShieldCheck/> Private by design</span><span><LockKeyhole/> A midnight planning ritual</span><span><Sparkles/> Personal growth quests</span></div></div><div className="hero-side-note"><span>01 / 05</span><i/> FIVE REALMS. ONE JOURNEY.</div><div className="hero-scroll">SCROLL TO EXPLORE <span>↓</span></div></section>
    <section className="intro-band"><div className="intro-statement"><span className="section-kicker">NOT ANOTHER CHECKLIST</span><h2>Make plans with intention.<br/><em>Make room for real life.</em></h2></div><p>DAYLOCK brings your daily plan, personal quests and friendly accountability into one considered space. Less noise. More follow-through. A little more adventure.</p></section>
    <section className="ritual-section" id="ritual"><div className="section-head"><div><span className="section-kicker">THE DAILY RITUAL</span><h2>Three moments.<br/><em>A clearer day.</em></h2></div><p>A simple rhythm to help tomorrow feel less overwhelming before it even begins.</p></div><div className="ritual-grid"><article className="ritual-card ritual-one"><span className="ritual-number">01</span><div className="ritual-icon"><CalendarDays/></div><h3>Plan tonight</h3><p>Give tomorrow a thoughtful shape with time blocks that leave room to breathe.</p><span className="ritual-word">INTENTION</span></article><article className="ritual-card ritual-two"><span className="ritual-number">02</span><div className="ritual-icon"><LockKeyhole/></div><h3>Seal at midnight</h3><p>Give tomorrow a thoughtful shape before the day begins, with space to focus when it arrives.</p><span className="ritual-word">COMMITMENT</span></article><article className="ritual-card ritual-three"><span className="ritual-number">03</span><div className="ritual-icon"><Sprout/></div><h3>Grow as you go</h3><p>Turn small side quests, habits and milestones into a story of your own.</p><span className="ritual-word">MOMENTUM</span></article></div></section>
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
function TaskRow({task,onStatus}:{task:Task;onStatus:(id:number | string,status:TaskStatus)=>void}) { return <div className="task-row"><div className="task-time">{task.start}<span>—</span>{task.end}</div><div className="task-main"><b>{task.title}</b><span>{task.category}{task.note? ` · ${task.note}`:''}</span></div><select value={task.status} onChange={event => onStatus(task.id,event.target.value as TaskStatus)}><option>Not started</option><option>In progress</option><option>Completed</option><option>Skipped</option></select></div> }
function QuestLine({quest}:{quest:Quest}) { return <div className="quest-line"><div className="quest-icon"><Sparkles size={16}/></div><div className="quest-text"><b>{quest.title}</b><span>{quest.category} · {quest.progress}/{quest.target} {quest.unit}</span><div className="progress-track"><i style={{width:`${quest.progress/quest.target*100}%`}}/></div></div></div> }
function ZoneCard({zone,onClick}:{zone:typeof zoneData[number];onClick:()=>void}) { const Icon=zone.icon;return <button className={`zone-card ${zone.tone}`} onClick={onClick}><div className={`zone-art scene-${zone.scene}`}><div className="zone-glow"/><Icon size={29}/><span className="zone-spark">✦</span></div><div className="zone-info"><b>{zone.name}</b><span>{zone.sub}</span><div className="progress-track"><i style={{width:'0%'}}/></div><small>{zone.hint}</small></div><ChevronRight size={16}/></button> }
export default App
