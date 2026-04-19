# aside

`/aside` is a temporary side-question overlay for Pi.

It is designed for the moment when you are in the middle of a main session, want to ask one small clarifying question, but do **not** want to pollute the main transcript or push your current working state far up the scrollback.

## What it does

- opens a large centered overlay
- captures a single question
- builds a **bounded context capsule** from the current session
- runs one out-of-band completion
- shows the answer in the overlay
- optionally inserts a formatted result into the main editor
- closes without writing user or assistant messages into the main transcript by default

## What it does not do

V1 is intentionally limited.

It does **not**:

- create a session fork or tree branch
- run tools
- inspect the filesystem directly
- read files on demand
- run shell commands
- persist aside history after close
- append the aside question or answer to the main transcript automatically
- support multi-turn aside chat

## Access model

Short answer: **yes, as implemented now, `/aside` does not have filesystem access.**

It is a **tool-free** completion.

That means the model can only use:

- your aside question
- the current working directory label
- the current editor draft
- the last completed user message from the main session
- the last completed assistant text from the main session
- tiny summaries of tools from that same completed turn, if present

It cannot open files, run `read`, call `bash`, or inspect the repo live.

So the best use case is:

- clarifying questions about the current thread
- quick reasoning about the most recent exchange
- short interpretation questions
- "why did you say that?" or "what assumption are you making?"

If your tangent needs live repo inspection, logs, file reads, or edits, use **`/fork`** instead.

## Workflow

```text
main session
    |
    |  /aside "why did that fail?"
    v
+-----------------------------+
| aside overlay opens         |
| question stays local        |
+-----------------------------+
    |
    | build bounded capsule from current session
    |  - cwd label
    |  - editor draft
    |  - last user message
    |  - last assistant text
    |  - tiny tool summaries
    v
+-----------------------------+
| one completion, no tools    |
| no transcript write-back    |
+-----------------------------+
    |
    +--> Close
    |      -> discard aside state
    |
    +--> Insert into editor
           -> paste formatted result into main editor
           -> editor stays unsent
```

## Mental model

Think of `/aside` as:

- a **temporary side conversation**
- with a **small borrowed memory**
- and **no hands**

It can reason over a small slice of the current session.
It cannot go fetch new information.

## Context modes

V1 uses one main mode plus a fallback.

### `recent-turn`
Includes:

- cwd / project label
- current editor draft
- last completed user message
- last completed assistant text blocks
- tiny tool summaries from that same completed turn

### `minimal`
Used when `recent-turn` is empty or too large.

Includes:

- cwd / project label
- current editor draft
- explicit aside question

## Excluded on purpose

The capsule deliberately excludes:

- older transcript history beyond the latest completed exchange
- assistant thinking blocks
- raw tool output bodies
- previous asides
- unrelated custom extension messages
- any live file or shell access

## User promise

Running `/aside` does **not**:

- append a user message to the main session
- append an assistant message to the main session
- create a hidden session message
- create a fork
- save durable aside history by default

The built-in promotion path is **Insert into editor** only.

## Command

```text
/aside
/aside why did that fail?
```

If text is provided, it prefills the overlay.

## Model selection

Selection order:

1. `PI_ASIDE_MODEL` if set and resolvable as a full `provider/model-name`
2. otherwise the current active model
3. otherwise a clear failure state

## When to use `/aside`

Use it for:

- "what exactly did you mean by that?"
- "why is this the likely root cause?"
- "what assumption are you making from the last turn?"
- "explain this recommendation briefly"
- "what would be the next likely step if this fails?"

## When not to use `/aside`

Do **not** use it when you need:

- file inspection
- shell commands
- code edits
- multi-step investigation
- durable transcript history
- long back-and-forth branching

Use `/fork` for those cases.

## Current limitations

V1 is:

- single-shot
- tool-free
- idle-only
- non-persistent
- editor-first for promotion

That simplicity is the whole point. It keeps `/aside` cheap, fast, and non-disruptive.
