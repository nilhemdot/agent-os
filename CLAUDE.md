# Agent rules

- Never disable MCP servers or plugins, and don't recommend it as a fix, including per-project `disabledMcpServers`, `skillOverrides` on a plugin's skills, or removing a plugin from `enabledPlugins`. When a server or plugin is the cost, quantify it and offer remedies that leave it enabled: a narrower hook matcher, an `if` guard, removing a duplicate registration, or a config option the plugin already has. If none exists, report the limit and stop.
