import { useEffect, useMemo, useRef, useState } from 'react'
import { ANIMAL_POOL } from './animals'
import { MAP_SLOTS } from './mapSlots'
import {
  addComment,
  addMember,
  addSubtask,
  addTask,
  awardAnimalForOwner,
  completeTaskAndAwardAnimal,
  deleteSubtask,
  deleteTask,
  fetchAppData,
  removeMember,
  setSubtaskAssignees,
  setTaskAssignees,
  subscribeToRealtime,
  unsubscribeFromRealtime,
  updateSubtask,
  updateTask,
} from './store'
import type { Animal, Comment, Member, Subtask, Task } from './types'

type Tab = 'tasks' | 'map' | 'team' | 'zoo'

const storageKey = 'team-go-current-member'

const timeAgo = (iso: string) => {
  const elapsed = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(elapsed / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const navItems: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'tasks', label: 'Tasks', icon: '✅' },
  { id: 'map', label: 'Map', icon: '🗺️' },
  { id: 'team', label: 'Team', icon: '👥' },
  { id: 'zoo', label: 'Zoo', icon: '🦁' },
]

const buildIdMap = <T extends { id: string }>(items: T[]) => {
  const map = new Map<string, T>()
  for (const item of items) map.set(item.id, item)
  return map
}

const buildMemberIndex = (assignments: Array<{ task_id?: string; subtask_id?: string; member_id: string }>, key: 'task_id' | 'subtask_id') => {
  const map = new Map<string, string[]>()
  for (const assignment of assignments) {
    const entityId = assignment[key]
    if (!entityId) continue
    const existing = map.get(entityId) ?? []
    existing.push(assignment.member_id)
    map.set(entityId, existing)
  }
  return map
}

function App() {
  const [tab, setTab] = useState<Tab>('tasks')
  const [members, setMembers] = useState<Member[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [animals, setAnimals] = useState<Animal[]>([])
  const [taskAssignments, setTaskAssignments] = useState<Array<{ task_id: string; member_id: string }>>([])
  const [subtaskAssignments, setSubtaskAssignments] = useState<Array<{ subtask_id: string; member_id: string }>>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string>('')

  const taskAssigneeMap = useMemo(() => buildMemberIndex(taskAssignments, 'task_id'), [taskAssignments])
  const subtaskAssigneeMap = useMemo(() => buildMemberIndex(subtaskAssignments, 'subtask_id'), [subtaskAssignments])

  const load = async () => {
    try {
      const data = await fetchAppData()
      setMembers(data.members)
      setTasks(data.tasks)
      setSubtasks(data.subtasks)
      setComments(data.comments)
      setAnimals(data.animals)
      setTaskAssignments(data.taskAssignments)
      setSubtaskAssignments(data.subtaskAssignments)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage('Could not connect to Team Go. Please check Supabase settings and network.')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const channel = subscribeToRealtime(() => {
      void load()
    }, setErrorMessage)
    return () => unsubscribeFromRealtime(channel)
  }, [])

  useEffect(() => {
    if (!members.length) return
    const stored = localStorage.getItem(storageKey)
    if (stored && members.some((member) => member.id === stored)) {
      setSelectedMemberId(stored)
      return
    }
    setSelectedMemberId(members[0].id)
  }, [members])

  useEffect(() => {
    if (selectedMemberId) {
      localStorage.setItem(storageKey, selectedMemberId)
    }
  }, [selectedMemberId])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null
  const currentMember = members.find((member) => member.id === selectedMemberId) ?? null

  const subtasksByTask = useMemo(() => {
    const map = new Map<string, Subtask[]>()
    for (const subtask of subtasks) {
      const existing = map.get(subtask.parent_task_id) ?? []
      existing.push(subtask)
      map.set(subtask.parent_task_id, existing)
    }
    return map
  }, [subtasks])

  const commentsByTask = useMemo(() => {
    const map = new Map<string, Comment[]>()
    for (const comment of comments) {
      const existing = map.get(comment.task_id) ?? []
      existing.push(comment)
      map.set(comment.task_id, existing)
    }
    return map
  }, [comments])

  const memberById = useMemo(() => buildIdMap(members), [members])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-xl font-semibold">Team Go</h1>
          <label className="flex items-center gap-2 text-sm">
            <span>You are</span>
            <select
              className="rounded-lg border border-slate-300 px-2 py-1"
              value={selectedMemberId}
              onChange={(event) => setSelectedMemberId(event.target.value)}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.avatar_emoji} {member.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-4 px-4 py-4">
        <nav className="hidden w-44 shrink-0 rounded-2xl bg-white p-2 shadow-sm md:block" aria-label="Sidebar">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ${tab === item.id ? 'bg-emerald-100 text-emerald-800' : 'hover:bg-slate-100'}`}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          {loading ? <div className="rounded-2xl bg-white p-6 shadow-sm">Loading Team Go…</div> : null}
          {!loading && errorMessage ? <div className="mb-3 rounded-2xl border border-rose-300 bg-rose-50 p-3 text-rose-700">{errorMessage}</div> : null}
          {!loading && tab === 'tasks' ? (
            <TasksView
              tasks={tasks}
              members={members}
              taskAssigneeMap={taskAssigneeMap}
              memberById={memberById}
              subtasksByTask={subtasksByTask}
              onOpenTask={setSelectedTaskId}
              onAddTask={async (input) => addTask(input)}
            />
          ) : null}
          {!loading && tab === 'map' ? <MapView tasks={tasks} onOpenTask={setSelectedTaskId} /> : null}
          {!loading && tab === 'team' ? (
            <TeamView
              members={members}
              tasks={tasks}
              taskAssigneeMap={taskAssigneeMap}
              animals={animals}
              onAddMember={async (name, avatar) => addMember(name, avatar)}
              onRemoveMember={async (id) => removeMember(id)}
              onOpenTask={setSelectedTaskId}
            />
          ) : null}
          {!loading && tab === 'zoo' ? (
            <ZooView members={members} animals={animals} selectedMemberId={selectedMemberId} />
          ) : null}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white p-2 md:hidden" aria-label="Bottom tabs">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-lg px-2 py-1 text-sm ${tab === item.id ? 'bg-emerald-100 text-emerald-800' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <span aria-hidden="true">{item.icon} </span>
            {item.label}
          </button>
        ))}
      </nav>

      {selectedTask ? (
        <TaskDetail
          task={selectedTask}
          members={members}
          subtasks={subtasksByTask.get(selectedTask.id) ?? []}
          subtaskAssigneeMap={subtaskAssigneeMap}
          comments={commentsByTask.get(selectedTask.id) ?? []}
          currentMember={currentMember}
          memberById={memberById}
          taskAssigneeIds={taskAssigneeMap.get(selectedTask.id) ?? []}
          onClose={() => setSelectedTaskId(null)}
          onAssign={async (memberIds) => { await setTaskAssignees(selectedTask.id, memberIds) }}
          onSave={async (title, description, emoji) => updateTask(selectedTask.id, { title, description, emoji })}
          onCancel={async () => updateTask(selectedTask.id, { status: 'cancelled' })}
          onDelete={async () => {
            await deleteTask(selectedTask.id)
            setSelectedTaskId(null)
          }}
          onComplete={async () => {
            if (!currentMember) return
            const animal = await completeTaskAndAwardAnimal(selectedTask.id, currentMember.id)
            const earned = ANIMAL_POOL.find((item) => item.species === animal.species)
            setToast(`🎉 ${animal.display_name} joined the zoo! ${earned?.emoji ?? ''}`)
          }}
          onAddSubtask={async (title, memberIds) => addSubtask(selectedTask.id, title, memberIds)}
          onToggleSubtask={async (subtask) => {
            const nextDone = !subtask.done
            await updateSubtask(subtask.id, { done: nextDone })
            if (nextDone && currentMember) {
              const animal = await awardAnimalForOwner(currentMember.id)
              const earned = ANIMAL_POOL.find((item) => item.species === animal.species)
              setToast(`🎉 ${animal.display_name} joined the zoo! ${earned?.emoji ?? ''}`)
            }
          }}
          onAssignSubtask={async (subtaskId, memberIds) => { await setSubtaskAssignees(subtaskId, memberIds) }}
          onAddComment={async (body) => addComment(selectedTask.id, currentMember?.id ?? null, body)}
        />
      ) : null}

      {toast ? <div className="fixed right-4 top-20 rounded-xl bg-emerald-600 px-4 py-2 text-white shadow-lg">{toast}</div> : null}
    </div>
  )
}

function TasksView({
  tasks,
  members,
  taskAssigneeMap,
  memberById,
  subtasksByTask,
  onOpenTask,
  onAddTask,
}: {
  tasks: Task[]
  members: Member[]
  taskAssigneeMap: Map<string, string[]>
  memberById: Map<string, Member>
  subtasksByTask: Map<string, Subtask[]>
  onOpenTask: (taskId: string) => void
  onAddTask: (input: { title: string; description: string; assigneeIds: string[]; emoji: string }) => Promise<void>
}) {
  const [openForm, setOpenForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [emoji, setEmoji] = useState('🧩')

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={() => setOpenForm((value) => !value)}>
          Add task
        </button>
      </div>

      {openForm ? (
        <form
          className="mb-4 grid gap-2 rounded-xl border border-slate-200 p-3"
          onSubmit={async (event) => {
            event.preventDefault()
            await onAddTask({ title, description, assigneeIds, emoji: emoji || '🧩' })
            setOpenForm(false)
            setTitle('')
            setDescription('')
            setAssigneeIds([])
            setEmoji('🧩')
          }}
        >
          <input required placeholder="Title" className="rounded-lg border px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} />
          <textarea placeholder="Description" className="rounded-lg border px-3 py-2" value={description} onChange={(event) => setDescription(event.target.value)} />
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <div className="rounded-lg border p-2">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Assign to</p>
              <MemberAssignmentSelector members={members} selectedMemberIds={assigneeIds} onChange={setAssigneeIds} compact />
            </div>
            <EmojiPicker label="Task emoji" value={emoji} onChange={setEmoji} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-lg border px-3 py-2" onClick={() => setOpenForm(false)}>Close</button>
            <button type="submit" className="rounded-lg bg-slate-800 px-3 py-2 text-white">Save</button>
          </div>
        </form>
      ) : null}

      <ul className="space-y-2">
        {tasks.map((task) => {
          const assigneeIdsForTask = taskAssigneeMap.get(task.id) ?? []
          const assignees = assigneeIdsForTask.map((memberId) => memberById.get(memberId)).filter((member): member is Member => Boolean(member))
          const taskSubtasks = subtasksByTask.get(task.id) ?? []
          const done = taskSubtasks.filter((item) => item.done).length
          return (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => onOpenTask(task.id)}
                className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${task.status === 'cancelled' ? 'bg-slate-100 text-slate-400 line-through' : 'bg-white'}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-base"><span className="mr-2">{task.status === 'complete' ? '🏰' : task.emoji}</span>{task.title}</div>
                  <div className="text-xs text-slate-500">{done}/{taskSubtasks.length} subtasks</div>
                </div>
                <div className="ml-2 flex items-center gap-2 text-sm">
                  <AvatarStack members={assignees} />
                  {task.status === 'complete' ? <span className="text-emerald-600">✔</span> : null}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function MapView({ tasks, onOpenTask }: { tasks: Task[]; onOpenTask: (taskId: string) => void }) {
  if (!tasks.length) {
    return <section className="rounded-2xl bg-white p-8 text-center shadow-sm">No tasks on the map yet. Add one to begin your adventure.</section>
  }

  return (
    <section className="overflow-x-auto rounded-2xl bg-white p-3 shadow-sm">
      <div className="relative h-[520px] min-w-[980px] rounded-2xl bg-emerald-100">
        <svg viewBox="0 0 980 520" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <path d="M0 370 C120 320 240 420 360 370 C520 300 620 420 760 370 C860 330 940 350 980 330 L980 520 L0 520 Z" fill="#86efac"/>
          <path d="M20 310 C150 250 260 360 420 300 C560 240 700 340 940 270" stroke="#65a30d" strokeWidth="10" fill="none" strokeLinecap="round"/>
          <ellipse cx="640" cy="260" rx="85" ry="45" fill="#60a5fa" />
          <g fill="#16a34a"><circle cx="210" cy="130" r="24"/><circle cx="190" cy="156" r="18"/><circle cx="235" cy="158" r="16"/><circle cx="760" cy="80" r="20"/><circle cx="737" cy="102" r="15"/><circle cx="778" cy="106" r="14"/></g>
        </svg>
        {tasks.map((task) => {
          const slot = typeof task.map_slot === 'number' ? MAP_SLOTS[task.map_slot] : null
          if (!slot) return null
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpenTask(task.id)}
              style={{ left: `${slot.x}px`, top: `${slot.y}px` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white/80 px-2 py-1 text-center shadow transition hover:scale-105"
            >
              <div className="text-2xl transition-all">{task.status === 'complete' ? '🏰' : task.emoji}</div>
              <div className="text-xs font-medium">{task.title}</div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function TeamView({
  members,
  tasks,
  taskAssigneeMap,
  animals,
  onAddMember,
  onRemoveMember,
  onOpenTask,
}: {
  members: Member[]
  tasks: Task[]
  taskAssigneeMap: Map<string, string[]>
  animals: Animal[]
  onAddMember: (name: string, avatar: string) => Promise<void>
  onRemoveMember: (memberId: string) => Promise<void>
  onOpenTask: (taskId: string) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('🙂')
  const [focusedMemberId, setFocusedMemberId] = useState<string>('')

  const focusedTasks = tasks.filter((task) => (taskAssigneeMap.get(task.id) ?? []).includes(focusedMemberId))

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Team</h2>
        <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={() => setShowForm((value) => !value)}>
          Add team member
        </button>
      </div>

      {showForm ? (
        <form
          className="mb-4 grid gap-2 rounded-xl border p-3"
          onSubmit={async (event) => {
            event.preventDefault()
            await onAddMember(name, avatar || '🙂')
            setName('')
            setAvatar('🙂')
            setShowForm(false)
          }}
        >
          <input required className="rounded-lg border px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
          <div className="flex items-center gap-3 rounded-lg border p-2">
            <span className="text-2xl">{avatar}</span>
            <EmojiPicker label="Member avatar" value={avatar} onChange={setAvatar} />
          </div>
          <button type="submit" className="rounded-lg bg-slate-800 px-3 py-2 text-white">Save</button>
        </form>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((member) => {
          const openTasks = tasks.filter((task) => (taskAssigneeMap.get(task.id) ?? []).includes(member.id) && task.status === 'open').length
          const zooCount = animals.filter((animal) => animal.owner_id === member.id).length
          return (
            <article key={member.id} className="rounded-xl border p-3">
              <button type="button" className="mb-2 block w-full text-left" onClick={() => setFocusedMemberId(member.id)}>
                <div className="text-2xl">{member.avatar_emoji}</div>
                <h3 className="font-semibold">{member.name}</h3>
              </button>
              <p className="text-sm text-slate-600">Open tasks: {openTasks}</p>
              <p className="text-sm text-slate-600">Animals earned: {zooCount}</p>
              <button aria-label={`Remove ${member.name}`} type="button" className="mt-2 rounded bg-rose-100 px-2 py-1 text-sm text-rose-700" onClick={() => onRemoveMember(member.id)}>
                Remove
              </button>
            </article>
          )
        })}
      </div>

      {focusedMemberId ? (
        <div className="mt-4 rounded-xl border p-3">
          <h3 className="mb-2 font-semibold">Assigned tasks</h3>
          {!focusedTasks.length ? <p className="text-sm text-slate-500">No tasks assigned.</p> : (
            <ul className="space-y-2">
              {focusedTasks.map((task) => <li key={task.id}><button type="button" className="text-emerald-700 underline" onClick={() => onOpenTask(task.id)}>{task.emoji} {task.title}</button></li>)}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}

function ZooView({ members, animals, selectedMemberId }: { members: Member[]; animals: Animal[]; selectedMemberId: string }) {
  const [viewMemberId, setViewMemberId] = useState(selectedMemberId)
  const [selectedAnimal, setSelectedAnimal] = useState<Animal | null>(null)

  useEffect(() => setViewMemberId(selectedMemberId), [selectedMemberId])

  const visibleAnimals = animals.filter((animal) => animal.owner_id === viewMemberId)

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Zoo</h2>
        <select className="rounded-lg border px-2 py-1" value={viewMemberId} onChange={(event) => setViewMemberId(event.target.value)}>
          {members.map((member) => <option key={member.id} value={member.id}>{member.avatar_emoji} {member.name}</option>)}
        </select>
      </div>
      {!visibleAnimals.length ? <p className="rounded-xl bg-slate-50 p-8 text-center text-slate-500">No animals yet — complete a task to meet your first one.</p> : (
        <ZooPen animals={visibleAnimals} onSelect={setSelectedAnimal} />
      )}
      {selectedAnimal ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">{selectedAnimal.display_name} — {selectedAnimal.blurb}</p> : null}
    </section>
  )
}

function ZooPen({ animals, onSelect }: { animals: Animal[]; onSelect: (animal: Animal) => void }) {
  return (
    <div className="flex flex-wrap gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      {animals.map((animal) => {
        const base = ANIMAL_POOL.find((item) => item.species === animal.species) ?? ANIMAL_POOL[0]
        return (
          <button
            key={animal.id}
            type="button"
            onClick={() => onSelect(animal)}
            aria-label={animal.display_name}
            className="flex w-24 flex-col items-center gap-1 rounded-xl bg-white/80 px-2 py-3 shadow transition hover:scale-105"
          >
            <span className="text-3xl">{base.emoji}</span>
            <span className="w-full truncate text-center text-[11px] text-slate-600">{animal.display_name}</span>
          </button>
        )
      })}
    </div>
  )
}

function DriftingAnimal({ animal, index, staticMode, onSelect }: { animal: Animal; index: number; staticMode: boolean; onSelect: (animal: Animal) => void }) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (staticMode) return
    let frame = 0
    let raf = 0
    const loop = () => {
      frame += 1
      if (frame % 5 === 0) setTick((value) => value + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [staticMode])

  const base = ANIMAL_POOL.find((item) => item.species === animal.species) ?? ANIMAL_POOL[0]
  const x = 10 + ((index * 29 + tick * (0.05 + (index % 3) * 0.02)) % 78)
  const y = 12 + ((index * 21 + tick * (0.03 + (index % 4) * 0.015)) % 66)

  return (
    <button
      type="button"
      className="absolute rounded-full bg-white/70 px-3 py-2 text-2xl shadow"
      style={{ transform: `translate(${x}%, ${y}%)` }}
      onClick={() => onSelect(animal)}
      aria-label={animal.display_name}
    >
      {base.emoji}
    </button>
  )
}

function EmojiPicker({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [customValue, setCustomValue] = useState(value)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setCustomValue(value)
  }, [value])

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const groups: Array<{ title: string; emojis: string[] }> = [
    { title: 'Places', emojis: ['🏙️', '🌆', '🏔️', '🏕️', '🏖️', '🏝️', '🌋', '🏜️', '🏞️', '🗺️', '🚀', '🚗', '🚲', '🛶', '🏰'] },
    { title: 'Objects', emojis: ['📚', '🧰', '💡', '🎧', '💻', '🧩', '🪄', '🎁', '🔑', '🧤', '🪑', '🧲', '📦', '🖊️', '🧵'] },
    { title: 'Nature', emojis: ['🌱', '🌼', '🌳', '🌙', '☀️', '🌊', '🌬️', '🌧️', '❄️', '🔥', '🍀', '🌾', '🌵', '🍃', '🌷'] },
    { title: 'Activities', emojis: ['⚽', '🏀', '🎯', '🎲', '🎮', '🎸', '🎻', '🎨', '🏃', '🧘', '🎤', '🎭', '🧗', '🚴', '🏊'] },
    { title: 'Food', emojis: ['🍎', '🍉', '🍓', '🍔', '🌮', '🍕', '🍣', '🍩', '🍰', '🍪', '🥐', '🍜', '🥑', '🍋', '🍇'] },
    { title: 'Symbols', emojis: ['✅', '⭐', '⚠️', '❌', '💬', '🔔', '💤', '💎', '🎉', '🧠', '❤️', '👍', '👀', '✨', '🏆'] },
  ]

  const handleCustomCommit = () => {
    const trimmed = customValue.trim()
    if (!trimmed) return
    onChange(trimmed)
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        className="flex h-11 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xl shadow-sm"
        onClick={() => setIsOpen((value) => !value)}
      >
        <span>{value || '🧩'}</span>
        <span className="text-xs text-slate-500">▾</span>
      </button>
      {isOpen ? (
        <div className="absolute left-0 z-40 mt-2 w-[320px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
            <span className="text-lg">{customValue || '🧩'}</span>
            <input
              aria-label={`${label} custom emoji`}
              value={customValue}
              onChange={(event) => setCustomValue(event.target.value)}
              className="w-full border-none bg-transparent text-sm outline-none"
              maxLength={4}
              placeholder="Paste custom emoji"
            />
            <button type="button" className="rounded bg-slate-800 px-2 py-1 text-xs text-white" onClick={handleCustomCommit}>Use</button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-3">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{group.title}</p>
                <div className="grid grid-cols-6 gap-1">
                  {group.emojis.map((emoji) => (
                    <button
                      key={`${group.title}-${emoji}`}
                      type="button"
                      className={`rounded-md p-1 text-lg hover:bg-slate-100 ${value === emoji ? 'bg-emerald-100 ring-1 ring-emerald-300' : ''}`}
                      onClick={() => {
                        onChange(emoji)
                        setIsOpen(false)
                      }}
                      aria-label={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MemberAssignmentSelector({ members, selectedMemberIds, onChange, compact = false }: { members: Member[]; selectedMemberIds: string[]; onChange: (next: string[]) => void; compact?: boolean }) {
  const selectedSet = new Set(selectedMemberIds)

  const toggle = (memberId: string) => {
    const next = selectedSet.has(memberId)
      ? selectedMemberIds.filter((id) => id !== memberId)
      : [...selectedMemberIds, memberId]
    onChange(next)
  }

  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-2 md:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {members.map((member) => (
        <label key={member.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50">
          <input type="checkbox" checked={selectedSet.has(member.id)} onChange={() => toggle(member.id)} />
          <span>{member.avatar_emoji} {member.name}</span>
        </label>
      ))}
    </div>
  )
}

function AvatarStack({ members }: { members: Member[] }) {
  const visible = members.slice(0, 3)
  const rest = members.length - visible.length

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((member, index) => (
        <span key={member.id} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-xs shadow-sm" style={{ zIndex: 10 - index }} title={member.name}>
          {member.avatar_emoji}
        </span>
      ))}
      {rest > 0 ? <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-semibold text-slate-700">+{rest}</span> : null}
      {!members.length ? <span className="text-slate-400">🙂</span> : null}
    </div>
  )
}

function TaskDetail({
  task,
  members,
  subtasks,
  subtaskAssigneeMap,
  comments,
  currentMember,
  memberById,
  taskAssigneeIds,
  onClose,
  onAssign,
  onSave,
  onCancel,
  onDelete,
  onComplete,
  onAddSubtask,
  onToggleSubtask,
  onAssignSubtask,
  onAddComment,
}: {
  task: Task
  members: Member[]
  subtasks: Subtask[]
  subtaskAssigneeMap: Map<string, string[]>
  comments: Comment[]
  currentMember: Member | null
  memberById: Map<string, Member>
  taskAssigneeIds: string[]
  onClose: () => void
  onAssign: (memberIds: string[]) => Promise<void>
  onSave: (title: string, description: string, emoji: string) => Promise<void>
  onCancel: () => Promise<void>
  onDelete: () => Promise<void>
  onComplete: () => Promise<void>
  onAddSubtask: (title: string, assigneeIds: string[]) => Promise<void>
  onToggleSubtask: (subtask: Subtask) => Promise<void>
  onAssignSubtask: (subtaskId: string, memberIds: string[]) => Promise<void>
  onAddComment: (body: string) => Promise<void>
}) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [emoji, setEmoji] = useState(task.emoji)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [subtaskAssigneeIds, setSubtaskAssigneeIds] = useState<string[]>([])
  const [isEditingSubtaskId, setIsEditingSubtaskId] = useState<string | null>(null)
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('')

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/40 p-3">
      <section className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Task detail</h2>
          <button aria-label="Close detail" type="button" className="rounded-lg border px-3 py-1" onClick={onClose}>Close</button>
        </div>

        <div className="grid gap-2">
          <input className="rounded-lg border px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} />
          <textarea className="rounded-lg border px-3 py-2" value={description} onChange={(event) => setDescription(event.target.value)} />
          <div className="rounded-xl border p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Assignees</p>
            <MemberAssignmentSelector members={members} selectedMemberIds={taskAssigneeIds} onChange={(next) => { void onAssign(next) }} />
          </div>
          <div className="grid grid-cols-[auto_auto_auto] items-center gap-2">
            <EmojiPicker label="Task emoji" value={emoji} onChange={setEmoji} />
            <button type="button" className="rounded-lg border px-3 py-2" onClick={onClose}>Close</button>
            <button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-white" onClick={() => void onSave(title, description, emoji || '🧩')}>Save</button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-white" onClick={() => void onComplete()} disabled={task.status === 'complete'}>Mark complete</button>
            <button type="button" className="rounded-lg bg-slate-500 px-3 py-2 text-white" onClick={() => void onCancel()} disabled={task.status === 'cancelled'}>Cancel</button>
            <button type="button" className="rounded-lg bg-rose-600 px-3 py-2 text-white" onClick={() => void onDelete()}>Delete</button>
          </div>

          <div className="rounded-xl border p-3">
            <h3 className="mb-2 font-semibold">Subtasks</h3>
            <ul className="space-y-2">
              {subtasks.map((subtask) => {
                const selectedSubtaskIds = subtaskAssigneeMap.get(subtask.id) ?? []
                const assignedNames = selectedSubtaskIds.map((memberId) => memberById.get(memberId)?.name).filter(Boolean) as string[]
                return (
                  <li key={subtask.id} className="grid gap-2 rounded-lg border p-2">
                    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                      <input type="checkbox" checked={subtask.done} onChange={() => void onToggleSubtask(subtask)} />
                      {isEditingSubtaskId === subtask.id ? (
                        <input className="min-w-0 flex-1 rounded border px-2 py-1" value={editingSubtaskTitle} onChange={(event) => setEditingSubtaskTitle(event.target.value)} />
                      ) : (
                        <span className={subtask.done ? 'text-emerald-600' : ''}>{subtask.title}</span>
                      )}
                      {subtask.done ? <span className="text-emerald-600">✔</span> : <span className="text-slate-400">•</span>}
                    </div>
                    <div className="ml-6 text-xs text-slate-600">
                      {assignedNames.length ? assignedNames.join(', ') : 'Unassigned'}
                    </div>
                    <div className="ml-6">
                      <MemberAssignmentSelector
                        members={members}
                        selectedMemberIds={selectedSubtaskIds}
                        onChange={(next) => { void onAssignSubtask(subtask.id, next) }}
                        compact
                      />
                    </div>
                    <div className="ml-6 flex flex-wrap gap-2">
                      <button type="button" className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700" onClick={() => void onToggleSubtask(subtask)}>{subtask.done ? 'Mark open' : 'Mark complete'}</button>
                      {isEditingSubtaskId === subtask.id ? (
                        <button type="button" className="rounded bg-slate-800 px-2 py-1 text-xs text-white" onClick={async () => {
                          const nextTitle = editingSubtaskTitle.trim()
                          if (!nextTitle) return
                          await updateSubtask(subtask.id, { title: nextTitle })
                          setIsEditingSubtaskId(null)
                          setEditingSubtaskTitle('')
                        }}>Save edit</button>
                      ) : (
                        <button type="button" className="rounded bg-slate-200 px-2 py-1 text-xs" onClick={() => {
                          setIsEditingSubtaskId(subtask.id)
                          setEditingSubtaskTitle(subtask.title)
                        }}>Edit</button>
                      )}
                      <button type="button" className="rounded bg-rose-100 px-2 py-1 text-xs text-rose-700" onClick={async () => {
                        await deleteSubtask(subtask.id)
                        setIsEditingSubtaskId((current) => current === subtask.id ? null : current)
                      }}>Remove</button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!subtaskTitle.trim()) return
                await onAddSubtask(subtaskTitle.trim(), subtaskAssigneeIds)
                setSubtaskTitle('')
                setSubtaskAssigneeIds([])
              }}
            >
              <input className="min-w-0 flex-1 rounded-lg border px-2 py-1" value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Add subtask" />
              <button type="submit" className="rounded-lg border px-2 py-1">Add</button>
            </form>
            <div className="mt-2 rounded-lg border p-2">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Subtask assignees</p>
              <MemberAssignmentSelector members={members} selectedMemberIds={subtaskAssigneeIds} onChange={setSubtaskAssigneeIds} compact />
            </div>
          </div>

          <div className="rounded-xl border p-3">
            <h3 className="mb-2 font-semibold">Comments</h3>
            <ul className="space-y-2">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-lg bg-slate-50 p-2 text-sm">
                  <div className="font-medium">{memberById.get(comment.author_id ?? '')?.name ?? 'Unknown'} · <span className="text-slate-500">{timeAgo(comment.created_at)}</span></div>
                  <div>{comment.body}</div>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!commentBody.trim()) return
                await onAddComment(commentBody.trim())
                setCommentBody('')
              }}
            >
              <input className="min-w-0 flex-1 rounded-lg border px-2 py-1" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder={currentMember ? `Comment as ${currentMember.name}` : 'Comment'} />
              <button type="submit" className="rounded-lg border px-2 py-1">Post</button>
            </form>
          </div>
        </div>
      </section>
    </div>
  )
}

export default App
