export type Role = 'admin' | 'lead' | 'viewer'

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  role: Role
  createdAt?: unknown
}

export type PersonType = 'employee' | 'subcontractor' | 'supply_chain'

export interface Person {
  id: string
  name: string
  /** Job title, e.g. "BIM Modeler", "BIM Coordinator", "Team Lead" */
  title: string
  /** Architectural, Structural, MEP, Civil, Infrastructure, Coordination ... */
  discipline: string
  type: PersonType
  /** id of the Person who leads this person (a team lead) */
  leadId: string | null
  /** optional: ties the person to a sign-in account for "my schedule" */
  email: string
  active: boolean
  order: number
  notes: string
}

export type ProjectStatus = 'active' | 'upcoming' | 'on_hold' | 'closed'

export interface Project {
  id: string
  /** Short code, e.g. P820 */
  code: string
  name: string
  client: string
  color: string
  status: ProjectStatus
  order: number
  notes: string
}

export type TaskStatus = 'open' | 'in_progress' | 'on_hold' | 'done'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export interface Task {
  id: string
  projectId: string
  name: string
  discipline: string
  startDate: string | null
  endDate: string | null
  status: TaskStatus
  priority: Priority
  order: number
  notes: string
  /** Optional: how many people this task ideally needs per day */
  headcount: number | null
}

/** One doc per person per day. Doc id = `${personId}__${date}` */
export interface Allocation {
  id: string
  personId: string
  taskId: string
  projectId: string
  /** YYYY-MM-DD */
  date: string
  note: string
  updatedBy: string
  updatedByName: string
  updatedAt?: unknown
}

export interface Settings {
  orgName: string
  /** 0 = Sunday ... 6 = Saturday. Default Qatar working week Sun-Thu */
  workingDays: number[]
  /** YYYY-MM-DD public holidays */
  holidays: string[]
  disciplines: string[]
  titles: string[]
  /** Default view length in days */
  defaultRangeDays: number
}

export interface ActivityEntry {
  id: string
  at?: unknown
  byUid: string
  byName: string
  type: 'assign' | 'move' | 'unassign' | 'project' | 'task' | 'person' | 'settings' | 'user' | 'bulk'
  message: string
}

export const DEFAULT_SETTINGS: Settings = {
  orgName: 'BIM Team',
  workingDays: [0, 1, 2, 3, 4],
  holidays: [],
  disciplines: ['Architectural', 'Structural', 'MEP', 'Civil', 'Infrastructure', 'Coordination', 'Facade', 'Interiors'],
  titles: ['BIM Modeler', 'Senior BIM Modeler', 'BIM Coordinator', 'Team Lead', 'BIM Manager', 'Subcontractor', 'Supplier'],
  defaultRangeDays: 14,
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin (full control)',
  lead: 'Team lead (can allocate)',
  viewer: 'Viewer (read only)',
}

export const PERSON_TYPE_LABEL: Record<PersonType, string> = {
  employee: 'Team member',
  subcontractor: 'Subcontractor',
  supply_chain: 'Supply chain',
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Active',
  upcoming: 'Upcoming',
  on_hold: 'On hold',
  closed: 'Closed',
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  on_hold: 'On hold',
  done: 'Done',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

export const allocationId = (personId: string, date: string) => `${personId}__${date}`
