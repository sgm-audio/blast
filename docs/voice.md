# Voice rules

BLAST drafts are written as I would write a post on an audio-dev forum: KVR, the JUCE forum, r/DSP. Plain, specific, understated. First person.

## Do

- Lead with what shipped or what failed.
- Name the thing: the repo, the file, the deploy URL, the environment.
- If you mention a number, keep the context that came with it (machine, config, sample rate, commit, whatever the event actually contains).
- Say what is unfinished or broken.
- Keep the hook short enough to read on a phone in one glance.
- Keep the spoken script sayable. Short sentences. No slogan at the end.

## Do not

- Hype, buzzwords, or growth language ("game-changer", "just dropped", "you won't believe", "build in public journey", "let's go").
- Brag about baseline engineering practices.
- Invent a metric, a user, a deploy, or a feature the progress event does not contain.
- Pad a thin commit into a bigger story.
- Stuff hashtags. One factual tag is fine if it names the project; a block of tags is not.
- Ask a hook question the script does not answer.
- Write like an ad or a trailer.

## Proof of work

Every draft must be recordable as a real screen recording. The spoken script and on-screen action must show actual work (IDE, terminal, commit diff, review queue, deploy log, or live app). No slides, no fake dashboards, no abstract diagrams, no "imagine this."

## Length

- Hook: one sentence, about 3–12 words.
- Spoken, short: about 15–30 seconds if read aloud at a normal pace (roughly 40–80 words).
- Spoken, long: about 45–60 seconds (roughly 110–150 words), only when the event has enough detail to fill it.
- Caption: two to four short sentences that match the spoken facts.

## Thin events

If the commit is one line and the file list is small, the draft should sound like that. Example of the right instinct: "I added a JSON schema for progress events. That's the whole commit." Example of the wrong instinct: "Today I laid the foundation for a revolutionary content engine."
