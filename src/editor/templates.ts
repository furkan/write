import { initialContent } from './content'

/** Starting points offered in the library's "Start a new document" gallery. */
export type Template = {
  id: string
  name: string
  title: string
  description: string
  /** Lines drawn on the gallery thumbnail. */
  thumbnail: string[]
  html: string
}

const today = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank document',
    title: '',
    description: 'Start from scratch',
    thumbnail: [],
    html: '',
  },
  {
    id: 'tour',
    name: 'Feature tour',
    title: 'Feature tour',
    description: 'Every extension, ready to try',
    thumbnail: ['Welcome to Write', 'Formatting', 'Lists and tasks', 'Tables', 'Math'],
    html: initialContent,
  },
  {
    id: 'meeting',
    name: 'Meeting notes',
    title: 'Meeting notes',
    description: 'Agenda, notes and action items',
    thumbnail: ['Meeting notes', 'Attendees', 'Agenda', 'Action items'],
    get html() {
      return `
<h1>Meeting notes</h1>
<p><strong>Date:</strong> ${today()}</p>
<h2>Attendees</h2>
<ul><li><p></p></li></ul>
<h2>Agenda</h2>
<ol><li><p></p></li></ol>
<h2>Notes</h2>
<p></p>
<h2>Action items</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>
`
    },
  },
  {
    id: 'brief',
    name: 'Project brief',
    title: 'Project brief',
    description: 'Goals, scope and milestones',
    thumbnail: ['Project brief', 'Goals', 'Scope', 'Milestones', 'Risks'],
    html: `
<h1>Project brief</h1>
<div data-type="callout" data-variant="info"><p>One paragraph summary: what are we building, for whom, and why now?</p></div>
<h2>Goals</h2>
<ul><li><p></p></li></ul>
<h2>Scope</h2>
<table><tbody>
  <tr><th><p>In scope</p></th><th><p>Out of scope</p></th></tr>
  <tr><td><p></p></td><td><p></p></td></tr>
</tbody></table>
<h2>Milestones</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>
<h2>Risks</h2>
<div data-type="callout" data-variant="warning"><p></p></div>
`,
  },
  {
    id: 'journal',
    name: 'Journal',
    title: 'Journal',
    description: 'A dated entry with prompts',
    thumbnail: ['Journal', 'Today I…', 'Grateful for', 'Tomorrow'],
    get html() {
      return `
<h1>Journal</h1>
<h2>${today()}</h2>
<p><em>Today I…</em></p>
<p></p>
<h3>Grateful for</h3>
<ul><li><p></p></li></ul>
<h3>Tomorrow</h3>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>
`
    },
  },
]

export const findTemplate = (id: string | null) => TEMPLATES.find((t) => t.id === id)
