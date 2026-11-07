/** Seed document for a brand-new shared doc. Every section exercises a feature. */
export const initialContent = `
<h1>Welcome to Write ✍️</h1>
<p>A playground for <strong>Tiptap</strong>. Everything here is live and shared with anyone who opens this page, so open it on a second device to see their cursor. Press <code>?</code> in the top bar for guided tours.</p>

<div data-type="callout" data-variant="info"><p>Type <code>/</code> for the block menu, <code>@</code> to mention someone and <code>:</code> for emoji. Formatting is in the ribbon above; the navigation pane is on the View tab.</p></div>

<h2>Formatting</h2>
<p><strong>Bold</strong>, <em>italic</em>, <u>underline</u>, <s>strike</s>, <code>inline code</code>, H<sub>2</sub>O, x<sup>2</sup>, <mark>highlight</mark>, <mark data-color="#bbf7d0" style="background-color: #bbf7d0">green highlight</mark>, <span style="color: #7c3aed">coloured text</span>, <span style="font-family: Georgia, serif">a serif font</span> and a <span data-spoiler class="spoiler">hidden spoiler</span> (hover it).</p>
<p>Typography turns -- into an en dash, "quotes" into curly quotes, (c) into ©, -> into → and 1/2 into ½. Try typing them.</p>
<p style="text-align: center">This paragraph is centred.</p>

<h2>Lists and tasks</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p>Install Tiptap</p></li>
  <li data-type="taskItem" data-checked="false"><p>Try every extension</p>
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="false"><p>Nested tasks work too</p></li>
    </ul>
  </li>
</ul>
<ol><li><p>Numbered lists</p></li><li><p>Press <code>Tab</code> to nest</p><ul><li><p>like this</p></li></ul></li></ol>

<h2>Tables</h2>
<table>
  <tbody>
    <tr><th><p>Extension</p></th><th><p>Package</p></th><th><p>Shortcut</p></th></tr>
    <tr><td><p>Highlight</p></td><td><p><code>@tiptap/extension-highlight</code></p></td><td><p>Ctrl+Shift+H</p></td></tr>
    <tr><td><p>Task list</p></td><td><p><code>@tiptap/extension-list</code></p></td><td><p>Ctrl+Shift+9</p></td></tr>
  </tbody>
</table>

<h2>Code</h2>
<pre><code class="language-ts">import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

const editor = new Editor({
  extensions: [StarterKit],
  content: '&lt;p&gt;Hello world&lt;/p&gt;',
})</code></pre>

<h2>Math</h2>
<p>Inline: <span data-type="inline-math" data-latex="e^{i\\pi} + 1 = 0"></span>. Click any formula to edit it.</p>
<div data-type="block-math" data-latex="\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}"></div>

<h2>Media</h2>
<img src="/sample.svg" alt="Sample illustration" width="560">
<p>Drop or paste an image file anywhere in the document. Insert YouTube videos from the <code>/</code> menu.</p>

<h2>Callouts and toggles</h2>
<div data-type="callout" data-variant="warning"><p>Callouts are a <strong>custom node</strong> with a React node view. Click the icon to change the type.</p></div>
<details open>
  <summary>Click the arrow to collapse this section</summary>
  <div data-type="detailsContent"><p>Toggle sections can hold any blocks.</p></div>
</details>

<h2>People and emoji</h2>
<p>Thanks to <span data-type="mention" data-id="ada-lovelace" data-label="Ada Lovelace"></span> and <span data-type="mention" data-id="grace-hopper" data-label="Grace Hopper"></span> <span data-type="emoji" data-name="sparkles"></span></p>

<h2>Try these shortcuts</h2>
<ul>
  <li><p><code>!today</code> then a space inserts today's date. <code>!shrug</code> works too.</p></li>
  <li><p><code>||secret||</code> makes a spoiler, and so does pasting text with <code>||…||</code>.</p></li>
  <li><p><code>:::warning</code> then a space starts a callout.</p></li>
  <li><p><code>$$x^2$$</code> is inline math and <code>$$$x^2$$$</code> is a math block.</p></li>
  <li><p><code>==text==</code> highlights.</p></li>
  <li><p><code>Ctrl+Shift+D</code> inserts the date and <code>Ctrl+S</code> saves a local backup.</p></li>
</ul>
<p></p>
`
