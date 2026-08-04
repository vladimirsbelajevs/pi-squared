## Work implementation flow

### Subagents

Use subagents for doing development work - use luna-developer for development,
pass information to subagent for any documentation files that it should read
before starting work. Use main agent for reviewing the job that luna-developer
has done. If aditional work is needed after review use luna-developer again to
do the additional work and then review it again with main agent. Repeat this
process until the job is done. Do not spawn gtp-5.6-Sol max subagents (you can
spawn lower thinking vairants if necessary for reviewing)

For browser profiling, use the browser-profiler agent.

If user explicitly requests that he does not want to use subagents then follow
the instructions in the main agent and do not spawn any subagents.

If the task to implement is quite small then you can implement it directly in the main agent without spawning subagents.