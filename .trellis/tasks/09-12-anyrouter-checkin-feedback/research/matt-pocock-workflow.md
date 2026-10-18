# Requested Matt Pocock workflow

The user explicitly requested the Matt Pocock process. No locally installed matching skill entry was found in the supplied skill catalog, project skill directory, or the two user skill roots. Read the official upstream skill sources without installing or modifying global configuration.

Source repository: https://github.com/mattpocock/skills

Inspected revision: `3cca18b368ae95cdbdebbff572ccafa662551015` (2026-09-12 retrieval).

Sources read:

- https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/grill-me/SKILL.md
- https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/grilling/SKILL.md
- https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/grill-with-docs/SKILL.md
- https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/to-spec/SKILL.md
- https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/tdd/SKILL.md

## Application within this repository

- Investigate repository-answerable facts instead of asking the user to discover them. Use an independent research agent for upstream evidence.
- Distinguish confirmed facts from proposed product choices; converge on an explicitly reviewed plan before implementation.
- Persist the requirement, technical design, and slice plan in the existing Trellis task. Trellis is the requested local tracking system; no GitHub issue publication or new parallel domain documentation system is needed.
- Favor a few agreed public testing seams. Document them in the final plan for review.
- Implement one failing behavior test and one minimal passing change per vertical slice; use upstream examples and observable UI behavior instead of implementation-coupled assertions.
- Use Trellis's local phase-transition review gate and one concise highest-value question where user input is necessary. Avoid duplicating overlapping interviews or asking the user to approve routine implementation details individually.

The upstream sources were researched as process guidance. No global skills were installed, and no remote tracker was changed.
