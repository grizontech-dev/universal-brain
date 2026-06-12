---
name: Working Preferences & Feedback
description: How Maulik prefers to collaborate — output style, doc format, what to avoid
type: feedback
originSessionId: 0c9d0c8e-5e36-4f0a-89fe-e618574d9cee
---
Always produce both a markdown spec doc AND a visual HTML file when documenting a major layer or module. Confirmed as the preferred format in the Layer 2 session.

**Why:** He reviews architecture visually and shares the HTML with collaborators. The markdown is the source of truth, the HTML is the shareable artifact.

**How to apply:** For any new layer, major feature, or system design work — produce both files by default. HTML goes in `/docs/`, named `{LAYER_OR_TOPIC}_VISUAL.html`.

---

When listing modules or layers, always include: responsibility, key files, features table, and data/flow diagram. Don't just list names.

**Why:** He asked for this depth in the Layer 2 session and it was the expected format.

**How to apply:** Module documentation = header + file paths + feature list + flow/formula + DB schema snippet.

---

Use dark-themed HTML visuals with card-based layouts, color-coded by module type, monospace fonts for code/paths. Match the style of `LAYER2_VISUAL.html`.

**Why:** Confirmed as visually appropriate when the file was created without feedback requesting changes.

**How to apply:** Copy the CSS variable palette and card structure from `LAYER2_VISUAL.html` for all future visual docs.
