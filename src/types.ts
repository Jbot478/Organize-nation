export type TaskStatus = 'open' | 'complete' | 'cancelled'

export interface Member {
  id: string
  name: string
  avatar_emoji: string
  created_at: string
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  assignee_id: string | null
  emoji: string
  map_slot: number | null
  created_at: string
}

export interface Subtask {
  id: string
  parent_task_id: string
  title: string
  done: boolean
  assignee_id: string | null
  created_at: string
}

export interface Comment {
  id: string
  task_id: string
  author_id: string | null
  body: string
  created_at: string
}

export interface Animal {
  id: string
  owner_id: string
  species: string
  display_name: string
  blurb: string
  awarded_at: string
}

export interface AnimalTemplate {
  species: string
  displayName: string
  blurb: string
  emoji: string
}
