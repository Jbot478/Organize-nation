import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { ANIMAL_POOL } from './animals'
import { MAP_SLOTS } from './mapSlots'
import type { Animal, Comment, Member, Subtask, Task, TaskStatus } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

export interface AppData {
  members: Member[]
  tasks: Task[]
  subtasks: Subtask[]
  comments: Comment[]
  animals: Animal[]
}

const TABLES = ['members', 'tasks', 'subtasks', 'comments', 'animals'] as const

const toRoman = (value: number): string => {
  const numerals: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]

  let num = value
  let result = ''
  for (const [divisor, numeral] of numerals) {
    while (num >= divisor) {
      num -= divisor
      result += numeral
    }
  }
  return result
}

const getNextFreeSlot = async () => {
  const { data, error } = await supabase.from('tasks').select('map_slot')
  if (error) throw error
  const used = new Set(data.map((item) => item.map_slot).filter((value): value is number => typeof value === 'number'))
  for (let i = 0; i < MAP_SLOTS.length; i += 1) {
    if (!used.has(i)) return i
  }
  return null
}

export const fetchAppData = async (): Promise<AppData> => {
  const [membersRes, tasksRes, subtasksRes, commentsRes, animalsRes] = await Promise.all([
    supabase.from('members').select('*').order('created_at', { ascending: true }),
    supabase.from('tasks').select('*').order('created_at', { ascending: true }),
    supabase.from('subtasks').select('*').order('created_at', { ascending: true }),
    supabase.from('comments').select('*').order('created_at', { ascending: true }),
    supabase.from('animals').select('*').order('awarded_at', { ascending: true }),
  ])

  for (const res of [membersRes, tasksRes, subtasksRes, commentsRes, animalsRes]) {
    if (res.error) throw res.error
  }

  return {
    members: membersRes.data as Member[],
    tasks: tasksRes.data as Task[],
    subtasks: subtasksRes.data as Subtask[],
    comments: commentsRes.data as Comment[],
    animals: animalsRes.data as Animal[],
  }
}

export const subscribeToRealtime = (
  onChange: () => void,
  onError: (message: string) => void,
): RealtimeChannel => {
  const channel = supabase.channel('team-go-sync')

  for (const table of TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
  }

  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      onError('Live updates are unavailable right now. Please check your connection.')
    }
  })

  return channel
}

export const unsubscribeFromRealtime = (channel: RealtimeChannel) => {
  void supabase.removeChannel(channel)
}

export const addMember = async (name: string, avatarEmoji: string) => {
  const { error } = await supabase.from('members').insert({ name, avatar_emoji: avatarEmoji })
  if (error) throw error
}

export const removeMember = async (memberId: string) => {
  const { error: unassignError } = await supabase
    .from('tasks')
    .update({ assignee_id: null })
    .eq('assignee_id', memberId)
  if (unassignError) throw unassignError

  const { error: subtaskError } = await supabase
    .from('subtasks')
    .update({ assignee_id: null })
    .eq('assignee_id', memberId)
  if (subtaskError) throw subtaskError

  const { error } = await supabase.from('members').delete().eq('id', memberId)
  if (error) throw error
}

export const addTask = async (input: {
  title: string
  description: string
  assigneeId: string | null
  emoji: string
}) => {
  const mapSlot = await getNextFreeSlot()
  const { error } = await supabase.from('tasks').insert({
    title: input.title,
    description: input.description,
    assignee_id: input.assigneeId,
    emoji: input.emoji,
    status: 'open',
    map_slot: mapSlot,
  })
  if (error) throw error
}

export const updateTask = async (
  taskId: string,
  patch: Partial<{
    title: string
    description: string
    assignee_id: string | null
    status: TaskStatus
    emoji: string
  }>,
) => {
  const { error } = await supabase.from('tasks').update(patch).eq('id', taskId)
  if (error) throw error
}

export const deleteTask = async (taskId: string) => {
  const { error: commentsError } = await supabase.from('comments').delete().eq('task_id', taskId)
  if (commentsError) throw commentsError

  const { error: subtasksError } = await supabase.from('subtasks').delete().eq('parent_task_id', taskId)
  if (subtasksError) throw subtasksError

  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) throw error
}

export const addSubtask = async (taskId: string, title: string, assigneeId: string | null) => {
  const { error } = await supabase.from('subtasks').insert({
    parent_task_id: taskId,
    title,
    assignee_id: assigneeId,
    done: false,
  })
  if (error) throw error
}

export const updateSubtask = async (
  subtaskId: string,
  patch: Partial<{ title: string; done: boolean; assignee_id: string | null }>,
) => {
  const { error } = await supabase.from('subtasks').update(patch).eq('id', subtaskId)
  if (error) throw error
}

export const addComment = async (taskId: string, authorId: string | null, body: string) => {
  const { error } = await supabase.from('comments').insert({
    task_id: taskId,
    author_id: authorId,
    body,
  })
  if (error) throw error
}

export const completeTaskAndAwardAnimal = async (taskId: string, ownerId: string): Promise<Animal> => {
  const { error: taskError } = await supabase.from('tasks').update({ status: 'complete' }).eq('id', taskId)
  if (taskError) throw taskError

  const { count, error: countError } = await supabase
    .from('animals')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
  if (countError) throw countError

  const sequence = count ?? 0
  const base = ANIMAL_POOL[sequence % ANIMAL_POOL.length]
  const cycle = Math.floor(sequence / ANIMAL_POOL.length)
  const suffix = cycle > 0 ? ` ${toRoman(cycle + 1)}` : ''

  const { data, error } = await supabase
    .from('animals')
    .insert({
      owner_id: ownerId,
      species: base.species,
      display_name: `${base.displayName}${suffix}`,
      blurb: base.blurb,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as Animal
}
