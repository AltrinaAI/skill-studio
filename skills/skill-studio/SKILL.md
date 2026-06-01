---
name: skill-studio
description: Use this skill to load the secrets and API keys you manage in Skill Studio (for example OPENAI_API_KEY, GITHUB_TOKEN, or a database URL) into your environment. Run it once at the start of a task whenever another skill or command needs credentials, or reports a missing API key, token, or environment variable.
---

# Skill Studio — activate secrets

Skill Studio keeps your API keys and secrets in one place and renders them to a
single env file. This skill loads them into the environment so the tools you run
can see them.

Run the bundled `activate.sh` through `eval`, pointing at this skill's folder:

```bash
eval "$(bash ./activate.sh --print)"
```

(If your shell isn't already in this skill's folder, use the absolute path to
`activate.sh`.)

That one command:

- exports every secret Skill Studio manages into the **current** shell, and
- wires your shell startup files so shells started **later** inherit them too.

It prints only the variable **names** it activated — never the values. If it
reports that no secrets are configured, add them in Skill Studio and run it
again.
