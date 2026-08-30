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
  taskAssignments: Array<{ task_id: string; member_id: string }>
  subtaskAssignments: Array<{ subtask_id: string; member_id: string }>
}

const TABLES = ['members', 'tasks', 'subtasks', 'comments', 'animals', 'task_assignees', 'subtask_assignees'] as const

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
  const [membersRes, tasksRes, subtasksRes, commentsRes, animalsRes, taskAssignmentsRes, subtaskAssignmentsRes] = await Promise.all([
    supabase.from('members').select('*').order('created_at', { ascending: true }),
    supabase.from('tasks').select('*').order('created_at', { ascending: true }),
    supabase.from('subtasks').select('*').order('created_at', { ascending: true }),
    supabase.from('comments').select('*').order('created_at', { ascending: true }),
    supabase.from('animals').select('*').order('awarded_at', { ascending: true }),
    supabase.from('task_assignees').select('*'),
    supabase.from('subtask_assignees').select('*'),
  ])

  for (const res of [membersRes, tasksRes, subtasksRes, commentsRes, animalsRes, taskAssignmentsRes, subtaskAssignmentsRes]) {
    if (res.error) throw res.error
  }

  return {
    members: membersRes.data as Member[],
    tasks: tasksRes.data as Task[],
    subtasks: subtasksRes.data as Subtask[],
    comments: commentsRes.data as Comment[],
    animals: animalsRes.data as Animal[],
    taskAssignments: taskAssignmentsRes.data as Array<{ task_id: string; member_id: string }>,
    subtaskAssignments: subtaskAssignmentsRes.data as Array<{ subtask_id: string; member_id: string }>,
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
  const { error: taskAssignError } = await supabase.from('task_assignees').delete().eq('member_id', memberId)
  if (taskAssignError) throw taskAssignError

  const { error: subtaskAssignError } = await supabase.from('subtask_assignees').delete().eq('member_id', memberId)
  if (subtaskAssignError) throw subtaskAssignError

  const { error } = await supabase.from('members').delete().eq('id', memberId)
  if (error) throw error
}

export const setTaskAssignees = async (taskId: string, memberIds: string[]) => {
  const uniqueMemberIds = [...new Set(memberIds.filter(Boolean))]
  const { error: deleteError } = await supabase.from('task_assignees').delete().eq('task_id', taskId)
  if (deleteError) throw deleteError

  if (!uniqueMemberIds.length) return

  const { error } = await supabase.from('task_assignees').insert(
    uniqueMemberIds.map((memberId) => ({ task_id: taskId, member_id: memberId })),
  )
  if (error) throw error
}

export const setSubtaskAssignees = async (subtaskId: string, memberIds: string[]) => {
  const uniqueMemberIds = [...new Set(memberIds.filter(Boolean))]
  const { error: deleteError } = await supabase.from('subtask_assignees').delete().eq('subtask_id', subtaskId)
  if (deleteError) throw deleteError

  if (!uniqueMemberIds.length) return

  const { error } = await supabase.from('subtask_assignees').insert(
    uniqueMemberIds.map((memberId) => ({ subtask_id: subtaskId, member_id: memberId })),
  )
  if (error) throw error
}

export const addTask = async (input: {
  title: string
  description: string
  assigneeIds: string[]
  emoji: string
}) => {
  const mapSlot = await getNextFreeSlot()
  const { data, error } = await supabase.from('tasks').insert({
    title: input.title,
    description: input.description,
    emoji: input.emoji,
    status: 'open',
    map_slot: mapSlot,
  }).select('id').single()
  if (error) throw error

  if (!data?.id || !input.assigneeIds.length) return

  const rows = input.assigneeIds.map((memberId) => ({ task_id: data.id, member_id: memberId }))
  const { error: assignmentError } = await supabase.from('task_assignees').insert(rows)
  if (assignmentError) throw assignmentError
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
  const { error } = await supabase.from('tasks').update({
    title: patch.title,
    description: patch.description,
    status: patch.status,
    emoji: patch.emoji,
  }).eq('id', taskId)
  if (error) throw error
}

export const deleteTask = async (taskId: string) => {
  const { error: taskAssignmentError } = await supabase.from('task_assignees').delete().eq('task_id', taskId)
  if (taskAssignmentError) throw taskAssignmentError

  const { error: commentsError } = await supabase.from('comments').delete().eq('task_id', taskId)
  if (commentsError) throw commentsError

  const { data: subtaskRows, error: subtaskLookupError } = await supabase.from('subtasks').select('id').eq('parent_task_id', taskId)
  if (subtaskLookupError) throw subtaskLookupError

  const subtaskIds = (subtaskRows ?? []).map((subtask: { id: string }) => subtask.id)
  if (subtaskIds.length) {
    const { error: subtaskAssignmentError } = await supabase.from('subtask_assignees').delete().in('subtask_id', subtaskIds)
    if (subtaskAssignmentError) throw subtaskAssignmentError
  }

  const { error: subtasksError } = await supabase.from('subtasks').delete().eq('parent_task_id', taskId)
  if (subtasksError) throw subtasksError

  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) throw error
}

export const addSubtask = async (taskId: string, title: string, assigneeIds: string[] = []) => {
  const { data, error } = await supabase.from('subtasks').insert({
    parent_task_id: taskId,
    title,
    done: false,
  }).select('id').single()
  if (error) throw error

  if (!data?.id || !assigneeIds.length) return

  const rows = assigneeIds.map((memberId) => ({ subtask_id: data.id, member_id: memberId }))
  const { error: assignmentError } = await supabase.from('subtask_assignees').insert(rows)
  if (assignmentError) throw assignmentError
}

export const deleteSubtask = async (subtaskId: string) => {
  const { error: assignmentError } = await supabase.from('subtask_assignees').delete().eq('subtask_id', subtaskId)
  if (assignmentError) throw assignmentError

  const { error } = await supabase.from('subtasks').delete().eq('id', subtaskId)
  if (error) throw error
}

export const updateSubtask = async (
  subtaskId: string,
  patch: Partial<{ title: string; done: boolean; assignee_id: string | null }>,
) => {
  const { error } = await supabase.from('subtasks').update({
    title: patch.title,
    done: patch.done,
  }).eq('id', subtaskId)
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

export const awardAnimalForOwner = async (ownerId: string): Promise<Animal> => {
  const { data: existingAnimals, error: existingError } = await supabase
    .from('animals')
    .select('*')
    .eq('owner_id', ownerId)
    .order('awarded_at', { ascending: true })

  if (existingError) throw existingError

  const ownedSpecies = new Set((existingAnimals ?? []).map((animal) => animal.species))
  const remainingSpecies = ANIMAL_POOL.filter((base) => !ownedSpecies.has(base.species))
  const poolForSelection = remainingSpecies.length ? remainingSpecies : [...ANIMAL_POOL]

  const randomIndex = Math.floor(Math.random() * poolForSelection.length)
  const base = poolForSelection[randomIndex]
  const sequence = (existingAnimals ?? []).length
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

export const completeTaskAndAwardAnimal = async (taskId: string, ownerId: string): Promise<Animal> => {
  const { error: taskError } = await supabase.from('tasks').update({ status: 'complete' }).eq('id', taskId)
  if (taskError) throw taskError

  return awardAnimalForOwner(ownerId)
}
